import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Response } from 'express';
import { db } from '@infosound/database';
import { Current, Identity } from './security';
import { validate, uuid } from './common/validation';
import { throttle } from './common/rate-limit';
import {
  publicTrackWhere,
  trackInclude,
  viewTrack,
  type IncludedTrack,
} from './features/tracks/track-view';
import {
  SYSTEM_PROMPT,
  TOOL_DECLARATIONS,
  extractParts,
  formatMusicContext,
  sseEvent,
} from './chatbot-protocol';
import { runTool, type SerializedTrack } from './chatbot-tools';

const GEMINI_KEY = process.env.GEMINI_API_KEY?.trim();
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=`;
const GEMINI_STREAM_URL = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:streamGenerateContent?alt=sse&key=`;

const messageSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().uuid().nullish(),
});

type GeminiContent = { role: 'user' | 'model'; parts: unknown[] };

// ---- Music context (static block in the system prompt) -------------------

async function buildMusicContext(userId: string): Promise<string> {
  const [popular, liked, artists, genres] = await Promise.all([
    db.track.findMany({
      where: { ...publicTrackWhere },
      orderBy: { playCount: 'desc' },
      take: 20,
      select: {
        title: true,
        author: { select: { displayName: true } },
        playCount: true,
        duration: true,
      },
    }),
    db.trackLike.findMany({
      where: { userId },
      include: { track: { select: { title: true, author: { select: { displayName: true } } } } },
      take: 10,
    }),
    db.user.findMany({
      where: { role: 'AUTHOR', active: true },
      select: { displayName: true, bio: true },
    }),
    db.genre.findMany({ where: { isSelectable: true }, select: { name: true } }),
  ]);

  return formatMusicContext({
    popular: popular.map((t) => ({
      title: t.title,
      artist: t.author.displayName,
      playCount: t.playCount,
      duration: Number(t.duration ?? 0),
    })),
    liked: liked.map((l) => ({ title: l.track.title, artist: l.track.author.displayName })),
    artists: artists.map((a) => ({ displayName: a.displayName, bio: a.bio })),
    genres: genres.map((g) => g.name),
  });
}

// ---- Gemini call ---------------------------------------------------------

// Non-streaming call WITH tools — used only to resolve function calls.
async function callGemini(contents: GeminiContent[], systemInstruction: string) {
  const res = await fetch(GEMINI_URL + GEMINI_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  return res.json();
}

// Streaming call (no tools) — produces the final answer token by token.
async function streamGemini(
  contents: GeminiContent[],
  systemInstruction: string,
  onToken: (text: string) => void,
): Promise<string> {
  const res = await fetch(GEMINI_STREAM_URL + GEMINI_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      // Keep tools declared so contents containing functionCall/functionResponse stay valid.
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok || !res.body) {
    const detail = res.ok ? 'no body' : (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Gemini stream error ${res.status}: ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const parts = JSON.parse(line.slice(6))?.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts)
          if (part.text) {
            full += part.text;
            onToken(part.text);
          }
      } catch {
        // skip malformed Gemini SSE lines
      }
    }
  }
  return full;
}

// Attach playable cards for any catalogue track the answer names by title.
async function matchTracksInText(
  text: string,
  user: Identity,
  already: Set<string>,
): Promise<SerializedTrack[]> {
  const haystack = text.toLowerCase();
  const candidates = await db.track.findMany({
    where: { ...publicTrackWhere, author: { active: true } },
    select: { id: true, title: true },
    take: 300,
  });
  const hits = candidates
    .filter(
      (c) => c.title.length >= 3 && !already.has(c.id) && haystack.includes(c.title.toLowerCase()),
    )
    .sort((a, b) => haystack.indexOf(a.title.toLowerCase()) - haystack.indexOf(b.title.toLowerCase()));
  if (!hits.length) return [];
  const rows = await db.track.findMany({
    where: { id: { in: hits.map((h) => h.id) } },
    include: trackInclude,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = hits.map((h) => byId.get(h.id)).filter(Boolean) as IncludedTrack[];
  return Promise.all(ordered.map((r) => viewTrack(r, user)));
}

@ApiTags('InfoSound chatbot')
@ApiBearerAuth()
@Controller('api/v1/chat')
export class ChatbotController {
  @Post('messages')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a message and receive a streamed AI response' })
  async send(@Current() user: Identity, @Body() body: unknown, @Res() res: Response) {
    if (!GEMINI_KEY)
      return res
        .status(503)
        .json({ code: 'CHATBOT_UNAVAILABLE', message: 'Chatbot chưa được cấu hình.' });

    const input = validate(messageSchema, body);
    throttle(`chat:${user.id}:min`, 10, 60_000);
    throttle(`chat:${user.id}:hour`, 50, 3_600_000);

    const conversation = input.conversationId
      ? await db.chatConversation.findFirst({ where: { id: input.conversationId, userId: user.id } })
      : null;
    const convo =
      conversation ??
      (await db.chatConversation.create({
        data: { userId: user.id, title: input.message.slice(0, 100) },
      }));

    await db.chatMessage.create({
      data: { conversationId: convo.id, role: 'user', content: input.message },
    });

    const history = await db.chatMessage.findMany({
      where: { conversationId: convo.id },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    const systemInstruction = `${SYSTEM_PROMPT}\n\n${await buildMusicContext(user.id)}`;
    const contents: GeminiContent[] = history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(sseEvent({ type: 'meta', conversationId: convo.id }));

    const tracksById = new Map<string, SerializedTrack>();
    let finalText = '';
    try {
      // Tool loop (non-streaming): let Gemini call DB tools to gather real data.
      for (let round = 0; round < 3; round++) {
        const json = await callGemini(contents, systemInstruction);
        const { functionCalls } = extractParts(json);
        if (!functionCalls.length) break;

        contents.push({ role: 'model', parts: json.candidates[0].content.parts });
        const responseParts: unknown[] = [];
        for (const call of functionCalls) {
          const { summary, tracks } = await runTool(call, user);
          for (const t of tracks) if (t?.id) tracksById.set(t.id, t);
          responseParts.push({
            functionResponse: { name: call.name, response: { result: summary } },
          });
        }
        contents.push({ role: 'user', parts: responseParts });
      }

      // Final answer streamed token by token to the client.
      finalText = await streamGemini(contents, systemInstruction, (token) =>
        res.write(sseEvent({ type: 'text', text: token })),
      );
    } catch (err) {
      console.error('[chatbot] generation failed:', err instanceof Error ? err.message : err);
      if (!finalText)
        res.write(
          sseEvent({ type: 'error', message: 'Không thể tạo phản hồi. Vui lòng thử lại.' }),
        );
    }

    // Attach playable cards: tools' results + any track the answer names by title.
    for (const t of await matchTracksInText(finalText, user, new Set(tracksById.keys())))
      if (t?.id) tracksById.set(t.id, t);
    const tracks = [...tracksById.values()];
    if (tracks.length) res.write(sseEvent({ type: 'tracks', tracks }));

    if (finalText)
      await db.chatMessage.create({
        data: { conversationId: convo.id, role: 'assistant', content: finalText },
      });

    res.write(sseEvent({ type: 'done' }));
    res.end();
  }

  @Get('conversations')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'List chat conversations for the current user' })
  async list(@Current() user: Identity) {
    const conversations = await db.chatConversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
    return {
      items: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        messageCount: c._count.messages,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    };
  }

  @Get('conversations/:id/messages')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Get messages for a specific conversation' })
  async messages(@Current() user: Identity, @Param('id') id: string) {
    uuid(id);
    await db.chatConversation.findFirstOrThrow({ where: { id, userId: user.id } });
    const messages = await db.chatMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return { items: messages };
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a chat conversation' })
  async delete(@Current() user: Identity, @Param('id') id: string) {
    uuid(id);
    await db.chatConversation.deleteMany({ where: { id, userId: user.id } });
  }
}

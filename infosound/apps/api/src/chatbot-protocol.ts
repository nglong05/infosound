// Pure, dependency-free helpers for the chatbot — no NestJS / DB / network imports.
// Kept pure so they can be unit-tested in isolation (see chatbot/tests/protocol.test.mjs).

export type ToolCall = { name: string; args: Record<string, unknown> };

export type GeminiParts = { text: string; functionCalls: ToolCall[] };

export type MusicContextData = {
  popular: { title: string; artist: string; playCount: number; duration: number }[];
  liked: { title: string; artist: string }[];
  artists: { displayName: string; bio?: string | null }[];
  genres: string[];
};

export type TrackSummary = {
  title: string;
  artist: string;
  genre?: string | null;
  playCount?: number | null;
};

// Function declarations exposed to Gemini so it can query InfoSound's catalogue itself.
export const TOOL_DECLARATIONS = [
  {
    name: 'search_tracks',
    description:
      'Tìm bài hát trên InfoSound theo tên bài hát hoặc tên nghệ sĩ. Dùng khi người dùng hỏi về một bài hát/nghệ sĩ cụ thể hoặc muốn nghe một bài nào đó.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Từ khoá: tên bài hát hoặc tên nghệ sĩ' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_popular_tracks',
    description:
      'Lấy danh sách bài hát phổ biến nhất trên InfoSound (nhiều lượt nghe nhất). Dùng khi người dùng hỏi bài nào đang hot / thịnh hành / nghe nhiều nhất.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Số bài muốn lấy, mặc định 6' },
      },
    },
  },
  {
    name: 'get_artist_tracks',
    description:
      'Lấy các bài hát của một nghệ sĩ cụ thể. Dùng khi người dùng hỏi nghệ sĩ X có những bài gì.',
    parameters: {
      type: 'object',
      properties: {
        artist_name: { type: 'string', description: 'Tên nghệ sĩ' },
      },
      required: ['artist_name'],
    },
  },
  {
    name: 'get_my_profile',
    description:
      'Lấy thông tin tài khoản của người dùng hiện tại: tên hiển thị, tên đăng nhập, vai trò, ngày tham gia, số playlist, số bài đã thích. Dùng khi hỏi "tôi là ai", "thông tin tài khoản của tôi".',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_my_listening_stats',
    description:
      'Thống kê nghe nhạc của người dùng: số bài đã nghe, tổng lượt nghe, nghệ sĩ và bài hát nghe nhiều nhất. Dùng khi hỏi "tháng này tôi nghe gì", "tôi nghe nhiều bài nào", "thống kê của tôi".',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['month', 'all'],
          description: 'Phạm vi: "month" (tháng này) hoặc "all" (tất cả). Mặc định month.',
        },
      },
    },
  },
  {
    name: 'get_my_recent_tracks',
    description:
      'Lấy các bài hát người dùng vừa nghe gần đây. Dùng khi hỏi "tôi vừa nghe bài gì", "lịch sử nghe của tôi".',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Số bài, mặc định 8' } },
    },
  },
  {
    name: 'get_my_liked_tracks',
    description:
      'Lấy các bài hát người dùng đã thích (tim). Dùng khi hỏi "bài tôi đã thích", "nhạc yêu thích của tôi".',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Số bài, mặc định 10' } },
    },
  },
  {
    name: 'get_my_playlists',
    description:
      'Liệt kê các playlist (danh sách phát) của người dùng. Dùng khi hỏi "playlist của tôi", "tôi có những danh sách phát nào".',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_playlist',
    description:
      'Tạo một playlist mới cho người dùng. Dùng khi người dùng muốn tạo danh sách phát mới.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tên playlist' },
        is_public: { type: 'boolean', description: 'Công khai hay không, mặc định riêng tư' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_track_to_playlist',
    description:
      'Thêm một bài hát vào playlist của người dùng (tự tìm bài theo tên và tự tạo playlist nếu chưa có). Dùng khi người dùng muốn thêm bài vào danh sách phát.',
    parameters: {
      type: 'object',
      properties: {
        track_query: { type: 'string', description: 'Tên bài hát (hoặc bài + nghệ sĩ) cần thêm' },
        playlist_name: { type: 'string', description: 'Tên playlist muốn thêm vào' },
      },
      required: ['track_query', 'playlist_name'],
    },
  },
] as const;

export const SYSTEM_PROMPT = `Bạn là InfoSound AI — trợ lý âm nhạc của nền tảng nghe nhạc InfoSound.

Quy tắc:
- Chỉ trả lời các câu hỏi liên quan đến âm nhạc, nghệ sĩ, bài hát, playlist, tài khoản nghe nhạc trên InfoSound.
- Nếu người dùng hỏi ngoài phạm vi, lịch sự từ chối và gợi ý hỏi về nhạc.
- Luôn dùng công cụ để lấy dữ liệu thật trước khi trả lời — KHÔNG bịa thông tin.
- Trả lời bằng tiếng Việt, ngắn gọn, thân thiện.
- Khi nêu bài hát, nêu tên bài và nghệ sĩ; giao diện sẽ tự hiện thẻ bài hát bấm phát được.

Công cụ:
- Tra cứu nhạc: search_tracks, get_popular_tracks, get_artist_tracks.
- Cá nhân: get_my_profile, get_my_listening_stats, get_my_recent_tracks, get_my_liked_tracks.
- Playlist: get_my_playlists, create_playlist, add_track_to_playlist.
Khi người dùng muốn thêm bài vào playlist hoặc tạo playlist, hãy dùng đúng công cụ và báo lại kết quả rõ ràng.`;

// Build one SSE frame from an event object.
export function sseEvent(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

// Split text into word-preserving chunks for progressive rendering on the client.
export function chunkText(text: string, size = 28): string[] {
  if (!text) return [];
  const words = text.split(/(\s+)/); // keep whitespace tokens
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length > size && current.length > 0) {
      chunks.push(current);
      current = '';
    }
    current += word;
  }
  if (current) chunks.push(current);
  return chunks;
}

// Extract text + function calls from a Gemini generateContent response body.
export function extractParts(geminiJson: any): GeminiParts {
  const parts = geminiJson?.candidates?.[0]?.content?.parts ?? [];
  let text = '';
  const functionCalls: ToolCall[] = [];
  for (const part of parts) {
    if (part?.text) text += part.text;
    if (part?.functionCall?.name)
      functionCalls.push({
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
      });
  }
  return { text, functionCalls };
}

// Compact one-line-per-track summary handed back to Gemini as a function result.
export function trackSummary(tracks: TrackSummary[]): string {
  if (!tracks.length) return 'Không tìm thấy bài hát nào.';
  return tracks
    .map(
      (t) =>
        `- "${t.title}" — ${t.artist}${t.genre ? ` [${t.genre}]` : ''} (${t.playCount ?? 0} lượt nghe)`,
    )
    .join('\n');
}

// Render the static music-context block injected into the system prompt.
export function formatMusicContext(data: MusicContextData): string {
  const lines: string[] = ['Dữ liệu InfoSound hiện tại:'];
  lines.push(
    `\nBài hát phổ biến (${data.popular.length} bài):\n` +
      data.popular
        .map(
          (t) =>
            `- "${t.title}" — ${t.artist} (${t.playCount} lượt nghe, ${Math.round(t.duration)}s)`,
        )
        .join('\n'),
  );
  if (data.liked.length)
    lines.push(
      `\nBài người dùng đã thích:\n` +
        data.liked.map((l) => `- "${l.title}" — ${l.artist}`).join('\n'),
    );
  lines.push(
    `\nNghệ sĩ:\n` +
      data.artists
        .map((a) => `- ${a.displayName}${a.bio ? ` (${a.bio.slice(0, 80)})` : ''}`)
        .join('\n'),
  );
  lines.push(`\nThể loại: ${data.genres.join(', ')}`);
  return lines.join('\n');
}

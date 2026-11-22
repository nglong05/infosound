import { z } from 'zod';

export const MAX_LYRICS_LINES = 2000;
export const MAX_LYRIC_LINE_CHARACTERS = 500;
export const MAX_LYRICS_BYTES = 64 * 1024;
export const MAX_LYRIC_START_MS = 24 * 60 * 60 * 1000;

export const lyricLineSchema = z
  .object({
    startMs: z.number().int().min(0).max(MAX_LYRIC_START_MS),
    // Empty cues deliberately clear the active line for instrumental sections.
    text: z
      .string()
      .trim()
      .max(MAX_LYRIC_LINE_CHARACTERS)
      .refine(
        (value) => !/[\x00-\x1f\x7f]/.test(value),
        'Mỗi dòng lời không được chứa ký tự điều khiển hoặc xuống dòng.',
      ),
  })
  .strict();

export const lyricsDocumentSchema = z
  .object({
    version: z.literal(1),
    lines: z.array(lyricLineSchema).min(1).max(MAX_LYRICS_LINES),
  })
  .strict()
  .superRefine((document, ctx) => {
    for (let index = 1; index < document.lines.length; index++) {
      if (document.lines[index].startMs <= document.lines[index - 1].startMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'startMs'],
          message: 'Mốc thời gian phải tăng dần và không được trùng nhau.',
        });
        break;
      }
    }
    if (!document.lines.some((line) => line.text.length > 0))
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Cần ít nhất một dòng lời bài hát.',
      });
    if (new TextEncoder().encode(JSON.stringify(document)).byteLength > MAX_LYRICS_BYTES)
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Lời bài hát vượt giới hạn 64 KiB.',
      });
  });

export const lyricsUpdateSchema = lyricsDocumentSchema.safeExtend({
  sourceVersion: z.number().int().min(1).max(2147483647),
});
export type LyricLine = z.infer<typeof lyricLineSchema>;
export type LyricsDocument = z.infer<typeof lyricsDocumentSchema>;
export type LyricsUpdate = z.infer<typeof lyricsUpdateSchema>;
export type TrackLyricsResponse = {
  trackId: string;
  sourceVersion: number;
  lyrics: LyricsDocument | null;
  updatedAt: string | null;
};

export type LyricLine = { startMs: number; text: string };
export type LyricsLine = LyricLine;
export type LyricsDocument = { version: 1; lines: LyricLine[] };
export type TrackLyricsResponse = {
  trackId: string;
  sourceVersion: number;
  lyrics: LyricsDocument | null;
  updatedAt: string | null;
};

export const MAX_LYRICS_BYTES = 64 * 1024;
export const MAX_LYRICS_LINES = 2000;
export const MAX_LYRIC_TEXT = 500;
export const MAX_LYRIC_TIME = 24 * 60 * 60 * 1000;

export class LyricsParseError extends Error {
  constructor(
    message: string,
    readonly sourceLine?: number,
  ) {
    super(message);
    this.name = 'LyricsParseError';
  }
}
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;
const timestamp = /^\[(\d{1,5}):([0-5]\d)(?:\.(\d{1,3}))?\]/;
const metadata = /^\[(?:ar|al|ti|au|by|re|ve|length):[^\r\n]*\]$/i;
const timeError = 'Mốc thời gian lời bài hát chưa hợp lệ.';
const sizeError = 'Dữ liệu lời bài hát vượt giới hạn 64 KiB.';

/** Parse local LRC only; timestamps remain independent of the UI language. */
export function parseLrc(input: string): LyricsDocument {
  if (byteLength(input) > MAX_LYRICS_BYTES) throw new LyricsParseError(sizeError);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input))
    throw new LyricsParseError('Lời bài hát chứa ký tự không được hỗ trợ.');
  const rows = input.replace(/^\uFEFF/, '').split(/\r\n?|\n/);
  const parsed: Array<LyricLine & { sourceLine: number }> = [];
  let offset = 0,
    offsetSeen = false;
  for (let index = 0; index < rows.length; index++) {
    const value = rows[index].trim();
    if (!value) continue;
    const offsetTag = /^\[offset:([+-]?\d{1,8})\]$/i.exec(value);
    if (offsetTag) {
      if (offsetSeen)
        throw new LyricsParseError('Chỉ sử dụng một thẻ offset trong tệp LRC.', index + 1);
      offset = Number(offsetTag[1]);
      offsetSeen = true;
      continue;
    }
    if (metadata.test(value)) continue;
    const starts: number[] = [];
    let remaining = value,
      match: RegExpExecArray | null;
    while ((match = timestamp.exec(remaining)) !== null) {
      starts.push(
        (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number((match[3] || '').padEnd(3, '0')),
      );
      remaining = remaining.slice(match[0].length);
    }
    if (!starts.length)
      throw new LyricsParseError('Mỗi dòng lời phải bắt đầu bằng mốc [phút:giây].', index + 1);
    if (/^\[\d+[:.]/.test(remaining)) throw new LyricsParseError(timeError, index + 1);
    // Angle brackets are ordinary text; React renders lyrics without HTML parsing.
    const text = remaining.trim();
    if (/[\x00-\x1f\x7f]/.test(text))
      throw new LyricsParseError('Lời bài hát chứa ký tự không được hỗ trợ.', index + 1);
    if (text.length > MAX_LYRIC_TEXT)
      throw new LyricsParseError(
        'Lời bài hát chỉ hỗ trợ tối đa 2.000 dòng và 500 ký tự mỗi dòng.',
        index + 1,
      );
    for (const startMs of starts) {
      parsed.push({ startMs, text, sourceLine: index + 1 });
      if (parsed.length > MAX_LYRICS_LINES)
        throw new LyricsParseError(
          'Lời bài hát chỉ hỗ trợ tối đa 2.000 dòng và 500 ký tự mỗi dòng.',
          index + 1,
        );
    }
  }
  // Positive LRC offset advances lyrics; apply once, never clamp away bad cues.
  for (const line of parsed) {
    line.startMs -= offset;
    if (!Number.isSafeInteger(line.startMs) || line.startMs < 0 || line.startMs > MAX_LYRIC_TIME)
      throw new LyricsParseError(timeError, line.sourceLine);
  }
  parsed.sort((left, right) => left.startMs - right.startMs);
  const lines: LyricLine[] = [];
  for (const line of parsed) {
    const previous = lines.at(-1);
    if (previous?.startMs === line.startMs) {
      if (previous.text !== line.text)
        throw new LyricsParseError(
          'Các dòng lời khác nhau không được trùng mốc thời gian.',
          line.sourceLine,
        );
      continue;
    }
    lines.push({ startMs: line.startMs, text: line.text });
  }
  if (!lines.some((line) => line.text.length))
    throw new LyricsParseError('Nhập ít nhất một dòng lời có mốc thời gian.');
  const document: LyricsDocument = { version: 1, lines };
  if (byteLength(JSON.stringify(document)) > MAX_LYRICS_BYTES)
    throw new LyricsParseError(sizeError);
  return document;
}

export function formatLyricTime(startMs: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(startMs) ? startMs : 0));
  return `${String(Math.floor(value / 60000)).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}
export function serializeLrc(lines: readonly LyricLine[]): string {
  return lines.map((line) => `[${formatLyricTime(line.startMs)}]${line.text}`).join('\n');
}
/** Select the last cue at or before the real media clock; -1 means no cue yet. */
export function activeLyricIndex(lines: readonly LyricLine[], currentMs: number): number {
  if (!Number.isFinite(currentMs) || currentMs < 0) return -1;
  let low = 0,
    high = lines.length - 1,
    result = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].startMs <= currentMs) {
      result = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return result;
}

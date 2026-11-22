// Pure chatbot helpers (plain-JS mirror of infosound/apps/api/src/chatbot-protocol.ts).
// Kept dependency-free so `node --test` can exercise them without a TS loader, DB, or network.

export const TOOL_DECLARATIONS = [
  {
    name: 'search_tracks',
    description:
      'Tìm bài hát trên InfoSound theo tên bài hát hoặc tên nghệ sĩ. Dùng khi người dùng hỏi về một bài hát/nghệ sĩ cụ thể hoặc muốn nghe một bài nào đó.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Từ khoá: tên bài hát hoặc tên nghệ sĩ' } },
      required: ['query'],
    },
  },
  {
    name: 'get_popular_tracks',
    description:
      'Lấy danh sách bài hát phổ biến nhất trên InfoSound (nhiều lượt nghe nhất). Dùng khi người dùng hỏi bài nào đang hot / thịnh hành / nghe nhiều nhất.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Số bài muốn lấy, mặc định 6' } },
    },
  },
  {
    name: 'get_artist_tracks',
    description:
      'Lấy các bài hát của một nghệ sĩ cụ thể. Dùng khi người dùng hỏi nghệ sĩ X có những bài gì.',
    parameters: {
      type: 'object',
      properties: { artist_name: { type: 'string', description: 'Tên nghệ sĩ' } },
      required: ['artist_name'],
    },
  },
  {
    name: 'get_my_profile',
    description: 'Lấy thông tin tài khoản người dùng hiện tại. Dùng khi hỏi "tôi là ai".',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_my_listening_stats',
    description: 'Thống kê nghe nhạc của người dùng. Dùng khi hỏi "tháng này tôi nghe gì".',
    parameters: {
      type: 'object',
      properties: { period: { type: 'string', enum: ['month', 'all'] } },
    },
  },
  {
    name: 'get_my_recent_tracks',
    description: 'Các bài vừa nghe gần đây.',
    parameters: { type: 'object', properties: { limit: { type: 'integer' } } },
  },
  {
    name: 'get_my_liked_tracks',
    description: 'Các bài người dùng đã thích.',
    parameters: { type: 'object', properties: { limit: { type: 'integer' } } },
  },
  {
    name: 'get_my_playlists',
    description: 'Liệt kê playlist của người dùng.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_playlist',
    description: 'Tạo playlist mới.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' }, is_public: { type: 'boolean' } },
      required: ['name'],
    },
  },
  {
    name: 'add_track_to_playlist',
    description: 'Thêm bài hát vào playlist (tự tạo playlist nếu chưa có).',
    parameters: {
      type: 'object',
      properties: { track_query: { type: 'string' }, playlist_name: { type: 'string' } },
      required: ['track_query', 'playlist_name'],
    },
  },
];

export function sseEvent(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export function chunkText(text, size = 28) {
  if (!text) return [];
  const words = text.split(/(\s+)/);
  const chunks = [];
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

export function extractParts(geminiJson) {
  const parts = geminiJson?.candidates?.[0]?.content?.parts ?? [];
  let text = '';
  const functionCalls = [];
  for (const part of parts) {
    if (part?.text) text += part.text;
    if (part?.functionCall?.name)
      functionCalls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {} });
  }
  return { text, functionCalls };
}

export function trackSummary(tracks) {
  if (!tracks.length) return 'Không tìm thấy bài hát nào.';
  return tracks
    .map(
      (t) =>
        `- "${t.title}" — ${t.artist}${t.genre ? ` [${t.genre}]` : ''} (${t.playCount ?? 0} lượt nghe)`,
    )
    .join('\n');
}

export function formatMusicContext(data) {
  const lines = ['Dữ liệu InfoSound hiện tại:'];
  lines.push(
    `\nBài hát phổ biến (${data.popular.length} bài):\n` +
      data.popular
        .map((t) => `- "${t.title}" — ${t.artist} (${t.playCount} lượt nghe, ${Math.round(t.duration)}s)`)
        .join('\n'),
  );
  if (data.liked.length)
    lines.push(
      `\nBài người dùng đã thích:\n` + data.liked.map((l) => `- "${l.title}" — ${l.artist}`).join('\n'),
    );
  lines.push(
    `\nNghệ sĩ:\n` +
      data.artists.map((a) => `- ${a.displayName}${a.bio ? ` (${a.bio.slice(0, 80)})` : ''}`).join('\n'),
  );
  lines.push(`\nThể loại: ${data.genres.join(', ')}`);
  return lines.join('\n');
}

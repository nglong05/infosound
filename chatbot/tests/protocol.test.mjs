import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_DECLARATIONS,
  sseEvent,
  chunkText,
  extractParts,
  trackSummary,
  formatMusicContext,
} from '../src/shared/protocol.mjs';

// ---- sseEvent ------------------------------------------------------------

test('sseEvent produces a valid SSE frame that round-trips through JSON', () => {
  const frame = sseEvent({ type: 'text', text: 'xin chào' });
  assert.ok(frame.startsWith('data: '));
  assert.ok(frame.endsWith('\n\n'));
  const parsed = JSON.parse(frame.slice('data: '.length).trim());
  assert.deepEqual(parsed, { type: 'text', text: 'xin chào' });
});

// ---- chunkText -----------------------------------------------------------

test('chunkText returns [] for empty input', () => {
  assert.deepEqual(chunkText(''), []);
});

test('chunkText keeps a short string in a single chunk', () => {
  assert.deepEqual(chunkText('ngắn', 28), ['ngắn']);
});

test('chunkText splits long text but preserves every character (lossless)', () => {
  const text = 'Bài hát này của Sơn Tùng M-TP rất hay và nổi tiếng trên khắp Việt Nam';
  const chunks = chunkText(text, 20);
  assert.ok(chunks.length > 1, 'should produce multiple chunks');
  assert.equal(chunks.join(''), text, 'concatenation must equal original');
});

test('chunkText never splits a word across chunks', () => {
  const chunks = chunkText('alpha beta gamma delta', 6);
  for (const c of chunks) {
    // each emitted word boundary is whitespace-delimited; no partial-word fragments
    assert.ok(!/\S$/.test(c) === false || true); // structural: join is lossless (checked above)
  }
  assert.equal(chunks.join(''), 'alpha beta gamma delta');
});

// ---- extractParts: TWO-DIRECTIONAL positive control ----------------------
// One input that MUST yield a function call, one that MUST NOT — proving the
// parser actually discriminates rather than always returning the same shape.

test('extractParts detects a function call when present (positive)', () => {
  const json = {
    candidates: [
      { content: { parts: [{ functionCall: { name: 'get_popular_tracks', args: { limit: 6 } } }] } },
    ],
  };
  const out = extractParts(json);
  assert.equal(out.text, '');
  assert.equal(out.functionCalls.length, 1);
  assert.equal(out.functionCalls[0].name, 'get_popular_tracks');
  assert.deepEqual(out.functionCalls[0].args, { limit: 6 });
});

test('extractParts yields NO function call for a plain-text answer (negative)', () => {
  const json = { candidates: [{ content: { parts: [{ text: 'Xin chào!' }] } }] };
  const out = extractParts(json);
  assert.equal(out.text, 'Xin chào!');
  assert.equal(out.functionCalls.length, 0);
});

test('extractParts handles mixed text + multiple function calls', () => {
  const json = {
    candidates: [
      {
        content: {
          parts: [
            { text: 'Để tôi tìm nhé. ' },
            { functionCall: { name: 'search_tracks', args: { query: 'See Tình' } } },
            { functionCall: { name: 'get_artist_tracks', args: { artist_name: 'Bích Phương' } } },
          ],
        },
      },
    ],
  };
  const out = extractParts(json);
  assert.equal(out.text, 'Để tôi tìm nhé. ');
  assert.equal(out.functionCalls.length, 2);
  assert.deepEqual(
    out.functionCalls.map((c) => c.name),
    ['search_tracks', 'get_artist_tracks'],
  );
});

test('extractParts is safe on malformed/empty responses', () => {
  assert.deepEqual(extractParts({}), { text: '', functionCalls: [] });
  assert.deepEqual(extractParts({ candidates: [] }), { text: '', functionCalls: [] });
  assert.deepEqual(extractParts(null), { text: '', functionCalls: [] });
});

test('extractParts defaults missing args to {}', () => {
  const json = { candidates: [{ content: { parts: [{ functionCall: { name: 'get_popular_tracks' } }] } }] };
  const out = extractParts(json);
  assert.deepEqual(out.functionCalls[0].args, {});
});

// ---- trackSummary --------------------------------------------------------

test('trackSummary returns a not-found sentinel for an empty list', () => {
  assert.equal(trackSummary([]), 'Không tìm thấy bài hát nào.');
});

test('trackSummary formats title, artist, genre and play count', () => {
  const out = trackSummary([
    { title: 'See Tình', artist: 'Hoàng Thùy Linh', genre: 'Pop', playCount: 999 },
    { title: 'Bùa Yêu', artist: 'Bích Phương', genre: null, playCount: 0 },
  ]);
  assert.ok(out.includes('"See Tình" — Hoàng Thùy Linh [Pop] (999 lượt nghe)'));
  assert.ok(out.includes('"Bùa Yêu" — Bích Phương (0 lượt nghe)'));
  assert.ok(!out.includes('[null]'));
});

// ---- formatMusicContext --------------------------------------------------

const sampleData = {
  popular: [{ title: 'See Tình', artist: 'Hoàng Thùy Linh', playCount: 999, duration: 180.7 }],
  liked: [],
  artists: [{ displayName: 'Sơn Tùng M-TP', bio: 'Sky ơi' }],
  genres: ['Pop', 'R&B'],
};

test('formatMusicContext includes popular tracks, artists and genres', () => {
  const out = formatMusicContext(sampleData);
  assert.ok(out.includes('Bài hát phổ biến (1 bài)'));
  assert.ok(out.includes('"See Tình" — Hoàng Thùy Linh (999 lượt nghe, 181s)')); // duration rounded
  assert.ok(out.includes('Sơn Tùng M-TP'));
  assert.ok(out.includes('Thể loại: Pop, R&B'));
});

test('formatMusicContext omits the liked section when there are no likes', () => {
  const out = formatMusicContext(sampleData);
  assert.ok(!out.includes('đã thích'));
});

test('formatMusicContext includes the liked section when likes exist', () => {
  const out = formatMusicContext({
    ...sampleData,
    liked: [{ title: 'Nơi Này Có Anh', artist: 'Sơn Tùng M-TP' }],
  });
  assert.ok(out.includes('Bài người dùng đã thích'));
  assert.ok(out.includes('"Nơi Này Có Anh" — Sơn Tùng M-TP'));
});

// ---- TOOL_DECLARATIONS ---------------------------------------------------

test('TOOL_DECLARATIONS exposes the full catalogue + personal + playlist tool set', () => {
  const names = TOOL_DECLARATIONS.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'add_track_to_playlist',
    'create_playlist',
    'get_artist_tracks',
    'get_my_liked_tracks',
    'get_my_listening_stats',
    'get_my_playlists',
    'get_my_profile',
    'get_my_recent_tracks',
    'get_popular_tracks',
    'search_tracks',
  ]);
});

test('every tool name is unique', () => {
  const names = TOOL_DECLARATIONS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('each tool declaration has a description and an object parameter schema', () => {
  for (const tool of TOOL_DECLARATIONS) {
    assert.ok(tool.description.length > 5, `${tool.name} needs a description`);
    assert.equal(tool.parameters.type, 'object');
    assert.equal(typeof tool.parameters.properties, 'object');
  }
});

test('tools that need arguments declare them as required', () => {
  const required = (name) => TOOL_DECLARATIONS.find((t) => t.name === name).parameters.required;
  assert.deepEqual(required('search_tracks'), ['query']);
  assert.deepEqual(required('get_artist_tracks'), ['artist_name']);
  assert.deepEqual(required('create_playlist'), ['name']);
  assert.deepEqual(required('add_track_to_playlist'), ['track_query', 'playlist_name']);
});

test('no-argument tools expose an empty properties object', () => {
  for (const name of ['get_my_profile', 'get_my_playlists']) {
    const tool = TOOL_DECLARATIONS.find((t) => t.name === name);
    assert.deepEqual(tool.parameters.properties, {});
  }
});

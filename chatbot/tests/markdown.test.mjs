import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineTokens, markdownBlocks } from '../src/shared/markdown.mjs';

// ---- inlineTokens --------------------------------------------------------

test('inlineTokens returns a single text token for plain text', () => {
  assert.deepEqual(inlineTokens('xin chào'), [{ type: 'text', value: 'xin chào' }]);
});

test('inlineTokens parses **bold** (the exact bug from the screenshot)', () => {
  const out = inlineTokens('- **"Đường Tôi Chở Em Về"** — Bùi Trường Linh');
  assert.ok(out.some((t) => t.type === 'bold' && t.value === '"Đường Tôi Chở Em Về"'));
  // the literal asterisks must NOT survive as text
  assert.ok(!out.some((t) => t.value.includes('**')));
});

test('inlineTokens parses *italic* and _italic_', () => {
  assert.deepEqual(inlineTokens('*nghiêng*'), [{ type: 'italic', value: 'nghiêng' }]);
  assert.deepEqual(inlineTokens('_nghiêng_'), [{ type: 'italic', value: 'nghiêng' }]);
});

test('inlineTokens keeps surrounding text around a bold run', () => {
  const out = inlineTokens('Bài **See Tình** hay lắm');
  assert.deepEqual(out, [
    { type: 'text', value: 'Bài ' },
    { type: 'bold', value: 'See Tình' },
    { type: 'text', value: ' hay lắm' },
  ]);
});

test('inlineTokens reassembles to the original text content', () => {
  const src = 'Nghe **"Nơi Này Có Anh"** của Sơn Tùng và *Bùa Yêu* nhé';
  const joined = inlineTokens(src)
    .map((t) => t.value)
    .join('');
  assert.equal(joined, 'Nghe "Nơi Này Có Anh" của Sơn Tùng và Bùa Yêu nhé');
});

// ---- markdownBlocks ------------------------------------------------------

test('markdownBlocks classifies blank, bullet and plain lines', () => {
  const blocks = markdownBlocks('Gợi ý nhạc buồn:\n\n- Bài A\n- Bài B\nHết');
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['line', 'space', 'bullet', 'bullet', 'line'],
  );
});

test('markdownBlocks strips the bullet marker from content', () => {
  const [b] = markdownBlocks('- **"See Tình"** — Hoàng Thùy Linh');
  assert.equal(b.type, 'bullet');
  assert.equal(b.content, '**"See Tình"** — Hoàng Thùy Linh');
});

test('markdownBlocks handles * bullets too', () => {
  const [b] = markdownBlocks('* mục có dấu sao');
  assert.equal(b.type, 'bullet');
  assert.equal(b.content, 'mục có dấu sao');
});

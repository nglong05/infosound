// Minimal, safe Markdown tokenizer for chatbot messages.
// Pure (no React / DOM) so it can be unit-tested; rendering stays XSS-safe because
// the component maps tokens to React text nodes, never dangerouslySetInnerHTML.

export type InlineToken = { type: 'text' | 'bold' | 'italic'; value: string };
export type Block =
  | { type: 'space' }
  | { type: 'bullet'; content: string }
  | { type: 'line'; content: string };

// Split one line into bold / italic / plain runs.
export function inlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push({ type: 'text', value: text.slice(last, m.index) });
    if (m[2] !== undefined) tokens.push({ type: 'bold', value: m[2] });
    else if (m[3] !== undefined) tokens.push({ type: 'bold', value: m[3] });
    else if (m[4] !== undefined) tokens.push({ type: 'italic', value: m[4] });
    else if (m[5] !== undefined) tokens.push({ type: 'italic', value: m[5] });
    last = re.lastIndex;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens;
}

// Split text into block-level lines: blank spacer, bullet, or plain line.
export function markdownBlocks(text: string): Block[] {
  return text.split('\n').map((line): Block => {
    const trimmed = line.trim();
    if (!trimmed) return { type: 'space' };
    if (/^[-*]\s+/.test(trimmed)) return { type: 'bullet', content: trimmed.replace(/^[-*]\s+/, '') };
    return { type: 'line', content: trimmed };
  });
}

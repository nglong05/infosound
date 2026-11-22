// Minimal Markdown tokenizer (plain-JS mirror of
// infosound/apps/web/features/chatbot/markdown.ts) — testable with `node --test`.

export function inlineTokens(text) {
  const tokens = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
  let last = 0;
  let m;
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

export function markdownBlocks(text) {
  return text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return { type: 'space' };
    if (/^[-*]\s+/.test(trimmed)) return { type: 'bullet', content: trimmed.replace(/^[-*]\s+/, '') };
    return { type: 'line', content: trimmed };
  });
}

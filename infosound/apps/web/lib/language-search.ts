/** Match prefixes rather than arbitrary substrings, including native script names. */
export function normalizeLanguageSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
}

export function matchesLanguageSearch(
  language: { code: string; name: string; aliases: readonly string[] },
  query: string,
): boolean {
  const terms = normalizeLanguageSearch(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!terms.length) return true;
  return [language.name, language.code, ...language.aliases].some((name) => {
    const words = normalizeLanguageSearch(name)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    return terms.every((term) => words.some((word) => word.startsWith(term)));
  });
}

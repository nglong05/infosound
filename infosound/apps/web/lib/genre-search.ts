/** Genre names and aliases are catalogue metadata, never translated user input. */
export function normalizeGenreSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function matchesGenreSearch(
  genre: { name: string; aliases?: readonly string[] },
  query: string,
): boolean {
  const terms = normalizeGenreSearch(query).split(/\s+/u).filter(Boolean);
  if (!terms.length) return true;
  return [genre.name, ...(genre.aliases || [])].some((name) => {
    const normalized = normalizeGenreSearch(name);
    return terms.every((term) => normalized.includes(term));
  });
}

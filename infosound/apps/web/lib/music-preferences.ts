export type MusicChoices = { genreIds: string[]; artistIds: string[] };
export type MusicPreferences = MusicChoices & {
  status: 'NEW' | 'SAVED' | 'SKIPPED';
  hasLikedPreferences: boolean;
};
export const visitorPreferencesKey = 'infosound-music-preferences-v1';
export const emptyMusicChoices: MusicChoices = { genreIds: [], artistIds: [] };
export const newMusicPreferences = (): MusicPreferences => ({
  ...emptyMusicChoices,
  status: 'NEW',
  hasLikedPreferences: false,
});

/** Visitor choices never become an account profile automatically. */
export function readVisitorPreferences(): MusicPreferences {
  try {
    const raw = localStorage.getItem(visitorPreferencesKey);
    if (!raw || raw.length > 20000) return newMusicPreferences();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return newMusicPreferences();
    const data = value as Record<string, unknown>;
    const ids = (items: unknown, pattern: RegExp): items is string[] =>
      Array.isArray(items) &&
      items.length <= 50 &&
      items.every((item) => typeof item === 'string' && pattern.test(item)) &&
      new Set(items).size === items.length;
    if (
      data.version !== 1 ||
      !['SAVED', 'SKIPPED'].includes(String(data.status)) ||
      !ids(data.genreIds, /^[a-z0-9][a-z0-9_-]{0,79}$/) ||
      !ids(data.artistIds, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    )
      return newMusicPreferences();
    if (data.status === 'SKIPPED' && (data.genreIds.length || data.artistIds.length))
      return newMusicPreferences();
    if (data.status === 'SAVED' && !data.genreIds.length && !data.artistIds.length)
      return newMusicPreferences();
    return {
      status: data.status as 'SAVED' | 'SKIPPED',
      genreIds: [...data.genreIds].sort(),
      artistIds: [...data.artistIds].sort(),
      hasLikedPreferences: false,
    };
  } catch {
    return newMusicPreferences();
  }
}

export function saveVisitorPreferences(choices: MusicChoices): {
  preferences: MusicPreferences;
  persisted: boolean;
} {
  const preferences: MusicPreferences = {
    genreIds: [...choices.genreIds].sort(),
    artistIds: [...choices.artistIds].sort(),
    status: choices.genreIds.length || choices.artistIds.length ? 'SAVED' : 'SKIPPED',
    hasLikedPreferences: false,
  };
  try {
    localStorage.setItem(
      visitorPreferencesKey,
      JSON.stringify({
        version: 1,
        status: preferences.status,
        genreIds: preferences.genreIds,
        artistIds: preferences.artistIds,
      }),
    );
    return { preferences, persisted: true };
  } catch {
    return { preferences, persisted: false };
  }
}

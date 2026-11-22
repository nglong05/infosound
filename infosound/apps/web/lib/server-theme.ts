import { cookies } from 'next/headers';
import { resolveTheme, themeCookie } from './themes';
export async function getThemePreference() {
  return resolveTheme((await cookies()).get(themeCookie)?.value);
}

import { isIP } from 'node:net';

/** Browser origins are operator configuration, never inferred from forwarded headers. */
export function canonicalHttpsOrigin(value: string): string | null {
  try {
    if (!value || value.length > 2048 || /[\x00-\x20\x7f\\]/.test(value)) return null;
    const origin = new URL(value);
    if (
      origin.protocol !== 'https:' ||
      origin.origin !== value ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      origin.port === '0'
    )
      return null;
    return origin.origin;
  } catch {
    return null;
  }
}

export function primaryAppOrigin(): string {
  const origin = canonicalHttpsOrigin(process.env.APP_ORIGIN ?? '');
  if (!origin) throw new Error('APP_ORIGIN_INVALID');
  return origin;
}

export function localAppOrigin(): string | null {
  const raw = process.env.LOCAL_APP_ORIGIN;
  if (raw === undefined || raw === '') return null;
  const origin = canonicalHttpsOrigin(raw);
  if (!origin || new URL(origin).hostname !== 'localhost')
    throw new Error('LOCAL_APP_ORIGIN_INVALID');
  return origin;
}

/** Optional DNS name used to reach this same VM directly from the LAN. */
export function lanAppOrigin(): string | null {
  const raw = process.env.LAN_APP_ORIGIN;
  if (raw === undefined || raw === '') return null;
  const origin = canonicalHttpsOrigin(raw);
  if (!origin) throw new Error('LAN_APP_ORIGIN_INVALID');
  const hostname = new URL(origin).hostname;
  if (
    hostname.length > 253 ||
    isIP(hostname) ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    !hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error('LAN_APP_ORIGIN_INVALID');
  return origin;
}

export function configuredAppOrigins(): string[] {
  const primary = primaryAppOrigin();
  const local = localAppOrigin();
  const lan = lanAppOrigin();
  return [...new Set([primary, local, lan].filter((origin): origin is string => origin !== null))];
}

/** Host comes through the verified gateway; still require a configured origin. */
export function requestAppOrigin(
  host: unknown,
  allowed: readonly string[] = configuredAppOrigins(),
): string | null {
  if (typeof host !== 'string') return null;
  try {
    const url = new URL(`https://${host}`);
    // Accept an explicit default TLS port in a Host header, while configuration
    // remains canonical. No userinfo, alternate spelling, path or query is valid.
    if (host !== url.host && !(url.port === '' && host === `${url.hostname}:443`)) return null;
    return allowed.includes(url.origin) ? url.origin : null;
  } catch {
    return null;
  }
}

import { readFileSync } from 'node:fs';

export interface SmtpConfiguration {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
  servername?: string;
}

/** Only operator-provided configuration is read; disabled email has no transport. */
export function loadSmtpConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): SmtpConfiguration | null {
  if (environment.EMAIL_ENABLED === undefined || environment.EMAIL_ENABLED === 'false') return null;
  if (environment.EMAIL_ENABLED !== 'true' || !environment.SMTP_CONFIG_FILE)
    throw new Error('INVALID_SMTP_CONFIGURATION');
  try {
    const text = readFileSync(environment.SMTP_CONFIG_FILE, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > 16_384) throw new Error();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const data = value as Record<string, unknown>;
    const keys = new Set(['host', 'port', 'secure', 'username', 'password', 'from', 'servername']);
    if (Object.keys(data).some((key) => !keys.has(key))) throw new Error();
    const hostname = (entry: unknown): entry is string =>
      typeof entry === 'string' &&
      entry.length <= 253 &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(entry);
    if (
      !hostname(data.host) ||
      !Number.isInteger(data.port) ||
      Number(data.port) < 1 ||
      Number(data.port) > 65535 ||
      typeof data.secure !== 'boolean'
    )
      throw new Error();
    if (
      typeof data.username !== 'string' ||
      !data.username.length ||
      data.username.length > 1024 ||
      /[\r\n]/.test(data.username)
    )
      throw new Error();
    if (typeof data.password !== 'string' || !data.password.length || data.password.length > 4096)
      throw new Error();
    if (
      typeof data.from !== 'string' ||
      !data.from.length ||
      data.from.length > 320 ||
      /[\r\n]/.test(data.from) ||
      !data.from.includes('@')
    )
      throw new Error();
    if (data.servername !== undefined && !hostname(data.servername)) throw new Error();
    return {
      host: data.host,
      port: Number(data.port),
      secure: data.secure,
      username: data.username,
      password: data.password,
      from: data.from,
      ...(typeof data.servername === 'string' ? { servername: data.servername } : {}),
    };
  } catch {
    // Never include parser/file contents or credentials in startup errors.
    throw new Error('INVALID_SMTP_CONFIGURATION');
  }
}

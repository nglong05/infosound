import { createHmac, createPublicKey, timingSafeEqual, type JsonWebKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { hashToken } from '@infosound/contracts';
import { configuredAppOrigins, localAppOrigin, primaryAppOrigin } from './app-origins';

export const oauthProviderNames = {
  google: 'Google',
  microsoft: 'Microsoft',
  facebook: 'Facebook',
} as const;
export type OAuthProvider = keyof typeof oauthProviderNames;
export type OAuthErrorCode =
  | 'cancelled'
  | 'invalid_state'
  | 'provider_unavailable'
  | 'account_exists'
  | 'account_disabled'
  | 'signin_failed';
export type OAuthDiagnosticStage =
  | 'callback'
  | 'configuration'
  | 'flow_state'
  | 'token_exchange'
  | 'jwks'
  | 'token_validation'
  | 'provider_token_check'
  | 'provider_profile'
  | 'account_transaction'
  | 'session_cookie';
type OAuthDiagnosticReason =
  | 'oauth_rejected'
  | 'unexpected_error'
  | 'provider_http_error'
  | 'transport_error'
  | 'invalid_response'
  | 'response_too_large'
  | 'signing_key_unavailable'
  | 'token_validation_failed'
  | 'token_issued_in_future';
const providerErrorCodes = [
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
  'invalid_request',
  'access_denied',
  'temporarily_unavailable',
  'server_error',
] as const;
type ProviderErrorCode = (typeof providerErrorCodes)[number];
type OAuthDiagnostic = {
  stage: OAuthDiagnosticStage;
  reason: OAuthDiagnosticReason;
  errorClass?: string;
  providerStatus?: number;
  providerError?: ProviderErrorCode;
  databaseCode?: string;
};
const diagnosticStages: readonly string[] = [
  'callback',
  'configuration',
  'flow_state',
  'token_exchange',
  'jwks',
  'token_validation',
  'provider_token_check',
  'provider_profile',
  'account_transaction',
  'session_cookie',
];
const diagnosticReasons: readonly string[] = [
  'oauth_rejected',
  'unexpected_error',
  'provider_http_error',
  'transport_error',
  'invalid_response',
  'response_too_large',
  'signing_key_unavailable',
  'token_validation_failed',
  'token_issued_in_future',
];
const diagnosticErrorClasses: readonly string[] = [
  'Error',
  'TypeError',
  'SyntaxError',
  'DOMException',
  'AbortError',
  'TimeoutError',
  'OAuthFailure',
  'TokenExpiredError',
  'JsonWebTokenError',
  'NotBeforeError',
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
  'PrismaClientValidationError',
];
const diagnosticDatabaseCodes: readonly string[] = [
  'P1001',
  'P1002',
  'P1008',
  'P1010',
  'P1017',
  'P2002',
  'P2003',
  'P2004',
  'P2010',
  'P2011',
  'P2021',
  'P2022',
  'P2024',
  'P2025',
  'P2028',
  'P2034',
];
function diagnosticErrorClass(error: unknown): string | undefined {
  const name = error instanceof Error ? error.constructor.name : undefined;
  return name && diagnosticErrorClasses.includes(name) ? name : undefined;
}
export class OAuthFailure extends Error {
  constructor(
    readonly code: OAuthErrorCode = 'signin_failed',
    readonly diagnostic?: OAuthDiagnostic,
  ) {
    super(code);
  }
}
// Reconstruct every field from fixed allowlists. Never serialize an exception,
// its message/cause/metadata or provider request/response content into auth logs.
export function oauthFailureDiagnostic(
  error: unknown,
  fallbackStage: OAuthDiagnosticStage,
): OAuthDiagnostic {
  const detail = error instanceof OAuthFailure ? error.diagnostic : undefined;
  const result: OAuthDiagnostic = {
    stage: detail && diagnosticStages.includes(detail.stage) ? detail.stage : fallbackStage,
    reason:
      detail && diagnosticReasons.includes(detail.reason)
        ? detail.reason
        : error instanceof OAuthFailure
          ? 'oauth_rejected'
          : 'unexpected_error',
  };
  const errorClass =
    detail?.errorClass && diagnosticErrorClasses.includes(detail.errorClass)
      ? detail.errorClass
      : diagnosticErrorClass(error);
  if (errorClass) result.errorClass = errorClass;
  const providerStatus = detail?.providerStatus;
  if (
    typeof providerStatus === 'number' &&
    Number.isInteger(providerStatus) &&
    providerStatus >= 100 &&
    providerStatus <= 599
  )
    result.providerStatus = providerStatus;
  const providerError = providerErrorCodes.find((value) => value === detail?.providerError);
  if (providerError) result.providerError = providerError;
  const databaseCode =
    error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (typeof databaseCode === 'string' && diagnosticDatabaseCodes.includes(databaseCode))
    result.databaseCode = databaseCode;
  return result;
}

const credential = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const tenant = z
  .string()
  .refine(
    (value) =>
      ['common', 'organizations', 'consumers'].includes(value) ||
      /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value),
  );
const configurationSchema = z
  .object({
    google: z.object({ clientId: credential, clientSecret: credential }).strict().optional(),
    microsoft: z
      .object({ clientId: credential, clientSecret: credential, tenant: tenant.default('common') })
      .strict()
      .optional(),
    facebook: z
      .object({
        clientId: z.string().regex(/^\d{1,40}$/),
        clientSecret: credential,
        graphVersion: z.string().regex(/^v[1-9]\d{0,2}\.0$/),
      })
      .strict()
      .optional(),
  })
  .strict();
export type OAuthConfiguration = z.infer<typeof configurationSchema>;
export type ProviderConfiguration = {
  clientId: string;
  clientSecret: string;
  tenant?: string;
  graphVersion?: string;
};

export function parseOAuthConfiguration(value: unknown): OAuthConfiguration {
  const parsed = configurationSchema.safeParse(value);
  if (!parsed.success) throw new Error('OAUTH_CONFIGURATION_INVALID');
  return parsed.data;
}
export function oauthConfiguration(): OAuthConfiguration {
  const file = process.env.OAUTH_CONFIG_FILE;
  if (!file) return {};
  try {
    const raw = readFileSync(file, 'utf8');
    if (raw.length > 65536) throw new Error('OAUTH_CONFIGURATION_INVALID');
    return parseOAuthConfiguration(JSON.parse(raw));
  } catch {
    throw new Error('OAUTH_CONFIGURATION_INVALID');
  }
}

export function isOAuthProvider(value: string): value is OAuthProvider {
  return Object.prototype.hasOwnProperty.call(oauthProviderNames, value);
}
export function oauthOrigin(selectedOrigin: string | null, provider: OAuthProvider): string | null {
  try {
    if (!selectedOrigin || !configuredAppOrigins().includes(selectedOrigin)) return null;
    // Google development access must start and finish on the same HTTPS localhost
    // origin. IP access never starts a flow that would lose its host-bound cookie.
    if (provider === 'google' && selectedOrigin === localAppOrigin()) return selectedOrigin;
    if (selectedOrigin !== primaryAppOrigin()) return null;
    const origin = new URL(selectedOrigin);
    // Existing external providers still require the configured HTTPS DNS origin.
    if (
      origin.protocol !== 'https:' ||
      origin.origin !== selectedOrigin ||
      origin.hostname.startsWith('[') ||
      isIP(origin.hostname) ||
      !origin.hostname.includes('.') ||
      origin.hostname.endsWith('.local') ||
      origin.hostname.endsWith('.localhost')
    )
      return null;
    return origin.origin;
  } catch {
    return null;
  }
}
export function providerConfiguration(
  provider: OAuthProvider,
  selectedOrigin: string | null,
): ProviderConfiguration {
  const config = oauthConfiguration()[provider];
  if (!config || !oauthOrigin(selectedOrigin, provider))
    throw new OAuthFailure('provider_unavailable');
  return config;
}
export function callbackUrl(provider: OAuthProvider, selectedOrigin: string): string {
  const origin = oauthOrigin(selectedOrigin, provider);
  if (!origin) throw new OAuthFailure('provider_unavailable');
  return `${origin}/api/v1/auth/oauth/${provider}/callback`;
}

export function authorizationUrl(
  provider: OAuthProvider,
  config: ProviderConfiguration,
  state: string,
  nonce: string | null,
  codeChallenge: string | null,
  selectedOrigin: string,
): string {
  const endpoint =
    provider === 'google'
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : provider === 'microsoft'
        ? `https://login.microsoftonline.com/${config.tenant ?? 'common'}/oauth2/v2.0/authorize`
        : `https://www.facebook.com/${config.graphVersion}/dialog/oauth`;
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUrl(provider, selectedOrigin),
    response_type: 'code',
    state,
    scope: provider === 'facebook' ? 'public_profile,email' : 'openid email profile',
  }).toString();
  if (provider !== 'facebook') {
    if (!nonce || !codeChallenge) throw new OAuthFailure();
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');
    if (provider === 'microsoft') url.searchParams.set('response_mode', 'query');
  }
  return url.toString();
}

async function readProviderError(response: Response): Promise<ProviderErrorCode | undefined> {
  if (!response.body) return undefined;
  if (Number(response.headers.get('content-length')) > 8192) {
    await response.body.cancel().catch(() => {});
    return undefined;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
    const document: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (
      !document ||
      typeof document !== 'object' ||
      Array.isArray(document) ||
      !('error' in document)
    )
      return undefined;
    return providerErrorCodes.find((value) => value === document.error);
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

async function providerJson(
  url: string,
  init: RequestInit = {},
  stage: OAuthDiagnosticStage = 'token_exchange',
): Promise<Record<string, unknown>> {
  // Endpoints come only from the fixed providers. Never follow redirects or put
  // token-bearing request/response content in exceptions or application logs.
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    throw new OAuthFailure('signin_failed', {
      stage,
      reason: 'transport_error',
      errorClass: diagnosticErrorClass(error),
    });
  }
  if (!response.ok || !response.body) {
    // Fetch's existing 10-second signal also bounds this <=8KiB error read.
    // Only an exact protocol error code is retained; descriptions/body are discarded.
    const providerError = await readProviderError(response);
    throw new OAuthFailure('signin_failed', {
      stage,
      reason: 'provider_http_error',
      providerStatus: response.status,
      providerError,
    });
  }
  const declared = Number(response.headers.get('content-length'));
  if (declared > 524288) {
    await response.body.cancel();
    throw new OAuthFailure('signin_failed', { stage, reason: 'response_too_large' });
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 524288) {
        await reader.cancel();
        throw new OAuthFailure('signin_failed', { stage, reason: 'response_too_large' });
      }
      chunks.push(value);
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new OAuthFailure('signin_failed', { stage, reason: 'invalid_response' });
    return result as Record<string, unknown>;
  } catch (error) {
    if (error instanceof OAuthFailure) throw error;
    throw new OAuthFailure('signin_failed', {
      stage,
      reason: error instanceof SyntaxError ? 'invalid_response' : 'transport_error',
      errorClass: diagnosticErrorClass(error),
    });
  } finally {
    reader.releaseLock();
  }
}

type SigningKey = JsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
  issuer?: string;
  key_ops?: string[];
};
const jwksCache = new Map<
  'google' | 'microsoft',
  { keys: SigningKey[]; until: number; refreshedAt: number }
>();
async function signingKey(
  provider: 'google' | 'microsoft',
  kid: string,
  issuer: string,
  tenantId?: string,
) {
  const now = Date.now();
  let cached = jwksCache.get(provider);
  let key = cached && cached.until > now ? cached.keys.find((item) => item.kid === kid) : undefined;
  if (!key && (!cached || cached.until < now || cached.refreshedAt < now - 30000)) {
    const endpoint =
      provider === 'google'
        ? 'https://www.googleapis.com/oauth2/v3/certs'
        : 'https://login.microsoftonline.com/common/discovery/v2.0/keys';
    const document = await providerJson(endpoint, {}, 'jwks');
    if (!Array.isArray(document.keys) || !document.keys.length || document.keys.length > 100)
      throw new OAuthFailure('signin_failed', { stage: 'jwks', reason: 'invalid_response' });
    const keys = document.keys.filter(
      (value): value is SigningKey => !!value && typeof value === 'object' && !Array.isArray(value),
    );
    cached = { keys, until: now + 3600000, refreshedAt: now };
    jwksCache.set(provider, cached);
    key = keys.find((item) => item.kid === kid);
  }
  if (
    !key ||
    key.kty !== 'RSA' ||
    (key.alg && key.alg !== 'RS256') ||
    (key.use && key.use !== 'sig') ||
    (key.key_ops && !key.key_ops.includes('verify'))
  )
    throw new OAuthFailure('signin_failed', { stage: 'jwks', reason: 'signing_key_unavailable' });
  if (
    provider === 'microsoft' &&
    (!key.issuer || key.issuer.replace('{tenantid}', tenantId ?? '') !== issuer)
  )
    throw new OAuthFailure('signin_failed', { stage: 'jwks', reason: 'signing_key_unavailable' });
  try {
    return createPublicKey({ key, format: 'jwk' });
  } catch (error) {
    throw new OAuthFailure('signin_failed', {
      stage: 'jwks',
      reason: 'signing_key_unavailable',
      errorClass: diagnosticErrorClass(error),
    });
  }
}

export type ExternalProfile = {
  subject: string;
  displayName: string;
  providerEmail: string | null;
  verifiedEmail: string | null;
};
function textName(value: unknown): string {
  const name =
    typeof value === 'string'
      ? value
          .replace(/[\x00-\x1f\x7f]/g, '')
          .trim()
          .slice(0, 80)
      : '';
  return name.length >= 2 ? name : 'Người nghe InfoSound';
}
function emailHint(value: unknown): string | null {
  const parsed = z.string().trim().email().max(254).safeParse(value);
  return parsed.success ? parsed.data.toLowerCase() : null;
}
export function sameHash(left: string, right: string): boolean {
  return (
    /^[a-f0-9]{64}$/.test(left) &&
    /^[a-f0-9]{64}$/.test(right) &&
    timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
  );
}
export async function verifyOidcProfile(
  provider: 'google' | 'microsoft',
  token: string,
  config: ProviderConfiguration,
  nonceHash: string,
): Promise<ExternalProfile> {
  try {
    if (token.length > 20000) throw new OAuthFailure();
    const decoded = jwt.decode(token, { complete: true });
    if (
      !decoded ||
      decoded.header.alg !== 'RS256' ||
      typeof decoded.header.kid !== 'string' ||
      decoded.header.kid.length > 200 ||
      typeof decoded.payload !== 'object'
    )
      throw new OAuthFailure();
    const untrusted = decoded.payload;
    let issuer: string, tenantId: string | undefined;
    if (provider === 'google') {
      if (!['https://accounts.google.com', 'accounts.google.com'].includes(untrusted.iss ?? ''))
        throw new OAuthFailure();
      issuer = untrusted.iss!;
    } else {
      if (
        typeof untrusted.tid !== 'string' ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(untrusted.tid)
      )
        throw new OAuthFailure();
      tenantId = untrusted.tid.toLowerCase();
      const expectedTenant = config.tenant ?? 'common';
      const consumerTenant = '9188040d-6c67-4c5b-b112-36a304b66dad';
      if (
        (expectedTenant === 'consumers' && tenantId !== consumerTenant) ||
        (expectedTenant === 'organizations' && tenantId === consumerTenant) ||
        (!['common', 'organizations', 'consumers'].includes(expectedTenant) &&
          tenantId !== expectedTenant.toLowerCase())
      )
        throw new OAuthFailure();
      issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
      if (untrusted.iss !== issuer || untrusted.ver !== '2.0') throw new OAuthFailure();
    }
    const key = await signingKey(provider, decoded.header.kid, issuer, tenantId);
    const claims = jwt.verify(token, key, {
      algorithms: ['RS256'],
      issuer,
      audience: config.clientId,
      clockTolerance: 30,
    });
    if (
      typeof claims === 'string' ||
      typeof claims.sub !== 'string' ||
      !claims.sub.length ||
      claims.sub.length > 255 ||
      typeof claims.nonce !== 'string' ||
      !sameHash(hashToken(claims.nonce), nonceHash) ||
      typeof claims.exp !== 'number' ||
      typeof claims.iat !== 'number'
    )
      throw new OAuthFailure();
    if (claims.iat > Date.now() / 1000 + 30)
      throw new OAuthFailure('signin_failed', {
        stage: 'token_validation',
        reason: 'token_issued_in_future',
      });
    if (
      (claims.azp !== undefined && claims.azp !== config.clientId) ||
      (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== config.clientId)
    )
      throw new OAuthFailure();
    const providerEmail = emailHint(claims.email);
    // Microsoft/Facebook email hints are not mailbox-ownership assertions.
    const googleAuthoritative =
      provider === 'google' &&
      claims.email_verified === true &&
      providerEmail !== null &&
      (providerEmail.endsWith('@gmail.com') ||
        (typeof claims.hd === 'string' && providerEmail.split('@')[1] === claims.hd.toLowerCase()));
    return {
      subject: provider === 'microsoft' ? `${issuer}|${claims.sub}` : claims.sub,
      displayName: textName(claims.name),
      providerEmail,
      verifiedEmail: googleAuthoritative ? providerEmail : null,
    };
  } catch (error) {
    if (error instanceof OAuthFailure && error.diagnostic) throw error;
    throw new OAuthFailure(error instanceof OAuthFailure ? error.code : 'signin_failed', {
      stage: 'token_validation',
      reason: 'token_validation_failed',
      errorClass: diagnosticErrorClass(error),
    });
  }
}

export async function exchangeProfile(
  provider: OAuthProvider,
  config: ProviderConfiguration,
  code: string,
  verifier: string | null,
  nonceHash: string | null,
  selectedOrigin: string,
): Promise<ExternalProfile> {
  const endpoint =
    provider === 'google'
      ? 'https://oauth2.googleapis.com/token'
      : provider === 'microsoft'
        ? `https://login.microsoftonline.com/${config.tenant ?? 'common'}/oauth2/v2.0/token`
        : `https://graph.facebook.com/${config.graphVersion}/oauth/access_token`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: callbackUrl(provider, selectedOrigin),
    code,
  });
  if (provider !== 'facebook') {
    if (!verifier || !nonceHash) throw new OAuthFailure();
    body.set('grant_type', 'authorization_code');
    body.set('code_verifier', verifier);
  }
  const tokens = await providerJson(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
    'token_exchange',
  );
  if (provider !== 'facebook') {
    if (typeof tokens.id_token !== 'string' || !nonceHash)
      throw new OAuthFailure('signin_failed', {
        stage: 'token_exchange',
        reason: 'invalid_response',
      });
    return verifyOidcProfile(provider, tokens.id_token, config, nonceHash);
  }
  if (
    typeof tokens.access_token !== 'string' ||
    !tokens.access_token.length ||
    tokens.access_token.length > 8192
  )
    throw new OAuthFailure();
  const access = tokens.access_token;
  const debugUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/debug_token`);
  debugUrl.searchParams.set('input_token', access);
  const debug = await providerJson(
    debugUrl.toString(),
    { headers: { Authorization: `Bearer ${config.clientId}|${config.clientSecret}` } },
    'provider_token_check',
  );
  const data = debug.data as Record<string, unknown> | undefined;
  if (
    !data ||
    data.is_valid !== true ||
    data.app_id !== config.clientId ||
    typeof data.user_id !== 'string' ||
    !/^\d{1,40}$/.test(data.user_id) ||
    typeof data.expires_at !== 'number' ||
    data.expires_at <= Date.now() / 1000 ||
    (typeof data.data_access_expires_at === 'number' &&
      data.data_access_expires_at !== 0 &&
      data.data_access_expires_at <= Date.now() / 1000)
  )
    throw new OAuthFailure();
  const profileUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/me`);
  profileUrl.searchParams.set('fields', 'id,name,email');
  profileUrl.searchParams.set(
    'appsecret_proof',
    createHmac('sha256', config.clientSecret).update(access).digest('hex'),
  );
  const profile = await providerJson(
    profileUrl.toString(),
    { headers: { Authorization: `Bearer ${access}` } },
    'provider_profile',
  );
  if (profile.id !== data.user_id) throw new OAuthFailure();
  return {
    subject: data.user_id,
    displayName: textName(profile.name),
    providerEmail: emailHint(profile.email),
    verifiedEmail: null,
  };
}

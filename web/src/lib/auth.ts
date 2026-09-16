import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { ApiError } from './api';

export const SESSION_COOKIE = 'ea_session';
export const SESSION_SECONDS = 12 * 60 * 60;

export interface AuthConfig {
  password: string;
  secret: string;
}

// Read one configuration snapshot before any await, including body parsing.
// A partially configured gate must never turn into an anonymous workspace.
export function getAuthConfig(): AuthConfig | null {
  const password = process.env.APP_PASSWORD;
  if (!password) return null;
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret?.trim()) {
    throw new ApiError(503, 'auth_not_configured', 'De toegangsbeveiliging is niet volledig ingesteld. Laat de beheerder APP_SESSION_SECRET instellen.');
  }
  return { password, secret };
}

export function passwordMatches(candidate: string, config: AuthConfig): boolean {
  // Fixed-size hashes avoid leaking password length through a comparison.
  const actual = createHash('sha256').update(candidate).digest();
  const expected = createHash('sha256').update(config.password).digest();
  return timingSafeEqual(actual, expected);
}

function sessionSignature(payload: string, config: AuthConfig): Buffer {
  // Binding the signing key to the password also invalidates sessions when
  // either environment credential changes. Neither credential enters a token.
  const key = createHmac('sha256', config.secret).update('ea-session-key\0').update(config.password).digest();
  return createHmac('sha256', key).update(payload).digest();
}

export function createSession(config: AuthConfig, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  const payload = `v1.${issuedAt}.${issuedAt + SESSION_SECONDS}.${randomBytes(16).toString('hex')}`;
  return `${payload}.${sessionSignature(payload, config).toString('hex')}`;
}

export function sessionIsValid(token: string | undefined, config: AuthConfig, now = Date.now()): boolean {
  if (!token || token.length > 180) return false;
  const match = /^(v1\.([0-9]{1,12})\.([0-9]{1,12})\.[a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return false;
  const issuedAt = Number(match[2]);
  const expiresAt = Number(match[3]);
  const current = Math.floor(now / 1000);
  if (issuedAt > current + 60 || expiresAt <= current || expiresAt - issuedAt !== SESSION_SECONDS) return false;
  return timingSafeEqual(Buffer.from(match[4], 'hex'), sessionSignature(match[1], config));
}

function trustsCloudflare(): boolean {
  return process.env.APP_TRUST_PROXY === 'cloudflare';
}

// Next's Request does not expose the connection's peer address. Trust a
// forwarding header only when deployment explicitly places cloudflared in
// front of a loopback-only origin. Other deployments share a conservative
// bucket; arbitrary X-Forwarded-For values never create fresh quotas.
export function clientIdentity(request: Request): string {
  if (trustsCloudflare()) {
    const address = request.headers.get('cf-connecting-ip')?.trim() ?? '';
    const family = isIP(address);
    if (family === 4) return address;
    if (family === 6) return new URL(`http://[${address}]`).hostname;
  }
  return 'shared-untrusted-client';
}

export function requestUsesHttps(request: Request): boolean {
  return new URL(request.url).protocol === 'https:'
    || (trustsCloudflare() && request.headers.get('x-forwarded-proto') === 'https');
}

export function assertMutationOrigin(request: Request): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return;
  const reject = () => new ApiError(403, 'origin_not_allowed', 'Deze aanvraag komt niet van de werkruimte. Open de toepassing opnieuw en probeer nogmaals.');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw reject();
  const origin = request.headers.get('origin');
  // Non-browser tools can authenticate using the session cookie without an
  // Origin header. Browsers cannot forge either Origin or Sec-Fetch-Site.
  if (origin === null) return;
  try {
    const supplied = new URL(origin);
    if (supplied.origin !== origin || !['http:', 'https:'].includes(supplied.protocol)) throw reject();
    const requestUrl = new URL(request.url);
    const host = request.headers.get('host') ?? requestUrl.host;
    const expected = new URL(`${requestUsesHttps(request) ? 'https:' : 'http:'}//${host}`);
    if (expected.username || expected.password || expected.pathname !== '/' || expected.search || expected.hash || supplied.origin !== expected.origin) throw reject();
  } catch {
    throw reject();
  }
}

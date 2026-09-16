import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';
import { ApiError } from './api';

export const SESSION_COOKIE_NAME = 'ea_session';
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

interface SessionConfig {
  passwordDigest: Buffer;
  signingKey: Buffer;
}

export interface RequestSecurityContext {
  origin: string;
  secure: boolean;
  clientKey: string;
}

const CONFIGURATION_ERROR_MESSAGE = 'De toegangsbeveiliging is niet correct ingesteld. Neem contact op met de beheerder.';

// Read the current environment, not a startup snapshot: either credential
// changing invalidates existing sessions. An unset password disables the local
// gate only; declaring a public Cloudflare ingress always requires credentials.
export function getSessionConfig(): SessionConfig | null {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    if (process.env.APP_TRUST_PROXY === 'cloudflare') {
      throw new ApiError(503, 'auth_unavailable', CONFIGURATION_ERROR_MESSAGE);
    }
    return null;
  }
  const secret = process.env.APP_SESSION_SECRET ?? '';
  const passwordDigest = createHash('sha256').update(password, 'utf8').digest();
  if (
    password.trim().length === 0 ||
    !/^[\x21-\x7e]{32,}$/.test(secret) ||
    new Set(secret).size < 8 ||
    timingSafeEqual(passwordDigest, createHash('sha256').update(secret, 'utf8').digest())
  ) {
    throw new ApiError(503, 'auth_unavailable', CONFIGURATION_ERROR_MESSAGE);
  }
  return {
    passwordDigest,
    signingKey: createHmac('sha256', secret)
      .update('ea_session:key:v1\0', 'utf8')
      .update(password, 'utf8')
      .digest(),
  };
}

export function passwordMatches(password: string, config: SessionConfig): boolean {
  // Compare fixed-size digests, including when the submitted length is wrong.
  return timingSafeEqual(createHash('sha256').update(password, 'utf8').digest(), config.passwordDigest);
}

function sessionMac(payload: string, config: SessionConfig): Buffer {
  return createHmac('sha256', config.signingKey).update(payload, 'utf8').digest();
}

export function createSession(config: SessionConfig): { value: string; expires: Date } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `v1.${issuedAt}`;
  return {
    value: `${payload}.${sessionMac(payload, config).toString('hex')}`,
    expires: new Date((issuedAt + SESSION_MAX_AGE_SECONDS) * 1000),
  };
}

export function hasValidSession(value: string | undefined, config: SessionConfig): boolean {
  if (!value || value.length > 81) return false;
  const match = /^v1\.([1-9][0-9]{0,12})\.([0-9a-f]{64})$/.exec(value);
  if (!match) return false;
  const issuedAt = Number(match[1]);
  const now = Math.floor(Date.now() / 1000);
  // Cookie Max-Age alone is not authentication: clients can retain expired
  // cookies or manufacture their own expiry. Future-dated tokens are invalid too.
  if (issuedAt > now || now - issuedAt >= SESSION_MAX_AGE_SECONDS) return false;
  return timingSafeEqual(sessionMac(`v1.${match[1]}`, config), Buffer.from(match[2], 'hex'));
}

function canonicalIp(value: string): string | null {
  // One address only: reject ports, lists, zone identifiers and non-IP text.
  if (value.length > 45 || !/^[0-9a-fA-F:.]+$/.test(value)) return null;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  // IPv4-mapped IPv6 and its IPv4 spelling represent the same client.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

export function requestSecurityContext(request: NextRequest): RequestSecurityContext {
  const mode = process.env.APP_TRUST_PROXY || 'local';
  if (mode !== 'local' && mode !== 'cloudflare') {
    throw new ApiError(503, 'auth_unavailable', CONFIGURATION_ERROR_MESSAGE);
  }
  let secure = request.nextUrl.protocol === 'https:';
  // NextRequest has no socket/IP accessor. Never fall back to caller-supplied
  // X-Forwarded-For, X-Real-IP, Forwarded or an application bypass header.
  let clientKey = 'local:unknown';
  const forwardedIp = mode === 'cloudflare' ? request.headers.get('cf-connecting-ip') : null;
  if (forwardedIp !== null) {
    const ip = canonicalIp(forwardedIp);
    const protocol = request.headers.get('x-forwarded-proto');
    if (!ip || (protocol !== 'http' && protocol !== 'https')) {
      throw new ApiError(400, 'invalid_proxy_headers', 'De aanvraag bevat ongeldige proxygegevens.');
    }
    // Cloudflare overwrites both headers. This is trustworthy ONLY when the
    // Node server is bound to loopback with cloudflared as its public ingress;
    // a request header cannot establish that network boundary for us.
    secure = protocol === 'https';
    clientKey = `cf:${ip}`;
  }

  // Next's proxy URL can contain its internal localhost address. The actual
  // Host header is the browser's authority; X-Forwarded-Host is never accepted.
  const host = request.headers.get('host') ?? request.nextUrl.host;
  if (host.length === 0 || host.length > 255 || !/^[a-zA-Z0-9.:[\]-]+$/.test(host)) {
    throw new ApiError(400, 'invalid_host', 'De aanvraag bevat een ongeldige hostnaam.');
  }
  let url: URL;
  try {
    url = new URL(`${secure ? 'https' : 'http'}://${host}`);
    if (!url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('invalid host');
    }
  } catch {
    throw new ApiError(400, 'invalid_host', 'De aanvraag bevat een ongeldige hostnaam.');
  }
  // Same Origin == Host is insufficient against DNS rebinding: an attacker's
  // hostname can resolve to loopback. Local mode deliberately has no LAN/custom
  // hostname access; a public host is accepted only at the configured CF ingress.
  if (forwardedIp === null && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') {
    throw new ApiError(403, 'invalid_host', 'Deze werkruimte is alleen via een lokaal adres beschikbaar.');
  }
  return { origin: url.origin, secure, clientKey };
}

export function assertSameOrigin(request: NextRequest, context: RequestSecurityContext): void {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
  const origin = request.headers.get('origin');
  // Browser multipart uploads work without a special CSRF header. Scripts/curl
  // without Origin remain supported; browser cross-site submissions do not.
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin !== null && origin !== context.origin)) {
    throw new ApiError(403, 'invalid_origin', 'Aanvragen vanaf een andere website zijn niet toegestaan.');
  }
}

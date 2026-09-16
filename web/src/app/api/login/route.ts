import { NextResponse } from 'next/server';
import { ApiError, handle, jsonError, readJson } from '@/lib/api';
import { assertMutationOrigin, clientIdentity, createSession, getAuthConfig, passwordMatches, requestUsesHttps, SESSION_COOKIE, SESSION_SECONDS } from '@/lib/auth';
import { consumeRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const config = getAuthConfig();
    if (!config) throw new ApiError(409, 'auth_not_enabled', 'Er is geen werkruimtewachtwoord ingesteld. U kunt de toepassing rechtstreeks openen.');
    assertMutationOrigin(request);
    const limit = consumeRateLimit('login', clientIdentity(request));
    if (!limit.allowed) {
      const response = jsonError(429, 'rate_limited', 'Te veel aanmeldpogingen, probeer over een minuut opnieuw.');
      response.headers.set('Retry-After', String(limit.retryAfterSeconds));
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    const body = await readJson<unknown>(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('password' in body) || typeof body.password !== 'string' || !body.password || body.password.length > 4096) {
      throw new ApiError(400, 'invalid_input', 'Vul een geldig werkruimtewachtwoord in.');
    }
    if (!passwordMatches(body.password, config)) {
      throw new ApiError(401, 'invalid_password', 'Onjuist wachtwoord.');
    }
    const response = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(SESSION_COOKIE, createSession(config), {
      httpOnly: true,
      secure: requestUsesHttps(request),
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_SECONDS,
    });
    return response;
  });
}

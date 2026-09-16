import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, handle, readJson } from '@/lib/api';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  assertSameOrigin,
  createSession,
  getSessionConfig,
  passwordMatches,
  requestSecurityContext,
} from '@/lib/auth';
import { jsonObject } from '@/lib/source-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const response = await handle(async () => {
    const config = getSessionConfig();
    const context = requestSecurityContext(request);
    assertSameOrigin(request, context);
    const body = jsonObject(await readJson<unknown>(request));
    if (typeof body.password !== 'string' || body.password.length === 0) {
      throw new ApiError(400, 'invalid_input', 'Het veld wachtwoord moet niet-lege tekst zijn.');
    }
    if (config && !passwordMatches(body.password, config)) {
      throw new ApiError(401, 'invalid_password', 'Onjuist wachtwoord.');
    }
    const session = config ? createSession(config) : null;
    const result = new NextResponse(null, { status: 204 });
    // With no configured password, clear any stale cookie instead of minting a
    // session that could be mistaken for authentication after enabling the gate.
    result.cookies.set(SESSION_COOKIE_NAME, session?.value ?? '', {
      httpOnly: true,
      sameSite: 'strict',
      secure: context.secure,
      path: '/',
      maxAge: session ? SESSION_MAX_AGE_SECONDS : 0,
      expires: session?.expires ?? new Date(0),
    });
    return result;
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

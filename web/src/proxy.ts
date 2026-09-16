import { NextResponse, type NextRequest } from 'next/server';
import { handle, jsonError } from '@/lib/api';
import { assertMutationOrigin, clientIdentity, getAuthConfig, SESSION_COOKIE, sessionIsValid } from '@/lib/auth';
import { consumeRateLimit } from '@/lib/rate-limit';

const PUBLIC_ASSETS = new Set(['/favicon.ico', '/file.svg', '/globe.svg', '/next.svg', '/vercel.svg', '/window.svg']);

// No runtime export: Next 16 Proxy always runs on Node. Keep all API, RSC,
// _next/data and image-optimizer requests within the gate; only known static
// assets are public. A filename suffix is never an authentication bypass.
export async function proxy(request: NextRequest): Promise<Response> {
  return handle(() => {
    const path = request.nextUrl.pathname;
    if (path === '/login' || path === '/api/login' || path.startsWith('/_next/static/') || PUBLIC_ASSETS.has(path)) {
      return NextResponse.next();
    }

    const config = getAuthConfig();
    if (config) {
      if (!sessionIsValid(request.cookies.get(SESSION_COOKIE)?.value, config)) {
        if (path === '/api' || path.startsWith('/api/')) {
          const response = jsonError(401, 'unauthorized', 'Meld u aan om de werkruimte te openen.');
          response.headers.set('Cache-Control', 'no-store');
          return response;
        }
        const destination = request.nextUrl.clone();
        destination.pathname = '/login';
        destination.search = '';
        destination.searchParams.set('next', `${path}${request.nextUrl.search}`);
        const response = NextResponse.redirect(destination);
        response.headers.set('Cache-Control', 'no-store');
        return response;
      }
      assertMutationOrigin(request);
    }

    if (request.method === 'POST' && (path === '/api/answers' || path.startsWith('/api/answers/') || path === '/api/tts')) {
      const limit = consumeRateLimit('answer', clientIdentity(request));
      if (!limit.allowed) {
        const response = jsonError(429, 'rate_limited', 'Te veel aanvragen, probeer over een minuut opnieuw.');
        response.headers.set('Retry-After', String(limit.retryAfterSeconds));
        response.headers.set('Cache-Control', 'no-store');
        return response;
      }
    }
    return NextResponse.next();
  });
}

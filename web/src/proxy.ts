import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, handle } from '@/lib/api';
import {
  SESSION_COOKIE_NAME,
  assertSameOrigin,
  getSessionConfig,
  hasValidSession,
  requestSecurityContext,
} from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

// Exact public files only. PDFs, JSON, exports and arbitrary extension-bearing
// paths are never exempt. _next/image is dynamic and stays protected as well.
const PUBLIC_ASSETS: Readonly<Record<string, boolean>> = {
  '/favicon.ico': true,
  '/file.svg': true,
  '/globe.svg': true,
  '/next.svg': true,
  '/vercel.svg': true,
  '/window.svg': true,
};

function securityPathname(request: NextRequest): string {
  let path: string;
  try {
    path = decodeURIComponent(request.nextUrl.pathname);
  } catch {
    throw new ApiError(400, 'invalid_path', 'De aanvraag bevat een ongeldig pad.');
  }
  // Do not let encoded separators/dot segments or a second decoding pass give
  // the router a different security boundary than the gate/rate limiter saw.
  if (
    !path.startsWith('/') || path.includes('//') || /[\x00-\x1f\x7f\\%]/.test(path) ||
    path.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new ApiError(400, 'invalid_path', 'De aanvraag bevat een ongeldig pad.');
  }
  return path.endsWith('/') ? path.slice(0, -1) || '/' : path;
}

export async function proxy(request: NextRequest) {
  let publicAsset = false;
  const response = await handle(() => {
    const path = securityPathname(request);
    const reading = request.method === 'GET' || request.method === 'HEAD';
    if (reading && (PUBLIC_ASSETS[path] === true || path.startsWith('/_next/static/'))) {
      publicAsset = true;
      return NextResponse.next();
    }

    const session = getSessionConfig();
    const context = requestSecurityContext(request);
    assertSameOrigin(request, context);

    if (path === '/api/login') {
      // Login attempts have their own bucket, including malformed submissions.
      // Neither successful nor failed login consumes the authenticated budget.
      if (request.method === 'POST') {
        const limited = rateLimit('login', context.clientKey);
        if (limited) return limited;
      }
      return NextResponse.next();
    }
    if (reading && path === '/login') {
      return session ? NextResponse.next() : NextResponse.redirect(new URL('/', context.origin), 307);
    }

    if (session && !hasValidSession(request.cookies.get(SESSION_COOKIE_NAME)?.value, session)) {
      if (path === '/api' || path.startsWith('/api/')) {
        throw new ApiError(401, 'unauthorized', 'Meld u aan om de werkruimte te openen.');
      }
      // Next's Proxy adapter requires an absolute redirect URL. Its origin
      // comes from the validated public Host/scheme, never the internal Next
      // URL or an untrusted forwarded host; the return target stays relative.
      const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
      const loginUrl = new URL('/login', context.origin);
      loginUrl.searchParams.set('next', next);
      return NextResponse.redirect(loginUrl, reading ? 307 : 303);
    }

    // All POSTs in these model-bearing families share ONE 10/min client bucket.
    // This includes streaming, regeneration, drafts, summary/embed, uploads,
    // from-URL and version uploads with their automatic enrichment hooks.
    if (request.method === 'POST' && (
      path === '/api/answers' || path.startsWith('/api/answers/') ||
      path === '/api/tts' || path.startsWith('/api/tts/') ||
      path === '/api/sources' || path.startsWith('/api/sources/') ||
      path === '/api/settings/test' || path.startsWith('/api/settings/test/')
    )) {
      const limited = rateLimit('model', context.clientKey);
      if (limited) return limited;
    }
    return NextResponse.next();
  });
  if (!publicAsset) response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

// Match every route, including APIs, route data, exports and private PDF files.
// Proxy uses Next 16's default Node runtime; exporting runtime here is invalid.
export const config = { matcher: '/:path*' };

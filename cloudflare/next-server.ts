// The subset of next/server used by this project's route handlers and proxy.
// Native Worker Request/Response bodies remain streams; no body is pre-read.
type Cookie = { name: string; value: string };
type CookieOptions = {
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none' | boolean;
};

class RequestCookies {
  constructor(private readonly headers: Headers) {}

  getAll(name?: string): Cookie[] {
    const cookies: Cookie[] = [];
    for (const part of (this.headers.get('cookie') ?? '').split(';')) {
      const equals = part.indexOf('=');
      if (equals < 0) continue;
      const key = part.slice(0, equals).trim();
      if (!key || (name !== undefined && name !== key)) continue;
      try {
        cookies.push({ name: key, value: decodeURIComponent(part.slice(equals + 1).trim()) });
      } catch {
        // A malformed unrelated cookie must not prevent valid session parsing.
      }
    }
    return cookies;
  }

  get(name: string): Cookie | undefined { return this.getAll(name)[0]; }
  has(name: string): boolean { return this.get(name) !== undefined; }
}

function safeAttribute(value: string): string {
  if (/[;\r\n\u0000]/.test(value)) throw new TypeError('Invalid cookie attribute');
  return value;
}

class ResponseCookies {
  private readonly values = new Map<string, Cookie & CookieOptions>();
  private readonly original: string[];

  constructor(private readonly headers: Headers) {
    this.original = headers.getSetCookie();
  }

  set(name: string, value: string, options: CookieOptions = {}): this {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) throw new TypeError('Invalid cookie name');
    const cookie = { ...options, name, value, path: options.path ?? '/' };
    this.values.set(name, cookie);
    this.headers.delete('set-cookie');
    for (const initial of this.original) this.headers.append('set-cookie', initial);
    for (const stored of this.values.values()) {
      const parts = [`${stored.name}=${encodeURIComponent(stored.value)}`];
      if (stored.path) parts.push(`Path=${safeAttribute(stored.path)}`);
      if (stored.domain) parts.push(`Domain=${safeAttribute(stored.domain)}`);
      if (stored.maxAge !== undefined) {
        if (!Number.isFinite(stored.maxAge)) throw new TypeError('Invalid cookie age');
        parts.push(`Max-Age=${Math.floor(stored.maxAge)}`);
      }
      if (stored.expires) {
        if (!Number.isFinite(stored.expires.getTime())) throw new TypeError('Invalid cookie expiry');
        parts.push(`Expires=${stored.expires.toUTCString()}`);
      }
      if (stored.httpOnly) parts.push('HttpOnly');
      if (stored.secure) parts.push('Secure');
      if (stored.sameSite) {
        const sameSite = stored.sameSite === true ? 'strict' : stored.sameSite;
        parts.push(`SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`);
      }
      this.headers.append('set-cookie', parts.join('; '));
    }
    return this;
  }

  get(name: string): (Cookie & CookieOptions) | undefined { return this.values.get(name); }
  getAll(name?: string): (Cookie & CookieOptions)[] {
    return [...this.values.values()].filter((cookie) => name === undefined || cookie.name === name);
  }
  has(name: string): boolean { return this.values.has(name); }
  delete(name: string): this { return this.set(name, '', { expires: new Date(0), maxAge: 0 }); }
}

export class NextRequest extends Request {
  readonly nextUrl: URL;
  readonly cookies: RequestCookies;

  constructor(input: Request | URL | string, init?: RequestInit) {
    super(input, init);
    this.nextUrl = new URL(this.url);
    this.cookies = new RequestCookies(this.headers);
  }

  override clone(): NextRequest { return new NextRequest(super.clone()); }
}

export class NextResponse extends Response {
  readonly cookies: ResponseCookies;

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
    this.cookies = new ResponseCookies(this.headers);
  }

  static json(body: unknown, init?: ResponseInit): NextResponse {
    const response = Response.json(body, init);
    return new NextResponse(response.body, response);
  }

  static redirect(url: string | URL, init: number | ResponseInit = 307): NextResponse {
    const options = typeof init === 'number' ? { status: init } : init;
    const status = options.status ?? 307;
    if (![301, 302, 303, 307, 308].includes(status)) throw new RangeError('Invalid redirect status');
    const headers = new Headers(options.headers);
    headers.set('location', new URL(url).toString());
    return new NextResponse(null, { ...options, status, headers });
  }

  static next(init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    // Internal routing sentinel: the Worker router consumes this response.
    headers.set('x-middleware-next', '1');
    return new NextResponse(null, { ...init, headers });
  }
}

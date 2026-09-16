// Shared helpers for route handlers: the error envelope from PLAN.md section 7
// ({ error: { code, message } }) and a wrapper that maps thrown ApiError
// instances (and anything else) to that envelope.
import type { ApiError as ApiErrorBody } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function jsonError(status: number, code: string, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { status });
}

// Wraps a handler body so every error becomes the JSON envelope. Unknown
// errors are logged server-side and reported as 500 `internal_error` with the
// message included (internal tool; the officer sees it in a details toggle).
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.status, err.code, err.message);
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api]', err);
    return jsonError(500, 'internal_error', message);
  }
}

// Reads a JSON body; 400 `invalid_json` when it cannot be parsed.
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, 'invalid_json', 'Ongeldige JSON in de aanvraag.');
  }
}

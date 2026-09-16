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

// Expected ApiError messages are deliberately safe and useful. Unknown errors
// must not expose SDK request dumps, filesystem paths, stack traces or secrets,
// even in server logs: those logs can outlive the request and the credential.
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) return jsonError(err.status, err.code, err.message);
    console.error('[api] Onverwachte interne fout bij het verwerken van een aanvraag.');
    return jsonError(500, 'internal_error', 'Er is een onverwachte fout opgetreden. Probeer het opnieuw.');
  }
}

const MAX_JSON_BYTES = 64 * 1024;

// Cap the bytes actually received, not an untrusted Content-Length header.
// Malformed, unreadable and oversized bodies all use the existing 400 envelope.
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = req.body?.getReader();
    if (reader === undefined) throw new ApiError(400, 'invalid_json', 'Ongeldige JSON in de aanvraag.');
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BYTES) {
        throw new ApiError(400, 'invalid_json', 'De JSON-aanvraag is te groot (maximaal 64 KiB).');
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join('')) as T;
  } catch (err) {
    await reader?.cancel().catch(() => undefined);
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, 'invalid_json', 'Ongeldige JSON in de aanvraag.');
  } finally {
    reader?.releaseLock();
  }
}

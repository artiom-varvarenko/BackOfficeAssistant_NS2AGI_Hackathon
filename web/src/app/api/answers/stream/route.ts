import type { NextRequest } from 'next/server';
import { parseAnswerInput, prepareAnswer, streamAnswer } from '@/lib/answer';
import { ApiError, handle, readJson } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PARTIAL_INTERVAL_MS = 100;

export async function POST(req: NextRequest) {
  return handle(async () => {
    const input = parseAnswerInput(await readJson<unknown>(req));
    const cancellation = new AbortController();
    const signal = AbortSignal.any([req.signal, cancellation.signal]);
    // Validation, source retrieval and model configuration retain ordinary HTTP
    // errors (400/409) instead of committing successful SSE headers too early.
    const prepared = await prepareAnswer(input, signal);
    const encoder = new TextEncoder();
    let cancelStream = () => cancellation.abort();

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let timer: NodeJS.Timeout | undefined;
        let pending: string | undefined;
        let lastText: string | undefined;
        let lastSentAt = Number.NEGATIVE_INFINITY;

        const cleanup = () => {
          clearTimeout(timer);
          timer = undefined;
          pending = undefined;
          signal.removeEventListener('abort', close);
        };
        function close() {
          if (closed) return;
          closed = true;
          cleanup();
          // The transport may already have cancelled the stream.
          try { controller.close(); } catch { /* Already closed by the reader. */ }
        }
        cancelStream = () => {
          if (closed) return;
          closed = true;
          cleanup();
          cancellation.abort();
        };
        const send = (event: 'partial' | 'final' | 'error', data: unknown): boolean => {
          if (closed || signal.aborted) return false;
          try {
            // Encode a complete JSON value per SSE event. Embedded newlines and
            // Unicode (including escaped surrogate fragments) stay inside data.
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            return true;
          } catch {
            close();
            cancellation.abort();
            return false;
          }
        };
        const flushPartial = () => {
          clearTimeout(timer);
          timer = undefined;
          const antwoord = pending;
          pending = undefined;
          if (antwoord === undefined || antwoord === lastText) return;
          if (send('partial', { antwoord })) {
            lastText = antwoord;
            lastSentAt = performance.now();
          }
        };
        const queuePartial = (antwoord: string) => {
          if (closed || signal.aborted || antwoord === pending) return;
          if (pending === undefined && antwoord === lastText) return;
          pending = antwoord;
          const wait = PARTIAL_INTERVAL_MS - (performance.now() - lastSentAt);
          if (wait <= 0) flushPartial();
          else timer ??= setTimeout(flushPartial, wait);
        };

        signal.addEventListener('abort', close, { once: true });
        if (signal.aborted) {
          close();
          return;
        }
        const run = async () => {
          try {
            const answer = await streamAnswer(prepared, queuePartial);
            // streamAnswer only resolves after the shared validated transaction.
            // Pending plain partials are discarded when the final answer wins.
            send('final', answer);
          } catch (err) {
            if (!closed && !signal.aborted) {
              send('error', err instanceof ApiError
                ? { code: err.code, message: err.message }
                : { code: 'internal_error', message: 'Er is een onverwachte fout opgetreden. Probeer het opnieuw.' });
            }
          } finally {
            close();
          }
        };
        // run handles every rejection; neither disconnects nor SDK failures can
        // enqueue after close or leave an unobserved background promise behind.
        void run();
      },
      cancel() {
        cancelStream();
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    });
  });
}

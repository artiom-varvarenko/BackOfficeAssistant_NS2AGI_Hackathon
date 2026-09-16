import type { NextRequest } from 'next/server';
import { prepareAnswer } from '@/lib/answer';
import { readAnswerRequest } from '@/lib/answer-request';
import { ApiError, handle } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return handle(async () => {
    const input = await readAnswerRequest(req);
    const cancellation = new AbortController();
    const signal = AbortSignal.any([req.signal, cancellation.signal]);
    const prepared = await prepareAnswer(input, signal);
    const encoder = new TextEncoder();
    let cancelled = false;
    let clearPending = () => {};

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let lastSentAt = -Infinity;
        let lastText: string | undefined;
        let pending: string | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        clearPending = () => {
          if (timer !== undefined) clearTimeout(timer);
          timer = undefined;
          pending = undefined;
        };
        const send = (event: string, data: unknown) => {
          if (!cancelled && !signal.aborted) {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          }
        };
        const flush = () => {
          timer = undefined;
          if (pending === undefined || cancelled || signal.aborted) return;
          lastText = pending;
          pending = undefined;
          lastSentAt = performance.now();
          send('partial', { antwoord: lastText });
        };
        const partial = (text: string) => {
          if (cancelled || signal.aborted || text === (pending ?? lastText)) return;
          pending = text;
          const remaining = 100 - (performance.now() - lastSentAt);
          if (remaining <= 0) {
            if (timer !== undefined) clearTimeout(timer);
            flush();
          } else if (timer === undefined) {
            timer = setTimeout(flush, Math.ceil(remaining));
          }
        };

        void (async () => {
          try {
            const answer = await prepared.stream(partial);
            clearPending();
            send('final', answer);
          } catch (error) {
            clearPending();
            // Only the safe API envelope may cross the stream boundary.
            const safe = error instanceof ApiError
              ? { code: error.code, message: error.message }
              : { code: 'internal_error', message: 'Er is een onverwachte fout opgetreden. Probeer het opnieuw.' };
            send('error', safe);
          } finally {
            clearPending();
            if (!cancelled) controller.close();
          }
        })();
      },
      cancel() {
        cancelled = true;
        clearPending();
        cancellation.abort();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  });
}

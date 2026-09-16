import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ApiError, handle, readJson } from '@/lib/api';
import { generateStructured } from '@/lib/llm';
import { getTaskModel } from '@/lib/settings';
import { invalidInput, jsonObject } from '@/lib/source-forms';
import type { LlmTask, ProviderId } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TASKS: readonly LlmTask[] = ['answer', 'draft', 'summary'];
const TestOut = z.object({ ok: z.boolean() });
// Reasoning tokens count against the output budget on OpenAI-style APIs, so
// the budget is well above the ~10 tokens the JSON object itself needs.
const TEST_MAX_OUTPUT_TOKENS = 200;

interface TestResult {
  ok: boolean;
  latencyMs: number;
  provider: ProviderId;
  model: string;
  error?: string;
}

// "Test" button under Instellingen: one tiny structured call with the model
// configured for the task. Always HTTP 200; a missing key, a rejected key or
// an unreachable endpoint come back as `ok: false` with the Dutch message.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = jsonObject(await readJson<unknown>(req));
    const task = body.task;
    if (typeof task !== 'string' || !TASKS.includes(task as LlmTask)) {
      throw invalidInput(`Ongeldige taak (toegestaan: ${TASKS.join(', ')}).`);
    }
    const configured = getTaskModel(task as LlmTask);
    const startedAt = performance.now();
    let result: TestResult;
    try {
      const call = await generateStructured(task as LlmTask, {
        system: 'Je bent een testfunctie. Antwoord uitsluitend met het gevraagde JSON-object.',
        prompt: 'Antwoord met ok=true.',
        schema: TestOut,
        maxOutputTokens: TEST_MAX_OUTPUT_TOKENS,
      });
      const ok = call.output.ok === true;
      result = { ok, latencyMs: call.latencyMs, provider: call.provider, model: call.model };
      if (!ok) result.error = 'Het model antwoordde niet met ok=true.';
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      result = {
        ok: false,
        latencyMs: Math.round(performance.now() - startedAt),
        provider: configured.provider,
        model: configured.model,
        error: err.message,
      };
    }
    return Response.json(result);
  });
}

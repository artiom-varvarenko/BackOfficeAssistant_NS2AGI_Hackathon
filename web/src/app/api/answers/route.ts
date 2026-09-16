import type { NextRequest } from 'next/server';
import { generateAnswer } from '@/lib/answer';
import { ApiError, handle, readJson } from '@/lib/api';
import { listAnswers } from '@/lib/dto';
import { jsonObject } from '@/lib/source-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(() => Response.json(listAnswers()));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

// The pipeline (PLAN.md section 8.4). 400 invalid_input / invalid_question /
// invalid_scope, 409 no_model_configured / no_sources and 502 model_failed
// come from the errors thrown here and in generateAnswer.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const { question, sourceIds } = jsonObject(await readJson<unknown>(req));
    if (sourceIds !== undefined && sourceIds !== null && !isStringArray(sourceIds)) {
      throw new ApiError(400, 'invalid_scope', 'De bronselectie moet een lijst van bron-id’s zijn.');
    }
    const answer = await generateAnswer({
      question: typeof question === 'string' ? question : '',
      sourceIds: sourceIds ?? null,
    });
    return Response.json(answer, { status: 201 });
  });
}

import type { NextRequest } from 'next/server';
import { generateAnswer, parseAnswerInput } from '@/lib/answer';
import { handle, readJson } from '@/lib/api';
import { listAnswers } from '@/lib/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(() => Response.json(listAnswers()));
}

// The pipeline (PLAN.md section 8.4). 400 invalid_input / invalid_question /
// invalid_scope, 409 no_model_configured / no_sources and 502 model_failed
// come from the errors thrown here and in generateAnswer.
export async function POST(req: NextRequest) {
  return handle(async () => {
    const input = parseAnswerInput(await readJson<unknown>(req));
    const answer = await generateAnswer(input, req.signal);
    return Response.json(answer, { status: 201 });
  });
}

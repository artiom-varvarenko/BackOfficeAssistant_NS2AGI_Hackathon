// POST /api/answers/:id/regenerate — the same question again, against today's
// sources (PLAN.md section 8.4). The pipeline links the new answer to the old
// one (`regeneratedFromId`) and logs `regenerated` on the old answer.
import type { NextRequest } from 'next/server';
import { generateAnswer } from '@/lib/answer';
import { ApiError, handle } from '@/lib/api';
import { getAnswer } from '@/lib/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const old = getAnswer(id);
    if (!old) throw new ApiError(404, 'not_found', 'Antwoord niet gevonden.');
    const answer = await generateAnswer({
      question: old.question,
      sourceIds: old.scopeSourceIds,
      regeneratedFromId: old.id,
    }, req.signal);
    return Response.json(answer, { status: 201 });
  });
}

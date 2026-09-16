import type { NextRequest } from 'next/server';
import { ApiError, handle } from '@/lib/api';
import { getAnswer } from '@/lib/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const answer = getAnswer(id);
    if (!answer) throw new ApiError(404, 'not_found', 'Antwoord niet gevonden.');
    return Response.json(answer);
  });
}

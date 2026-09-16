// POST /api/answers/:id/email-draft — reply e-mail from the reviewed text and
// its citations (PLAN.md section 8.4). A concept for the officer; never sent.
import type { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { draftEmail } from '@/lib/email-draft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    return Response.json(await draftEmail(id));
  });
}

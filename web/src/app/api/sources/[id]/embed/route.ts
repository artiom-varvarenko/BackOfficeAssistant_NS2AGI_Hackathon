import type { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { embedSource } from '@/lib/embeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    return Response.json({ embedded: await embedSource(id) });
  });
}

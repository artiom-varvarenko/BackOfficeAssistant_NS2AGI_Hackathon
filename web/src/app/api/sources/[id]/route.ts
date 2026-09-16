import type { NextRequest } from 'next/server';
import { ApiError, handle } from '@/lib/api';
import { getSource } from '@/lib/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const source = getSource(id);
    if (!source) throw new ApiError(404, 'not_found', 'Bron niet gevonden.');
    return Response.json(source);
  });
}

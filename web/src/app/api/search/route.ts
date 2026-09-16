import type { NextRequest } from 'next/server';
import { ApiError, handle } from '@/lib/api';
import { searchPassages } from '@/lib/retrieve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(() => {
    const q = req.nextUrl.searchParams.get('q') ?? '';
    if (q.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(q)) {
      throw new ApiError(400, 'invalid_query', 'Gebruik een zoekopdracht van maximaal 500 tekens zonder besturingstekens.');
    }
    if (!q.trim()) return Response.json([]);
    // Retrieval enforces enabled + ready + current in SQL. Its snippets escape
    // source HTML while retaining only trusted, generated <mark> delimiters.
    return Response.json(searchPassages(q, { limit: 20 }));
  });
}

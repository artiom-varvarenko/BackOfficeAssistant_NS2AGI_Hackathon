import type { Statement } from 'better-sqlite3';
import type { NextRequest } from 'next/server';
import { ApiError, handle } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getPassage } from '@/lib/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let adjacent: Statement<
  [{ versionId: string; ordinal: number }],
  { previousId: string | null; nextId: string | null }
> | undefined;

// Evidence remains readable after replacement or disabling. The ordinal
// neighbours belong to the cited version, never the source's current version.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const current = getPassage(id);
    if (!current) throw new ApiError(404, 'not_found', 'Passage niet gevonden.');

    adjacent ??= getDb().prepare(`
      SELECT
        (SELECT id FROM passages
         WHERE version_id = @versionId AND ordinal < @ordinal
         ORDER BY ordinal DESC LIMIT 1) AS previousId,
        (SELECT id FROM passages
         WHERE version_id = @versionId AND ordinal > @ordinal
         ORDER BY ordinal ASC LIMIT 1) AS nextId`);
    const neighbours = adjacent.get({ versionId: current.versionId, ordinal: current.ordinal })!;
    return Response.json({
      previous: neighbours.previousId ? getPassage(neighbours.previousId) : null,
      current,
      next: neighbours.nextId ? getPassage(neighbours.nextId) : null,
    });
  });
}

import type { NextRequest } from 'next/server';
import { ApiError, handle } from '@/lib/api';
import { getDb } from '@/lib/db';
import type { EventLogItem } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handle(() => {
    const values = req.nextUrl.searchParams.getAll('limit');
    const rawLimit = values[0];
    const limit = rawLimit === undefined ? 200 : Number(rawLimit);
    if (
      values.length > 1 ||
      (rawLimit !== undefined && !/^[1-9]\d*$/.test(rawLimit)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500
    ) {
      throw new ApiError(400, 'invalid_limit', 'Kies een geheel aantal gebeurtenissen van 1 tot en met 500.');
    }

    // Keep every event type; the UI translates type and uses label as link text.
    // kind + id also orders equal timestamps and overlapping IDs across tables.
    const events = getDb().prepare(`
      SELECT e.id AS id, e.at AS at, 'answer' AS kind, e.type, e.detail,
             e.answer_id AS answerId, NULL AS sourceId, a.question AS label
      FROM answer_events e
      JOIN answers a ON a.id = e.answer_id
      UNION ALL
      SELECT e.id AS id, e.at AS at, 'source' AS kind, e.type, e.detail,
             NULL AS answerId, e.source_id AS sourceId, s.title AS label
      FROM source_events e
      JOIN sources s ON s.id = e.source_id
      ORDER BY at DESC, kind ASC, id DESC
      LIMIT ?
    `).all(limit) as EventLogItem[];

    return Response.json(events, { headers: { 'Cache-Control': 'no-store' } });
  });
}

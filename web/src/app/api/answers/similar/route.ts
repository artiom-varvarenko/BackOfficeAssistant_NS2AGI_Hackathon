import type { Statement } from 'better-sqlite3';
import type { NextRequest } from 'next/server';
import { ApiError, handle } from '@/lib/api';
import { getDb } from '@/lib/db';
import { buildFtsQuery, tokenizeQuery } from '@/lib/retrieve';
import type { AnswerListItem } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let similar: Statement<[{ query: string; exclude: string | null }], AnswerListItem> | undefined;

// Historical questions are searchable even when their evidence is superseded
// or disabled. Only tokenisation is shared with passage search: the questions
// have their own vocabulary, so passage-vocabulary expansion does not apply.
export async function GET(req: NextRequest) {
  return handle(() => {
    const params = req.nextUrl.searchParams;
    const q = params.get('q') ?? '';
    if (q.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(q)) {
      throw new ApiError(400, 'invalid_query', 'Gebruik een zoekvraag van maximaal 2000 tekens zonder besturingstekens.');
    }
    const exclude = params.get('exclude')?.trim() || null;
    if (exclude !== null && (exclude.length > 128 || /\s|[\u0000-\u001f\u007f]/u.test(exclude))) {
      throw new ApiError(400, 'invalid_exclude', 'Ongeldig antwoord-id om uit te sluiten.');
    }
    const query = buildFtsQuery(tokenizeQuery(q));
    if (query === null) return Response.json([]);

    similar ??= getDb().prepare(`
      SELECT a.id, a.question, a.status, a.can_answer AS canAnswer, a.created_at AS createdAt,
             (SELECT COUNT(*) FROM answer_citations c WHERE c.answer_id = a.id) AS citationCount,
             (SELECT COUNT(*) FROM answer_citations c WHERE c.answer_id = a.id AND c.checked = 1) AS checkedCount
      FROM answers_fts f
      JOIN answers a ON a.id = f.answer_id
      WHERE answers_fts MATCH @query AND (@exclude IS NULL OR a.id <> @exclude)
      ORDER BY bm25(answers_fts), a.created_at DESC, a.rowid DESC
      LIMIT 5`);
    return Response.json(similar.all({ query, exclude }));
  });
}

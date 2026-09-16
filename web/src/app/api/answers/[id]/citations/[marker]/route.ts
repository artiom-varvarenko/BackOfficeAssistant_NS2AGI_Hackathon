// PATCH /api/answers/:id/citations/:marker — the officer's tick on one piece
// of evidence (PLAN.md section 7), with an optional note. Only real changes
// are written and logged, so repeating the same request leaves no trace.
import type { NextRequest } from 'next/server';
import { ApiError, handle, readJson } from '@/lib/api';
import { getDb, nowIso } from '@/lib/db';
import { getAnswer } from '@/lib/dto';
import { addAnswerEvent } from '@/lib/events';
import { jsonObject } from '@/lib/source-forms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CitationRow {
  id: string;
  checked: number;
  check_note: string | null;
  checked_at: string | null;
}

function eventDetail(marker: number, checked: boolean, wasChecked: boolean, note: string | null): string {
  if (checked) return note === null ? `[${marker}] gecontroleerd` : `[${marker}] gecontroleerd: ${note}`;
  if (wasChecked) return `[${marker}] controle ongedaan gemaakt`;
  // Unchecked before and after: only the note changed.
  return note === null ? `[${marker}] opmerking verwijderd` : `[${marker}] opmerking: ${note}`;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; marker: string }> },
) {
  return handle(async () => {
    const { id, marker: markerParam } = await params;
    const body = jsonObject(await readJson<unknown>(req));
    if (typeof body.checked !== 'boolean') {
      throw new ApiError(400, 'invalid_input', "'checked' moet true of false zijn.");
    }
    if (body.checkNote !== undefined && body.checkNote !== null && typeof body.checkNote !== 'string') {
      throw new ApiError(400, 'invalid_input', "'checkNote' moet tekst of null zijn.");
    }
    const checked = body.checked;
    // Absent = leave the note as it is; null or blank clears it.
    const noteUpdate = body.checkNote === undefined ? undefined : body.checkNote?.trim() || null;
    const marker = /^\d+$/.test(markerParam) ? Number(markerParam) : null;

    const db = getDb();
    db.transaction(() => {
      if (!db.prepare('SELECT 1 FROM answers WHERE id = ?').get(id)) {
        throw new ApiError(404, 'not_found', 'Antwoord niet gevonden.');
      }
      const row =
        marker === null
          ? undefined
          : db
              .prepare<[string, number], CitationRow>(
                'SELECT id, checked, check_note, checked_at FROM answer_citations WHERE answer_id = ? AND marker = ?',
              )
              .get(id, marker);
      if (!row || marker === null) throw new ApiError(404, 'not_found', 'Bronverwijzing niet gevonden.');

      const wasChecked = row.checked === 1;
      const note = noteUpdate === undefined ? row.check_note : noteUpdate;
      if (checked === wasChecked && note === row.check_note) return;

      const at = nowIso();
      // The check moment survives a note edit; re-checking sets a new one.
      const checkedAt = checked ? (wasChecked ? row.checked_at : at) : null;
      db.prepare('UPDATE answer_citations SET checked = ?, check_note = ?, checked_at = ? WHERE id = ?').run(
        checked ? 1 : 0,
        note,
        checkedAt,
        row.id,
      );
      db.prepare('UPDATE answers SET updated_at = ? WHERE id = ?').run(at, id);
      addAnswerEvent(id, 'citation_checked', eventDetail(marker, checked, wasChecked, note), db, at);
    })();

    return Response.json(getAnswer(id));
  });
}

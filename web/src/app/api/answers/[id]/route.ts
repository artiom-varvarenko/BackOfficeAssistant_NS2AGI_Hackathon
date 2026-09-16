import type { NextRequest } from 'next/server';
import { ApiError, handle, readJson } from '@/lib/api';
import { getDb, nowIso } from '@/lib/db';
import { getAnswer } from '@/lib/dto';
import { addAnswerEvent } from '@/lib/events';
import { invalidInput, jsonObject, optionalText } from '@/lib/source-forms';
import type { AnswerEvent, AnswerStatus } from '@/lib/types';

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

const STATUSES: readonly AnswerStatus[] = ['draft', 'approved', 'rejected'];

const STATUS_EVENTS: Record<AnswerStatus, { type: AnswerEvent['type']; detail: string }> = {
  draft: { type: 'reopened', detail: 'Heropend door medewerker' },
  approved: { type: 'approved', detail: 'Goedgekeurd door medewerker' },
  rejected: { type: 'rejected', detail: 'Afgewezen door medewerker' },
};
const REOPENED_BY_EDIT = 'Teruggezet naar concept omdat de tekst is gewijzigd';

interface AnswerPatch {
  reviewedAnswer?: string | null; // null restores the generated text
  status?: AnswerStatus;
  reviewNote?: string | null;
}

interface AnswerRow {
  status: AnswerStatus;
  generated_answer: string;
  reviewed_answer: string | null;
  review_note: string | null;
}

function parseAnswerPatch(body: Record<string, unknown>): AnswerPatch {
  const patch: AnswerPatch = {};
  if (body.reviewedAnswer !== undefined) {
    if (body.reviewedAnswer !== null && typeof body.reviewedAnswer !== 'string') {
      throw invalidInput('Het veld reviewedAnswer moet tekst of null zijn.');
    }
    patch.reviewedAnswer = body.reviewedAnswer;
  }
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !STATUSES.includes(body.status as AnswerStatus)) {
      throw invalidInput(`Ongeldige status (toegestaan: ${STATUSES.join(', ')}).`);
    }
    patch.status = body.status as AnswerStatus;
  }
  if (body.reviewNote !== undefined) patch.reviewNote = optionalText(body.reviewNote, 'reviewNote');
  return patch;
}

// Trailing whitespace never counts as a change (textarea autosaves).
function sameText(a: string | null, b: string | null): boolean {
  return a === b || (a !== null && b !== null && a.trimEnd() === b.trimEnd());
}

// Review of an answer (PLAN.md section 7): the officer's text, the status and
// the note, in one transaction. The generated text is immutable; a reviewed
// text equal to it is stored as NULL ("Ongewijzigd t.o.v. het gegenereerde
// antwoord"). Editing an approved answer always clears its old approval; the
// officer must approve the new text separately. Rejected answers also reopen
// on an edit unless an explicit new status was requested. Identical values
// are no-ops without events,
// so the UI's autosave (same text + status 'draft' every 600 ms) costs one
// SELECT.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const patch = parseAnswerPatch(jsonObject(await readJson<unknown>(req)));
    const db = getDb();
    db.transaction(() => {
      const row = db
        .prepare('SELECT status, generated_answer, reviewed_answer, review_note FROM answers WHERE id = ?')
        .get(id) as AnswerRow | undefined;
      if (!row) throw new ApiError(404, 'not_found', 'Antwoord niet gevonden.');

      const now = nowIso();
      const sets: string[] = [];
      const values: (string | null)[] = [];

      let textChanged = false;
      let restored = false;
      if (patch.reviewedAnswer !== undefined) {
        const next =
          patch.reviewedAnswer === null || sameText(patch.reviewedAnswer, row.generated_answer)
            ? null
            : patch.reviewedAnswer;
        if (next !== row.reviewed_answer) {
          sets.push('reviewed_answer = ?');
          values.push(next);
        }
        textChanged = !sameText(next, row.reviewed_answer);
        restored = textChanged && next === null;
      }

      let noteChanged = false;
      if (patch.reviewNote !== undefined && patch.reviewNote !== row.review_note) {
        noteChanged = true;
        sets.push('review_note = ?');
        values.push(patch.reviewNote);
      }

      let status = row.status;
      let statusDetail = '';
      if (textChanged && row.status === 'approved') {
        status = 'draft';
        statusDetail = REOPENED_BY_EDIT;
      } else if (patch.status !== undefined) {
        if (patch.status !== row.status) {
          status = patch.status;
          statusDetail = status === 'draft' && textChanged ? REOPENED_BY_EDIT : STATUS_EVENTS[status].detail;
        }
      } else if (textChanged && row.status !== 'draft') {
        status = 'draft';
        statusDetail = REOPENED_BY_EDIT;
      }
      if (status !== row.status) {
        sets.push('status = ?', 'reviewed_at = ?');
        values.push(status, status === 'draft' ? null : now);
      }
      if (sets.length === 0) return;

      db.prepare(`UPDATE answers SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now, id);
      if (textChanged) {
        addAnswerEvent(id, 'edited', restored ? 'Gegenereerde tekst hersteld' : 'Tekst aangepast door medewerker', db, now);
      }
      if (status !== row.status) {
        // A note that changes in the same call is part of the decision.
        const note = noteChanged && patch.reviewNote !== null ? `: ${patch.reviewNote}` : '';
        addAnswerEvent(id, STATUS_EVENTS[status].type, `${statusDetail}${note}`, db, now);
      }
    })();
    return Response.json(getAnswer(id));
  });
}

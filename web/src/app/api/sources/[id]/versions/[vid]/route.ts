import type { NextRequest } from 'next/server';
import { ApiError, handle, readJson } from '@/lib/api';
import { getDb, nowIso } from '@/lib/db';
import { getSource } from '@/lib/dto';
import { addSourceEvent } from '@/lib/events';
import {
  APPLICABILITY_LABELS,
  FIELD_LABELS,
  invalidInput,
  jsonObject,
  parseVersionPatch,
  type VersionPatch,
} from '@/lib/source-forms';
import type { Applicability } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Patch key → column of `source_versions`; the iteration order is the order of
// field names in the `metadata_edited` detail.
const COLUMNS = {
  applicabilityNote: 'applicability_note',
  documentDate: 'document_date',
  versionLabel: 'version_label',
  validFrom: 'valid_from',
  validUntil: 'valid_until',
} as const satisfies Record<Exclude<keyof VersionPatch, 'applicability'>, string>;

interface VersionRow {
  applicability: Applicability;
  applicability_note: string | null;
  document_date: string | null;
  version_label: string | null;
  valid_from: string | null;
  valid_until: string | null;
}

// Officer edits on one version. An applicability change sets/clears
// `verified_at` and logs `applicability_changed` ("niet geverifieerd →
// geverifieerd: {toelichting}"); other field changes log `metadata_edited`
// naming the fields. A version that was superseded by a newer upload keeps
// that system-managed state. Identical values are no-ops without events.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  return handle(async () => {
    const { id, vid } = await params;
    const patch = parseVersionPatch(jsonObject(await readJson<unknown>(req)));
    const db = getDb();
    db.transaction(() => {
      const row = db
        .prepare(
          `SELECT applicability, applicability_note, document_date, version_label, valid_from, valid_until
           FROM source_versions WHERE id = ? AND source_id = ?`,
        )
        .get(vid, id) as VersionRow | undefined;
      if (!row) throw new ApiError(404, 'not_found', 'Versie niet gevonden.');

      const applicability =
        patch.applicability !== undefined && patch.applicability !== row.applicability ? patch.applicability : null;
      if (applicability !== null && row.applicability === 'superseded') {
        throw invalidInput(
          'Deze versie is vervangen door een nieuwere versie; de toepasselijkheid kan niet meer worden gewijzigd.',
        );
      }

      const sets: string[] = [];
      const values: (string | null)[] = [];
      const edited: string[] = [];
      for (const key of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
        const value = patch[key];
        if (value === undefined || value === row[COLUMNS[key]]) continue;
        sets.push(`${COLUMNS[key]} = ?`);
        values.push(value);
        // A note sent with an applicability change belongs to that event.
        if (key !== 'applicabilityNote' || applicability === null) edited.push(FIELD_LABELS[key]);
      }
      const now = nowIso();
      if (applicability !== null) {
        sets.push('applicability = ?', 'verified_at = ?');
        values.push(applicability, applicability === 'verified' ? now : null);
      }
      if (sets.length === 0) return;

      db.prepare(`UPDATE source_versions SET ${sets.join(', ')} WHERE id = ?`).run(...values, vid);
      db.prepare('UPDATE sources SET updated_at = ? WHERE id = ?').run(now, id);
      if (applicability !== null) {
        const note = patch.applicabilityNote ? `: ${patch.applicabilityNote}` : '';
        addSourceEvent(
          id,
          'applicability_changed',
          `${APPLICABILITY_LABELS[row.applicability]} → ${APPLICABILITY_LABELS[applicability]}${note}`,
          db,
          now,
        );
      }
      if (edited.length > 0) addSourceEvent(id, 'metadata_edited', edited.join(', '), db, now);
    })();
    return Response.json(getSource(id));
  });
}

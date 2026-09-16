import type { NextRequest } from 'next/server';
import { ApiError, handle, readJson } from '@/lib/api';
import { getDb, nowIso } from '@/lib/db';
import { getSource } from '@/lib/dto';
import { addSourceEvent } from '@/lib/events';
import { FIELD_LABELS, jsonObject, parseSourcePatch, type SourcePatch } from '@/lib/source-forms';

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

// Patch key → column of `sources`; the iteration order is the order of field
// names in the `metadata_edited` detail.
const COLUMNS = {
  title: 'title',
  authority: 'authority',
  level: 'level',
  docType: 'doc_type',
  scope: 'scope',
  originalUrl: 'original_url',
} as const satisfies Record<Exclude<keyof SourcePatch, 'enabled'>, string>;

interface SourceRow {
  title: string;
  authority: string | null;
  level: string;
  doc_type: string;
  scope: string | null;
  original_url: string | null;
  enabled: number;
}

// Only columns whose value actually changes are written, so a repeated or
// identical PATCH is a no-op without events. Metadata changes log one
// `metadata_edited` event naming the fields; an enabled flip logs
// `enabled`/`disabled`.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const patch = parseSourcePatch(jsonObject(await readJson<unknown>(req)));
    const db = getDb();
    db.transaction(() => {
      const row = db
        .prepare('SELECT title, authority, level, doc_type, scope, original_url, enabled FROM sources WHERE id = ?')
        .get(id) as SourceRow | undefined;
      if (!row) throw new ApiError(404, 'not_found', 'Bron niet gevonden.');

      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      const edited: string[] = [];
      for (const key of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
        const value = patch[key];
        if (value === undefined || value === row[COLUMNS[key]]) continue;
        sets.push(`${COLUMNS[key]} = ?`);
        values.push(value);
        edited.push(FIELD_LABELS[key]);
      }
      const enabled = patch.enabled !== undefined && patch.enabled !== (row.enabled === 1) ? patch.enabled : null;
      if (enabled !== null) {
        sets.push('enabled = ?');
        values.push(enabled ? 1 : 0);
      }
      if (sets.length === 0) return;

      const now = nowIso();
      db.prepare(`UPDATE sources SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...values, now, id);
      if (edited.length > 0) addSourceEvent(id, 'metadata_edited', edited.join(', '), db, now);
      if (enabled !== null) addSourceEvent(id, enabled ? 'enabled' : 'disabled', null, db, now);
    })();
    return Response.json(getSource(id));
  });
}

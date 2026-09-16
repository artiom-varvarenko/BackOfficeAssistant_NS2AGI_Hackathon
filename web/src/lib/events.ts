// Audit trail writers. Every state change on an answer or a source is recorded
// here so the timeline in Geschiedenis and the Logboek page are complete.
// Callers inside a better-sqlite3 transaction pass their own `db` handle; the
// statements are plain INSERTs so they join the enclosing transaction.
import type Database from 'better-sqlite3';
import { getDb, newId, nowIso } from './db';
import type { AnswerEvent } from './types';

export type SourceEventType =
  | 'created'
  | 'enabled'
  | 'disabled'
  | 'version_added'
  | 'applicability_changed'
  | 'metadata_edited'
  | 'summary_generated';

export function addAnswerEvent(
  answerId: string,
  type: AnswerEvent['type'],
  detail: string | null,
  db: Database.Database = getDb(),
  at: string = nowIso(),
): void {
  db.prepare('INSERT INTO answer_events (id, answer_id, type, detail, at) VALUES (?, ?, ?, ?, ?)').run(
    newId(),
    answerId,
    type,
    detail,
    at,
  );
}

export function addSourceEvent(
  sourceId: string,
  type: SourceEventType,
  detail: string | null,
  db: Database.Database = getDb(),
  at: string = nowIso(),
): void {
  db.prepare('INSERT INTO source_events (id, source_id, type, detail, at) VALUES (?, ?, ?, ?, ?)').run(
    newId(),
    sourceId,
    type,
    detail,
    at,
  );
}

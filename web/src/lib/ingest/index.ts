// PDF ingestion (PLAN.md section 8.2): stores the file, extracts and chunks
// it, and writes source/version/passage rows. Uploads, URL imports and the
// seed all go through createSource/addVersion, so every document in the
// corpus is processed the same way.
//
// Flow: sha256 -> file at pdfPathForVersion(versionId) -> source (+ version)
// row in status "processing" -> extract + chunk outside any transaction ->
// one transaction that either marks the version "failed" (and throws
// IngestError) or inserts the passages and marks it "ready".
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { ApiError } from '@/lib/api';
import { getDb, newId, nowIso, pdfPathForVersion } from '@/lib/db';
import { embedSource } from '@/lib/embeddings';
import { ENRICHMENT_WARNINGS } from '@/lib/enrichment-warnings';
import { addSourceEvent } from '@/lib/events';
import { resolveTaskModel } from '@/lib/llm';
import { resolveKey } from '@/lib/settings';
import { summarizeSource } from '@/lib/summary';
import type { Locale } from '@/lib/i18n';
import type { DocType, Level } from '@/lib/types';
import { chunkPages, type ChunkPassage, UNREADABLE_MESSAGE } from './chunk';
import { extractPages } from './extract';

export interface SourceMeta {
  title: string;
  authority: string | null;
  level: Level;
  docType: DocType;
  scope: string | null;
  originalUrl: string | null;
}

export interface VersionMeta {
  fileName: string;
  documentDate: string | null;
  versionLabel: string | null;
  validFrom: string | null;
  validUntil: string | null;
  applicability: 'unverified' | 'historical';
}

export interface IngestResult {
  sourceId: string;
  versionId: string;
  pageCount: number;
  passageCount: number;
  warning: string | null;
}

// Thrown after the version row has been marked failed with processing_error
// set; the source (and, for a new source, its current_version_id) stays.
export class IngestError extends ApiError {
  readonly sourceId: string;
  readonly versionId: string;

  constructor(sourceId: string, versionId: string, message: string) {
    super(422, 'unreadable_pdf', message);
    this.name = 'IngestError';
    this.sourceId = sourceId;
    this.versionId = versionId;
  }
}

export function findVersionBySha(sha256: string): { versionId: string; sourceId: string } | null {
  const row = getDb()
    .prepare('SELECT id, source_id FROM source_versions WHERE sha256 = ? ORDER BY created_at DESC LIMIT 1')
    .get(sha256) as { id: string; source_id: string } | undefined;
  return row ? { versionId: row.id, sourceId: row.source_id } : null;
}

export async function createSource(buffer: Buffer, source: SourceMeta, version: VersionMeta, language: Locale = 'nl'): Promise<IngestResult> {
  const db = getDb();
  const sourceId = newId();
  const versionId = newId();
  const now = nowIso();
  fs.writeFileSync(pdfPathForVersion(versionId), buffer);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO sources (id, title, authority, level, doc_type, scope, original_url, enabled, summary, current_version_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?, ?)`,
    ).run(
      sourceId,
      source.title,
      source.authority,
      source.level,
      source.docType,
      source.scope,
      source.originalUrl,
      versionId,
      now,
      now,
    );
    insertVersion(versionId, sourceId, 1, buffer, version, now);
  })();
  return finishVersion(buffer, { sourceId, versionId, fileName: version.fileName, eventType: 'created', language });
}

export async function addVersion(
  buffer: Buffer,
  sourceId: string,
  version: Omit<VersionMeta, 'applicability'>,
  language: Locale = 'nl',
): Promise<IngestResult> {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM sources WHERE id = ?').get(sourceId)) {
    throw new ApiError(404, 'not_found', 'Bron niet gevonden.');
  }
  const versionId = newId();
  fs.writeFileSync(pdfPathForVersion(versionId), buffer);
  db.transaction(() => {
    const { next } = db
      .prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM source_versions WHERE source_id = ?')
      .get(sourceId) as { next: number };
    insertVersion(versionId, sourceId, next, buffer, { ...version, applicability: 'unverified' }, nowIso());
  })();
  return finishVersion(buffer, {
    sourceId,
    versionId,
    fileName: version.fileName,
    eventType: 'version_added',
    language,
  });
}

function insertVersion(
  versionId: string,
  sourceId: string,
  versionNo: number,
  buffer: Buffer,
  version: VersionMeta,
  now: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO source_versions (id, source_id, version_no, file_name, file_path, sha256, page_count, document_date, version_label,
         valid_from, valid_until, applicability, processing_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'processing', ?)`,
    )
    .run(
      versionId,
      sourceId,
      versionNo,
      version.fileName,
      pdfPathForVersion(versionId),
      createHash('sha256').update(buffer).digest('hex'),
      version.documentDate,
      version.versionLabel,
      version.validFrom,
      version.validUntil,
      version.applicability,
      now,
    );
}

interface ProcessContext {
  language: Locale;
  sourceId: string;
  versionId: string;
  fileName: string;
  eventType: 'created' | 'version_added';
}

type Analysis = { pageCount: number; passages: ChunkPassage[]; warning: string | null } | { error: string };

async function analyse(buffer: Buffer, versionId: string): Promise<Analysis> {
  let extracted;
  try {
    extracted = await extractPages(buffer);
  } catch (err) {
    console.warn(`[ingest] ${versionId}: PDF could not be read:`, err instanceof Error ? err.message : err);
    return { error: UNREADABLE_MESSAGE };
  }
  try {
    const chunked = chunkPages(extracted.pages);
    return chunked.ok
      ? { pageCount: extracted.pageCount, passages: chunked.passages, warning: chunked.warning }
      : { error: chunked.error };
  } catch (err) {
    // A chunking bug must not leave the version stuck in "processing".
    console.error(`[ingest] ${versionId}: chunking failed:`, err);
    return { error: `Verwerking mislukt: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function finishVersion(buffer: Buffer, ctx: ProcessContext): Promise<IngestResult> {
  const db = getDb();
  const analysis = await analyse(buffer, ctx.versionId);
  const now = nowIso();
  const logEvent = (detail: string) => addSourceEvent(ctx.sourceId, ctx.eventType, detail, db, now);

  if ('error' in analysis) {
    db.transaction(() => {
      db.prepare(`UPDATE source_versions SET processing_status = 'failed', processing_error = ? WHERE id = ?`).run(
        analysis.error,
        ctx.versionId,
      );
      db.prepare('UPDATE sources SET updated_at = ? WHERE id = ?').run(now, ctx.sourceId);
      logEvent(`${ctx.fileName} · Mislukt: ${analysis.error}`);
    })();
    throw new IngestError(ctx.sourceId, ctx.versionId, analysis.error);
  }

  const { pageCount, passages, warning } = analysis;
  db.transaction(() => {
    const insertPassage = db.prepare(
      'INSERT INTO passages (id, version_id, ordinal, page_start, page_end, article, section, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertFts = db.prepare('INSERT INTO passages_fts (text, passage_id) VALUES (?, ?)');
    passages.forEach((p, i) => {
      const id = newId();
      insertPassage.run(id, ctx.versionId, i + 1, p.pageStart, p.pageEnd, p.article, p.section, p.text);
      insertFts.run(p.text, id);
    });
    db.prepare(
      `UPDATE source_versions SET processing_status = 'ready', page_count = ?, extraction_warning = ? WHERE id = ?`,
    ).run(pageCount, warning, ctx.versionId);
    // Extraction is asynchronous: an older upload may finish after a newer
    // one. Resolve the newest ready version inside this same transaction,
    // rather than superseding a current-version ID captured before extraction.
    const current = db.prepare<[string], { id: string }>(
      `SELECT id FROM source_versions WHERE source_id = ? AND processing_status = 'ready'
       ORDER BY version_no DESC LIMIT 1`,
    ).get(ctx.sourceId)!;
    db.prepare(
      `UPDATE source_versions SET applicability = 'superseded'
       WHERE source_id = ? AND id != ? AND processing_status = 'ready' AND applicability != 'superseded'`,
    ).run(ctx.sourceId, current.id);
    db.prepare(
      `UPDATE sources SET summary = CASE WHEN current_version_id IS ? THEN summary ELSE NULL END,
       current_version_id = ?, updated_at = ? WHERE id = ?`,
    ).run(current.id, current.id, now, ctx.sourceId);
    logEvent(`${ctx.fileName} · ${pageCount} p. · ${passages.length} passages`);
  })();

  const derivedWarning = await deriveCurrentVersion(ctx);
  return { sourceId: ctx.sourceId, versionId: ctx.versionId, pageCount, passageCount: passages.length, warning: derivedWarning ?? warning };
}

async function deriveCurrentVersion(ctx: ProcessContext): Promise<string | null> {
  const db = getDb();
  const isCurrent = () => db.prepare('SELECT 1 FROM sources WHERE id = ? AND current_version_id = ?')
    .get(ctx.sourceId, ctx.versionId) !== undefined;
  // An older concurrent upload may finish extraction after its replacement.
  if (!isCurrent()) return null;

  const jobs: { label: string; action: () => Promise<unknown> }[] = [
    {
      label: ENRICHMENT_WARNINGS.summary,
      action: async () => {
        try {
          // Keyless local providers are supported too. Missing configuration
          // simply leaves the explicit generate button available, per the plan.
          resolveTaskModel('summary');
        } catch (error) {
          if (error instanceof ApiError && error.code === 'no_model_configured') return;
          throw error;
        }
        await summarizeSource(ctx.sourceId, ctx.versionId, ctx.language);
      },
    },
  ];
  if (resolveKey('openai')?.key.trim()) {
    jobs.push({
      label: ENRICHMENT_WARNINGS.embeddings,
      action: () => embedSource(ctx.sourceId, ctx.versionId),
    });
  }
  const results = await Promise.allSettled(jobs.map((job) => job.action()));
  const warnings = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [];
    if (result.reason instanceof ApiError && result.reason.code === 'source_changed') return [];
    // Keep provider details and credentials out of persisted ingestion notices.
    return [jobs[index].label];
  });
  if (warnings.length === 0) return null;

  // Derived failures do not undo readable passages or claim PDF processing
  // failed. The existing version warning is visible in every Source DTO.
  return db.transaction(() => {
    if (!isCurrent()) return null;
    const version = db.prepare<[string], { extraction_warning: string | null }>(
      'SELECT extraction_warning FROM source_versions WHERE id = ?',
    ).get(ctx.versionId);
    if (!version) return null;
    const notice = [version.extraction_warning, ...warnings].filter(Boolean).join(' ');
    db.prepare('UPDATE source_versions SET extraction_warning = ? WHERE id = ?').run(notice, ctx.versionId);
    return notice;
  }).immediate();
}

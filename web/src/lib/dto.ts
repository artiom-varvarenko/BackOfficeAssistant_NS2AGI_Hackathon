// Read side of the engine: SQLite rows → the DTOs in ./types. Nothing here
// writes. Statements are prepared once per module against the shared
// connection. Citations are resolved against LIVE source data on every read,
// so an old answer can show that its evidence has since changed
// (`sourcesChangedSince`), while the quoted text stays the snapshot taken at
// answer time.
import type { Database, Statement } from 'better-sqlite3';
import { getDb } from './db';
import type {
  Answer,
  AnswerEvent,
  AnswerListItem,
  AnswerStatus,
  Applicability,
  CanAnswer,
  Citation,
  DocType,
  Effort,
  Level,
  Passage,
  ProcessingStatus,
  ProviderId,
  Source,
  SourceVersion,
} from './types';

// ---- Row shapes (snake_case, exactly as selected below) ----------------------

interface SourceRow {
  id: string;
  title: string;
  authority: string | null;
  level: Level;
  doc_type: DocType;
  scope: string | null;
  original_url: string | null;
  enabled: number;
  summary: string | null;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  source_id: string;
  version_no: number;
  file_name: string;
  page_count: number | null;
  document_date: string | null;
  version_label: string | null;
  valid_from: string | null;
  valid_until: string | null;
  applicability: Applicability;
  applicability_note: string | null;
  verified_at: string | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  extraction_warning: string | null;
  created_at: string;
  passage_count: number;
}

interface VersionFileRow {
  file_path: string;
  file_name: string;
}

interface PassageRow {
  id: string;
  version_id: string;
  source_id: string;
  source_title: string;
  ordinal: number;
  page_start: number;
  page_end: number;
  article: string | null;
  section: string | null;
  text: string;
}

interface AnswerListRow {
  id: string;
  question: string;
  status: AnswerStatus;
  can_answer: CanAnswer;
  citation_count: number;
  checked_count: number;
  created_at: string;
}

interface AnswerRow {
  id: string;
  question: string;
  status: AnswerStatus;
  can_answer: CanAnswer;
  generated_answer: string;
  reviewed_answer: string | null;
  review_note: string | null;
  email_draft: string | null;
  gaps_json: string;
  warnings_json: string;
  conflicts_json: string;
  uncited_sentences: number;
  provider: ProviderId;
  model: string;
  effort: string | null;
  prompt_snapshot: string;
  passages_sent_json: string;
  regenerated_from_id: string | null;
  scope_json: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
}

interface CitationRow {
  marker: number;
  passage_id: string;
  version_id: string;
  quote_text: string;
  highlight: string | null;
  checked: number;
  check_note: string | null;
  checked_at: string | null;
  page_start: number;
  page_end: number;
  article: string | null;
  section: string | null;
  document_date: string | null;
  version_label: string | null;
  applicability: Applicability;
  applicability_note: string | null;
  verified_at: string | null;
  source_id: string;
  source_title: string;
  authority: string | null;
  level: Level;
  original_url: string | null;
  enabled: number;
  current_version_id: string | null;
}

interface SentPassageRow {
  id: string;
  page_start: number;
  source_id: string;
  source_title: string;
}

// Storage format of answers.passages_sent_json: the labels as sent to the model.
interface SentPassage {
  label: string;
  passageId: string;
}

// ---- Statements ---------------------------------------------------------------

const VERSION_SELECT = `
  SELECT v.id, v.source_id, v.version_no, v.file_name, v.page_count,
         v.document_date, v.version_label, v.valid_from, v.valid_until,
         v.applicability, v.applicability_note, v.verified_at,
         v.processing_status, v.processing_error, v.extraction_warning, v.created_at,
         (SELECT COUNT(*) FROM passages p WHERE p.version_id = v.id) AS passage_count
  FROM source_versions v`;

const PASSAGE_SELECT = `
  SELECT p.id, p.version_id, v.source_id, s.title AS source_title,
         p.ordinal, p.page_start, p.page_end, p.article, p.section, p.text
  FROM passages p
  JOIN source_versions v ON v.id = p.version_id
  JOIN sources s ON s.id = v.source_id`;

interface Statements {
  sources: Statement<[], SourceRow>;
  sourceById: Statement<[string], SourceRow>;
  versions: Statement<[], VersionRow>;
  versionsBySource: Statement<[string], VersionRow>;
  versionFile: Statement<[string], VersionFileRow>;
  passagesByVersion: Statement<[string], PassageRow>;
  passageById: Statement<[string], PassageRow>;
  answers: Statement<[], AnswerListRow>;
  answerById: Statement<[string], AnswerRow>;
  citations: Statement<[string], CitationRow>;
  events: Statement<[string], AnswerEvent>;
  passagesSent: Statement<[string], SentPassageRow>;
}

function prepare(db: Database): Statements {
  return {
    sources: db.prepare<[], SourceRow>('SELECT * FROM sources ORDER BY created_at DESC, rowid DESC'),
    sourceById: db.prepare<[string], SourceRow>('SELECT * FROM sources WHERE id = ?'),
    versions: db.prepare<[], VersionRow>(`${VERSION_SELECT} ORDER BY v.source_id, v.version_no DESC`),
    versionsBySource: db.prepare<[string], VersionRow>(
      `${VERSION_SELECT} WHERE v.source_id = ? ORDER BY v.version_no DESC`,
    ),
    versionFile: db.prepare<[string], VersionFileRow>(
      'SELECT file_path, file_name FROM source_versions WHERE id = ?',
    ),
    passagesByVersion: db.prepare<[string], PassageRow>(
      `${PASSAGE_SELECT} WHERE p.version_id = ? ORDER BY p.ordinal`,
    ),
    passageById: db.prepare<[string], PassageRow>(`${PASSAGE_SELECT} WHERE p.id = ?`),
    answers: db.prepare<[], AnswerListRow>(`
      SELECT a.id, a.question, a.status, a.can_answer, a.created_at,
             COALESCE(c.citation_count, 0) AS citation_count,
             COALESCE(c.checked_count, 0) AS checked_count
      FROM answers a
      LEFT JOIN (
        SELECT answer_id, COUNT(*) AS citation_count, SUM(checked) AS checked_count
        FROM answer_citations GROUP BY answer_id
      ) c ON c.answer_id = a.id
      ORDER BY a.created_at DESC, a.rowid DESC`),
    answerById: db.prepare<[string], AnswerRow>('SELECT * FROM answers WHERE id = ?'),
    // The citation row is the snapshot (quote, highlight, marker); passage,
    // version and source are joined live for the applicability/enabled state.
    citations: db.prepare<[string], CitationRow>(`
      SELECT c.marker, c.passage_id, c.version_id, c.quote_text, c.highlight,
             c.checked, c.check_note, c.checked_at,
             p.page_start, p.page_end, p.article, p.section,
             v.document_date, v.version_label, v.applicability, v.applicability_note, v.verified_at,
             s.id AS source_id, s.title AS source_title, s.authority, s.level, s.original_url,
             s.enabled, s.current_version_id
      FROM answer_citations c
      JOIN passages p ON p.id = c.passage_id
      JOIN source_versions v ON v.id = c.version_id
      JOIN sources s ON s.id = v.source_id
      WHERE c.answer_id = ?
      ORDER BY c.marker`),
    events: db.prepare<[string], AnswerEvent>(
      'SELECT type, at, detail FROM answer_events WHERE answer_id = ? ORDER BY at, rowid',
    ),
    // Bound parameter is a JSON array of passage ids.
    passagesSent: db.prepare<[string], SentPassageRow>(`
      SELECT p.id, p.page_start, v.source_id, s.title AS source_title
      FROM passages p
      JOIN source_versions v ON v.id = p.version_id
      JOIN sources s ON s.id = v.source_id
      WHERE p.id IN (SELECT value FROM json_each(?))`),
  };
}

let prepared: Statements | undefined;

function stmts(): Statements {
  return (prepared ??= prepare(getDb()));
}

// ---- Mappers ------------------------------------------------------------------

function mapVersion(r: VersionRow): SourceVersion {
  return {
    id: r.id,
    sourceId: r.source_id,
    versionNo: r.version_no,
    fileName: r.file_name,
    pageCount: r.page_count,
    documentDate: r.document_date,
    versionLabel: r.version_label,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    applicability: r.applicability,
    applicabilityNote: r.applicability_note,
    verifiedAt: r.verified_at,
    processingStatus: r.processing_status,
    processingError: r.processing_error,
    extractionWarning: r.extraction_warning,
    passageCount: r.passage_count,
    pdfUrl: `/api/files/${r.id}`,
    createdAt: r.created_at,
  };
}

// `versions` must be newest first (version_no DESC).
function mapSource(r: SourceRow, versions: SourceVersion[]): Source {
  return {
    id: r.id,
    title: r.title,
    authority: r.authority,
    level: r.level,
    docType: r.doc_type,
    scope: r.scope,
    originalUrl: r.original_url,
    enabled: r.enabled === 1,
    summary: r.summary,
    currentVersion: versions.find((v) => v.id === r.current_version_id) ?? null,
    versions,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPassage(r: PassageRow): Passage {
  return {
    id: r.id,
    versionId: r.version_id,
    sourceId: r.source_id,
    sourceTitle: r.source_title,
    ordinal: r.ordinal,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    article: r.article,
    section: r.section,
    text: r.text,
    pdfUrl: `/api/files/${r.version_id}#page=${r.page_start}`,
  };
}

function mapCitation(r: CitationRow): Citation {
  return {
    marker: r.marker,
    passageId: r.passage_id,
    versionId: r.version_id,
    sourceId: r.source_id,
    sourceTitle: r.source_title,
    authority: r.authority,
    level: r.level,
    originalUrl: r.original_url,
    documentDate: r.document_date,
    versionLabel: r.version_label,
    applicability: r.applicability,
    applicabilityNote: r.applicability_note,
    verifiedAt: r.verified_at,
    sourceEnabled: r.enabled === 1,
    isCurrentVersion: r.current_version_id === r.version_id,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    article: r.article,
    section: r.section,
    quoteText: r.quote_text,
    highlight: r.highlight,
    pdfUrl: `/api/files/${r.version_id}#page=${r.page_start}`,
    checked: r.checked === 1,
    checkNote: r.check_note,
    checkedAt: r.checked_at,
  };
}

// ---- Sources ------------------------------------------------------------------

// Newest first. Two statements in total, whatever the number of sources.
export function listSources(): Source[] {
  const s = stmts();
  const versionsBySource = new Map<string, SourceVersion[]>();
  for (const row of s.versions.all()) {
    const list = versionsBySource.get(row.source_id);
    if (list) list.push(mapVersion(row));
    else versionsBySource.set(row.source_id, [mapVersion(row)]);
  }
  return s.sources.all().map((row) => mapSource(row, versionsBySource.get(row.id) ?? []));
}

export function getSource(id: string): Source | null {
  const s = stmts();
  const row = s.sourceById.get(id);
  return row ? mapSource(row, s.versionsBySource.all(id).map(mapVersion)) : null;
}

// Where the PDF of a version lives on disk, for GET /api/files/:versionId.
export function getVersionFile(versionId: string): { filePath: string; fileName: string } | null {
  const row = stmts().versionFile.get(versionId);
  return row ? { filePath: row.file_path, fileName: row.file_name } : null;
}

// ---- Passages -----------------------------------------------------------------

export function listPassages(versionId: string): Passage[] {
  return stmts().passagesByVersion.all(versionId).map(mapPassage);
}

export function getPassage(id: string): Passage | null {
  const row = stmts().passageById.get(id);
  return row ? mapPassage(row) : null;
}

// ---- Answers ------------------------------------------------------------------

// Newest first.
export function listAnswers(): AnswerListItem[] {
  return stmts().answers.all().map((r) => ({
    id: r.id,
    question: r.question,
    status: r.status,
    canAnswer: r.can_answer,
    citationCount: r.citation_count,
    checkedCount: r.checked_count,
    createdAt: r.created_at,
  }));
}

export function getAnswer(id: string): Answer | null {
  const s = stmts();
  const row = s.answerById.get(id);
  if (!row) return null;

  const citations = s.citations.all(id).map(mapCitation);
  const citedPassageIds = new Set(citations.map((c) => c.passageId));

  const sent: SentPassage[] = JSON.parse(row.passages_sent_json);
  const sentRows = new Map<string, SentPassageRow>();
  for (const r of s.passagesSent.all(JSON.stringify(sent.map((p) => p.passageId)))) {
    sentRows.set(r.id, r);
  }
  const passagesSentList = sent.map(({ label, passageId }) => {
    const p = sentRows.get(passageId);
    return {
      passageId,
      label,
      cited: citedPassageIds.has(passageId),
      sourceTitle: p ? p.source_title : 'Onbekende passage',
      pageStart: p ? p.page_start : 0,
    };
  });
  const sourcesUsed = new Set(Array.from(sentRows.values(), (r) => r.source_id)).size;

  return {
    id: row.id,
    question: row.question,
    status: row.status,
    canAnswer: row.can_answer,
    generatedAnswer: row.generated_answer,
    reviewedAnswer: row.reviewed_answer,
    reviewNote: row.review_note,
    emailDraft: row.email_draft,
    gaps: JSON.parse(row.gaps_json),
    warnings: JSON.parse(row.warnings_json),
    conflicts: JSON.parse(row.conflicts_json),
    uncitedSentences: row.uncited_sentences,
    citations,
    events: s.events.all(id),
    provider: row.provider,
    model: row.model,
    effort: row.effort as Effort | null,
    passagesSent: passagesSentList.length,
    sourcesUsed,
    passagesSentList,
    promptSnapshot: row.prompt_snapshot,
    regeneratedFromId: row.regenerated_from_id,
    sourcesChangedSince: citations.some((c) => !c.isCurrentVersion || !c.sourceEnabled),
    scopeSourceIds: row.scope_json === null ? null : JSON.parse(row.scope_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
  };
}

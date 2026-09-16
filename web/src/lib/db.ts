// SQLite access for the whole engine. One connection per process (kept on
// globalThis so Next.js HMR does not open a new one per reload), DDL applied on
// first open. Storage lives under web/storage/ (gitignored):
//   storage/app.db      the database (WAL mode)
//   storage/files/      one PDF per source version, named {versionId}.pdf
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const STORAGE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.resolve(process.cwd(), 'storage');
export const FILES_DIR = path.join(STORAGE_DIR, 'files');
export const DB_PATH = path.join(STORAGE_DIR, 'app.db');

export function pdfPathForVersion(versionId: string): string {
  return path.join(FILES_DIR, `${versionId}.pdf`);
}

// Mirrors PLAN.md section 8.1. Passages and citations are never deleted or
// edited, so answers keep pointing at the exact evidence they were built on.
const DDL = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authority TEXT,
  level TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  scope TEXT,
  original_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  summary TEXT,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_versions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  version_no INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  page_count INTEGER,
  document_date TEXT,
  version_label TEXT,
  valid_from TEXT,
  valid_until TEXT,
  applicability TEXT NOT NULL DEFAULT 'unverified',
  applicability_note TEXT,
  verified_at TEXT,
  processing_status TEXT NOT NULL DEFAULT 'processing',
  processing_error TEXT,
  extraction_warning TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_versions_source ON source_versions(source_id, version_no);
CREATE INDEX IF NOT EXISTS idx_source_versions_sha ON source_versions(sha256);
CREATE TABLE IF NOT EXISTS passages (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES source_versions(id),
  ordinal INTEGER NOT NULL,
  page_start INTEGER NOT NULL,
  page_end INTEGER NOT NULL,
  article TEXT,
  section TEXT,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passages_version ON passages(version_id, ordinal);
CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(text, passage_id UNINDEXED, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  can_answer TEXT NOT NULL,
  generated_answer TEXT NOT NULL,
  reviewed_answer TEXT,
  review_note TEXT,
  email_draft TEXT,
  gaps_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  conflicts_json TEXT NOT NULL,
  uncited_sentences INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT,
  prompt_snapshot TEXT NOT NULL,
  passages_sent_json TEXT NOT NULL,
  raw_response TEXT,
  usage_json TEXT,
  regenerated_from_id TEXT,
  scope_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS answers_fts USING fts5(question, answer_id UNINDEXED, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS answer_citations (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL REFERENCES answers(id),
  marker INTEGER NOT NULL,
  passage_id TEXT NOT NULL REFERENCES passages(id),
  version_id TEXT NOT NULL,
  quote_text TEXT NOT NULL,
  highlight TEXT,
  checked INTEGER NOT NULL DEFAULT 0,
  check_note TEXT,
  checked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_answer_citations_answer ON answer_citations(answer_id, marker);
CREATE TABLE IF NOT EXISTS answer_events (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL REFERENCES answers(id),
  type TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_answer_events_answer ON answer_events(answer_id, at);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  type TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_events_source ON source_events(source_id, at);
CREATE TABLE IF NOT EXISTS passage_embeddings (
  passage_id TEXT PRIMARY KEY REFERENCES passages(id),
  dims INTEGER NOT NULL,
  vector BLOB NOT NULL
);
`;

declare global {
  // eslint-disable-next-line no-var
  var __economieAssistentDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (globalThis.__economieAssistentDb) return globalThis.__economieAssistentDb;
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);
  globalThis.__economieAssistentDb = db;
  return db;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

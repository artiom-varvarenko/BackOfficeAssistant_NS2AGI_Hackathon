// Shared contract between Part 1 (engine + API) and Part 2 (UI).
// Frozen after Sprint 0 — changes are announced in chat, never made silently.
// Mirrors PLAN.md section 6; the API shapes are in section 7.

export type Level = 'municipal' | 'provincial' | 'flemish' | 'federal';
export type DocType =
  | 'bylaw'
  | 'fee_regulation'
  | 'subsidy_regulation'
  | 'royal_decree'
  | 'brochure'
  | 'manual'
  | 'other';
export type Applicability = 'unverified' | 'verified' | 'historical' | 'superseded';
export type ProcessingStatus = 'processing' | 'ready' | 'failed';
export type AnswerStatus = 'draft' | 'approved' | 'rejected';
export type CanAnswer = 'ja' | 'gedeeltelijk' | 'nee';
export type ProviderId = 'openai' | 'anthropic' | 'google' | 'mistral' | 'azure' | 'custom';
export type LlmTask = 'answer' | 'draft' | 'summary';
export type Effort = 'none' | 'low' | 'medium' | 'high';

export interface SourceVersion {
  id: string;
  sourceId: string;
  versionNo: number;
  fileName: string;
  pageCount: number | null;
  documentDate: string | null; // ISO date; null = "datum onbekend"
  versionLabel: string | null;
  validFrom: string | null;
  validUntil: string | null;
  applicability: Applicability;
  applicabilityNote: string | null;
  verifiedAt: string | null;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  extractionWarning: string | null;
  passageCount: number;
  pdfUrl: string; // "/api/files/{id}"
  createdAt: string;
}

export interface Source {
  id: string;
  title: string;
  authority: string | null;
  level: Level;
  docType: DocType;
  scope: string | null;
  originalUrl: string | null;
  enabled: boolean;
  summary: string | null;
  currentVersion: SourceVersion | null;
  versions: SourceVersion[]; // newest first
  createdAt: string;
  updatedAt: string;
}

export interface Passage {
  id: string;
  versionId: string;
  sourceId: string;
  sourceTitle: string;
  ordinal: number;
  pageStart: number;
  pageEnd: number;
  article: string | null;
  section: string | null;
  text: string;
  pdfUrl: string; // "/api/files/{versionId}#page={pageStart}"
}

export interface Citation {
  marker: number;
  passageId: string;
  versionId: string;
  sourceId: string;
  sourceTitle: string;
  authority: string | null;
  level: Level;
  originalUrl: string | null;
  documentDate: string | null;
  versionLabel: string | null;
  applicability: Applicability;
  applicabilityNote: string | null;
  verifiedAt: string | null; // set when applicability === 'verified' ("Geverifieerd op {date}")
  sourceEnabled: boolean;
  isCurrentVersion: boolean;
  pageStart: number;
  pageEnd: number;
  article: string | null;
  section: string | null;
  quoteText: string; // snapshot of the passage text at answer time
  highlight: string | null; // verified verbatim fragment inside quoteText, or null
  pdfUrl: string; // "/api/files/{versionId}#page={pageStart}"
  checked: boolean;
  checkNote: string | null;
  checkedAt: string | null;
}

export interface AnswerEvent {
  type:
    | 'generated'
    | 'edited'
    | 'approved'
    | 'rejected'
    | 'reopened'
    | 'email_drafted'
    | 'citation_checked'
    | 'regenerated';
  at: string;
  detail: string | null;
}

export interface Answer {
  id: string;
  question: string;
  status: AnswerStatus;
  canAnswer: CanAnswer;
  generatedAnswer: string; // immutable AI text, contains [n] markers
  reviewedAnswer: string | null; // officer text; null = unchanged
  reviewNote: string | null;
  emailDraft: string | null;
  gaps: string[];
  warnings: string[];
  conflicts: string[];
  uncitedSentences: number;
  citations: Citation[];
  events: AnswerEvent[];
  provider: ProviderId;
  model: string;
  effort: Effort | null;
  passagesSent: number;
  sourcesUsed: number;
  passagesSentList?: {
    passageId: string;
    label: string;
    cited: boolean;
    sourceTitle: string;
    pageStart: number;
  }[];
  promptSnapshot?: string;
  regeneratedFromId: string | null;
  sourcesChangedSince: boolean;
  scopeSourceIds: string[] | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}

export interface AnswerListItem {
  id: string;
  question: string;
  status: AnswerStatus;
  canAnswer: CanAnswer;
  citationCount: number;
  checkedCount: number;
  createdAt: string;
}

export interface SearchHit {
  passage: Passage;
  snippet: string;
  score: number;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  hasKey: boolean;
  keySource: 'env' | 'db' | null;
  maskedKey: string | null;
  baseUrl: string | null;
  models: string[];
  supportsEffort: boolean;
}

export interface TaskModel {
  provider: ProviderId;
  model: string;
  effort: Effort | null;
}

export interface Settings {
  tasks: Record<LlmTask, TaskModel>;
  providers: ProviderInfo[];
  tts: { provider: 'none' | 'elevenlabs' | 'openai'; voiceId: string | null; hasKey: boolean };
  retrieval: { mode: 'bm25' | 'hybrid'; embeddingsAvailable: boolean };
  municipality: string;
  testedConfiguration: string; // "openai/gpt-6-astra"
}

export interface EventLogItem {
  id: string;
  at: string;
  kind: 'answer' | 'source';
  type: string;
  detail: string | null;
  answerId: string | null;
  sourceId: string | null;
  label: string;
}

export interface ApiError {
  error: { code: string; message: string };
}

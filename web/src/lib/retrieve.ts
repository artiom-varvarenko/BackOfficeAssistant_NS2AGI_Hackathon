// Retrieval (PLAN.md sections 8.4–8.5). Both lexical and semantic candidates
// share the enabled, ready, CURRENT-version SQL boundary and exact source scope.
// Hybrid mode requires complete, valid embeddings for that bounded corpus;
// plain search remains synchronous BM25 and never calls a model.
import { randomUUID } from 'node:crypto';
import type { Database, Statement } from 'better-sqlite3';
import { ApiError } from './api';
import { getDb } from './db';
import { createEmbeddingSession, EMBEDDING_DIMS, readEmbedding, type StoredEmbedding } from './embeddings';
import { getRetrievalMode, RETRIEVAL_CHAR_BUDGET } from './settings';
import type { Passage, SearchHit } from './types';

export interface RetrievedPassage {
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
  score: number;
}

export interface RetrievalOptions {
  sourceIds?: string[] | null; // absent/null = all; [] = none
  charBudget?: number; // default RETRIEVAL_CHAR_BUDGET
  maxPassages?: number; // default MAX_PASSAGES
  abortSignal?: AbortSignal;
}

export const MAX_PASSAGES = 40;
// bm25 candidates fetched before the budget fill; twice the selection cap so a
// run of long passages near the top cannot starve the fill.
const CANDIDATE_LIMIT = 80;
const SEARCH_LIMIT = 20;
const HYBRID_CANDIDATE_LIMIT = 40;
const RRF_K = 60;

// PLAN.md section 8.4 stop words, extended for the English interface.
const STOP_WORDS: Record<string, true> = Object.fromEntries(
  'de het een en van in op ik wil hoe wat is dat die voor met te om er ook aan bij dan mijn moet kan naar als zijn of niet wordt worden dien deze dit hoeveel welke waar wanneer nog the and for how what which where when with without can must should does want need are this that from have would your once'
    .split(' ')
    .map((w) => [w, true]),
);

// English officers search the original Dutch corpus. Expand municipal business
// vocabulary for BM25; quoted evidence is never translated or manufactured.
// Hybrid mode additionally embeds the original question across languages.
const ENGLISH_QUERY_TERMS: Record<string, string[]> = {
  market: ['markt'], markets: ['markten'], stall: ['standplaats', 'kraam'], stalls: ['standplaatsen', 'kramen'],
  pitch: ['standplaats', 'kavel'], permanent: ['vaste', 'abonnement'], fixed: ['vaste'],
  apply: ['aanvraag', 'indienen'], application: ['aanvraag', 'formulier'], applications: ['aanvragen'],
  register: ['aanmelden', 'registreren'], registration: ['aanmelding', 'registratie', 'inschrijving'],
  saturday: ['zaterdag'], cost: ['kostprijs', 'retributie', 'euro'], costs: ['kosten', 'retributie'],
  fee: ['retributie', 'tarief'], fees: ['retributies', 'tarieven'], electricity: ['elektriciteit'],
  half: ['halfjaarlijks', 'halfjaar'], year: ['jaar'], yearly: ['jaarlijks'], annual: ['jaarlijks'],
  subscription: ['abonnement'], subscriptions: ['abonnementen'], waiting: ['wachtlijst'],
  confirm: ['bevestigen'], confirmation: ['bevestiging'], cancel: ['opzeggen', 'stopzetting'],
  cancellation: ['opzegging'], stop: ['stoppen', 'opzeggen'], close: ['stopzetting'],
  business: ['zaak', 'onderneming'], businesses: ['ondernemingen'], entrepreneur: ['ondernemer'],
  startup: ['startpremie', 'starten'], grant: ['premie', 'subsidie'], grants: ['premies', 'subsidies'],
  employed: ['zelfstandige'], support: ['ondersteuning'], food: ['voeding', 'voedsel', 'levensmiddelen', 'favv'],
  license: ['machtiging', 'leurkaart'], licence: ['machtiging', 'leurkaart'], card: ['leurkaart'],
  sell: ['verkopen', 'verkoop'], selling: ['verkopen', 'verkoop'], trade: ['handel', 'ambulante'],
  terrace: ['terras', 'terrassen'], tables: ['tafels', 'terras'], permit: ['vergunning', 'toelating'],
  requirements: ['voorwaarden'], documents: ['documenten', 'bijlagen'], waitinglist: ['wachtlijst'],
};

// Lowercase, fold diacritics the way the unicode61 tokenizer does (so "één"
// is recognised as the stop word "een"), split on anything that is not a
// letter or digit, drop short tokens and stop words, dedupe in question order.
export function tokenizeQuery(q: string): string[] {
  const seen = new Set<string>();
  const folded = q.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
  for (const token of folded.split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 3 || STOP_WORDS[token] === true) continue;
    seen.add(token);
    for (const translation of ENGLISH_QUERY_TERMS[token] ?? []) seen.add(translation);
  }
  return Array.from(seen);
}

// The index is not stemmed (unicode61), so a question word only matches the
// exact form it was typed in. Prefix queries close that gap when the shared
// stem is known: the forms below are the prefixes an inflected Dutch word
// shares with its other forms, with the spelling changes of the language
// (kramen → kraam, zetten → zet, bewijzen → bewijs, verkopen → verkoop).
// Every prefix is at least MIN_STEM letters; shorter stems keep the full word.
const MIN_STEM = 4;
const DOUBLE_CONSONANT_RE = /([bcdfgklmnprst])\1$/;
const OPEN_SYLLABLE_RE = /[^aeiouy][aeou][bcdfgklmnprstvz]$/;
const SOFT_FINAL: Record<string, string> = { v: 'f', z: 's' };

// Stem prefixes of an -en (plural/infinitive) or -s (plural) form; [] when the
// word is not inflected or its stem is too short. The stems are prefixes of
// the word itself, so they replace it in the query.
function stemPrefixes(token: string): string[] {
  if (token.endsWith('en') && token.length >= MIN_STEM + 2) {
    const stem = token.slice(0, -2);
    if (DOUBLE_CONSONANT_RE.test(stem)) {
      const single = stem.slice(0, -1);
      return single.length >= MIN_STEM ? [single] : [];
    }
    if (stem.length < MIN_STEM) return [];
    const last = stem.slice(-1);
    if (OPEN_SYLLABLE_RE.test(stem)) {
      // verkop → verkoop, geloov → geloof
      return [stem, `${stem.slice(0, -1)}${stem.slice(-2, -1)}${SOFT_FINAL[last] ?? last}`];
    }
    return SOFT_FINAL[last] ? [stem, `${stem.slice(0, -1)}${SOFT_FINAL[last]}`] : [stem];
  }
  if (token.endsWith('s') && token.length > MIN_STEM) return [token.slice(0, -1)];
  return [];
}

// Separable verbs are split in running text ("aanmelden" → "meldt zich aan"),
// so the bare verb stem is queried next to the compound.
const SEPARABLE_PREFIXES = [
  'achter', 'binnen', 'buiten', 'samen', 'tegen', 'terug', 'voort', 'door', 'mee', 'neer',
  'open', 'over', 'vast', 'voor', 'weer', 'rond', 'aan', 'bij', 'los', 'toe', 'uit', 'weg',
  'af', 'in', 'na', 'om', 'op',
];

function separableStems(token: string): string[] {
  if (!token.endsWith('en')) return [];
  for (const prefix of SEPARABLE_PREFIXES) {
    if (token.startsWith(prefix) && token.length - prefix.length >= MIN_STEM + 1) {
      return stemPrefixes(token.slice(prefix.length)).filter((s) => STOP_WORDS[s] !== true);
    }
  }
  return [];
}

// Whether any indexed passage has a word starting with `term`. Probed against
// the whole index: this is vocabulary, not the retrieval scope.
function inVocabulary(term: string): boolean {
  return stmts().exists.get(`"${term}"*`) !== undefined;
}

// A word absent from the corpus (compound, jargon, typo: "leurkaart") backs off
// to the longest prefix of at least MIN_STEM letters that the corpus knows
// ("leur" → leurhandel); null when none exists.
function longestKnownPrefix(token: string): string | null {
  for (let end = token.length - 1; end >= MIN_STEM; end--) {
    const prefix = token.slice(0, end);
    if (inVocabulary(prefix)) return prefix;
  }
  return null;
}

// Query terms for the tokens: inflection-aware prefixes that exist in the
// corpus vocabulary, the separable-verb stem, and the unknown-word back-off.
export function expandTerms(tokens: string[]): string[] {
  const terms = new Set<string>();
  for (const token of tokens) {
    const stems = stemPrefixes(token);
    let found = false;
    for (const form of stems.length > 0 ? stems : [token]) {
      if (!inVocabulary(form)) continue;
      terms.add(form);
      found = true;
    }
    if (!found) {
      const prefix = longestKnownPrefix(token);
      if (prefix !== null) terms.add(prefix);
    }
    for (const stem of separableStems(token)) if (inVocabulary(stem)) terms.add(stem);
  }
  return Array.from(terms);
}

// `"tok1"* OR "tok2"* OR …`. Every term is quoted, so FTS5 operators typed
// in a question (AND, NOT, NEAR, parentheses, colons) are never interpreted.
export function buildFtsQuery(tokens: string[]): string | null {
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' OR ');
}

// ---- SQL ----------------------------------------------------------------------

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
  score: number;
}

interface SearchRow extends PassageRow {
  snippet: string;
}

interface EmbeddingRow {
  id: string;
  dims: number | null;
  vector: Buffer | null;
}

const PASSAGE_COLUMNS = `
  p.id, p.version_id, v.source_id, s.title AS source_title,
  p.ordinal, p.page_start, p.page_end, p.article, p.section, p.text`;

// The corpus boundary: only what an officer could open and cite today.
// @scope is NULL or a JSON array of source ids.
const CORPUS_JOIN = `
  JOIN source_versions v ON v.id = p.version_id
  JOIN sources s ON s.id = v.source_id`;
const CORPUS_WHERE = `
  s.enabled = 1 AND v.processing_status = 'ready' AND s.current_version_id = v.id
  AND (@scope IS NULL OR s.id IN (SELECT value FROM json_each(@scope)))`;

interface Statements {
  exists: Statement<[string], { hit: number }>;
  ranked: Statement<[{ query: string; scope: string | null; limit: number }], PassageRow>;
  search: Statement<
    [{ query: string; scope: string | null; limit: number; startMark: string; endMark: string }],
    SearchRow
  >;
  fallback: Statement<[{ scope: string | null; limit: number }], PassageRow>;
  embeddings: Statement<[{ scope: string | null }], EmbeddingRow>;
  corpusIds: Statement<[{ scope: string | null }], { id: string }>;
  byIds: Statement<[{ scope: string | null; ids: string }], PassageRow>;
}

function prepare(db: Database): Statements {
  return {
    // Vocabulary probe for one quoted prefix term; a row when the corpus has it.
    exists: db.prepare('SELECT 1 AS hit FROM passages_fts WHERE passages_fts MATCH ? LIMIT 1'),
    // bm25() is negative-is-better, so ascending order is best first.
    ranked: db.prepare(`
      SELECT ${PASSAGE_COLUMNS}, bm25(passages_fts) AS score
      FROM passages_fts f
      JOIN passages p ON p.id = f.passage_id ${CORPUS_JOIN}
      WHERE passages_fts MATCH @query AND ${CORPUS_WHERE}
      ORDER BY score LIMIT @limit`),
    search: db.prepare(`
      SELECT ${PASSAGE_COLUMNS}, bm25(passages_fts) AS score,
             snippet(passages_fts, 0, @startMark, @endMark, '…', 24) AS snippet
      FROM passages_fts f
      JOIN passages p ON p.id = f.passage_id ${CORPUS_JOIN}
      WHERE passages_fts MATCH @query AND ${CORPUS_WHERE}
      ORDER BY score LIMIT @limit`),
    // Round-robin over the sources by ordinal: the opening passages of every
    // document, for questions whose words occur nowhere in the corpus.
    fallback: db.prepare(`
      SELECT ${PASSAGE_COLUMNS}, 0 AS score
      FROM passages p ${CORPUS_JOIN}
      WHERE ${CORPUS_WHERE}
      ORDER BY p.ordinal, s.title, s.id LIMIT @limit`),
    // LEFT JOIN makes missing coverage visible, instead of silently restricting
    // semantic ranking to whichever sources happened to have been indexed.
    embeddings: db.prepare(`
      SELECT p.id, e.dims, e.vector FROM passages p ${CORPUS_JOIN}
      LEFT JOIN passage_embeddings e ON e.passage_id = p.id
      WHERE ${CORPUS_WHERE}`),
    corpusIds: db.prepare(`
      SELECT p.id FROM passages p ${CORPUS_JOIN}
      WHERE ${CORPUS_WHERE}`),
    byIds: db.prepare(`
      SELECT ${PASSAGE_COLUMNS}, 0 AS score
      FROM passages p ${CORPUS_JOIN}
      WHERE ${CORPUS_WHERE} AND p.id IN (SELECT value FROM json_each(@ids))`),
  };
}

let prepared: Statements | undefined;

function stmts(): Statements {
  return (prepared ??= prepare(getDb()));
}

// Preserve the difference between an absent scope and an explicitly empty one.
function scopeParam(sourceIds: string[] | null | undefined): string | null {
  return sourceIds == null ? null : JSON.stringify([...new Set(sourceIds)]);
}

function mapRetrieved(r: PassageRow): RetrievedPassage {
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
    score: r.score,
  };
}

// Same shape as dto.ts produces for GET /api/sources/:id/passages.
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

// ---- Selection ----------------------------------------------------------------

function rankedCandidates(question: string, scope: string | null, limit = CANDIDATE_LIMIT): PassageRow[] {
  const query = buildFtsQuery(expandTerms(tokenizeQuery(question)));
  if (query === null) return [];
  return stmts().ranked.all({ query, scope, limit });
}

async function hybridCandidates(
  question: string,
  scope: string | null,
  abortSignal?: AbortSignal,
): Promise<{ rows: PassageRow[]; ftsHits: number }> {
  // Resolve/capture the key before checking coverage, but do not spend a model
  // call when the selected corpus still needs indexing.
  const session = createEmbeddingSession(abortSignal);
  const sql = stmts();
  const corpus = sql.embeddings.all({ scope });
  const vectors = new Map<string, StoredEmbedding>();
  let missing = 0;
  let corrupt = 0;
  for (const row of corpus) {
    const embedding = readEmbedding(row.dims, row.vector);
    if (embedding) vectors.set(row.id, embedding);
    else if (row.dims === null && row.vector === null) missing++;
    else corrupt++;
  }
  if (corpus.length === 0 || missing > 0 || corrupt > 0) {
    const detail = corpus.length === 0
      ? 'Er zijn geen passages met embeddings in de geselecteerde, actieve bronnen.'
      : `De geselecteerde, actieve bronnen bevatten ${missing} passages zonder embeddings en ${corrupt} passages met ongeldige embeddings.`;
    throw new ApiError(
      409,
      vectors.size === 0 ? 'embeddings_required' : 'embeddings_incomplete',
      `${detail} Bereken de embeddings voor alle geselecteerde bronnen opnieuw via Instellingen, of kies Alleen tekstzoeken (BM25).`,
    );
  }

  const [queryVector] = await session.embed([question]);
  const query = readEmbedding(EMBEDDING_DIMS, queryVector);
  if (!query) throw new ApiError(502, 'model_failed', 'OpenAI gaf een ongeldige embedding voor de vraag terug.');
  const normalizedQuery = new Float64Array(EMBEDDING_DIMS);
  for (let i = 0; i < EMBEDDING_DIMS; i++) {
    normalizedQuery[i] = query.values.getFloat32(i * 4, true) / query.norm;
  }

  return getDb().transaction(() => {
    // No transaction spans a network await. Recheck only IDs, not a second copy
    // of every BLOB: a changed source scope/current version must never leak the
    // old semantic snapshot. Immutable passage IDs make this comparison exact.
    const currentIds = sql.corpusIds.all({ scope });
    if (currentIds.length !== vectors.size || currentIds.some(({ id }) => !vectors.has(id))) {
      throw new ApiError(409, 'source_changed', 'De actieve bronnen zijn tijdens het zoeken gewijzigd. Stel de vraag opnieuw.');
    }

    const semantic = Array.from(vectors, ([id, embedding]) => {
      let dot = 0;
      for (let i = 0; i < EMBEDDING_DIMS; i++) {
        dot += normalizedQuery[i] * embedding.values.getFloat32(i * 4, true);
      }
      // Both norms are positive and finite. Clamp floating-point roundoff at
      // the cosine boundaries; negative similarities remain legitimate ranks.
      return { id, score: Math.max(-1, Math.min(1, dot / embedding.norm)) };
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, HYBRID_CANDIDATE_LIMIT);
    const lexical = rankedCandidates(question, scope, HYBRID_CANDIDATE_LIMIT);
    const fused = new Map<string, PassageRow>();
    lexical.forEach((row, index) => fused.set(row.id, { ...row, score: 1 / (RRF_K + index + 1) }));
    const semanticRanks = new Map(semantic.map(({ id }, index) => [id, index + 1]));
    const semanticRows = sql.byIds.all({ scope, ids: JSON.stringify(semantic.map(({ id }) => id)) });
    for (const row of semanticRows) {
      const rank = semanticRanks.get(row.id)!;
      const score = 1 / (RRF_K + rank);
      const existing = fused.get(row.id);
      if (existing) existing.score += score;
      else fused.set(row.id, { ...row, score });
    }
    return {
      rows: Array.from(fused.values()).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)),
      ftsHits: lexical.length,
    };
  })();
}

// Takes candidates in the given order until the character budget or the
// passage cap is reached. A first passage longer than the whole budget is
// still taken, so the model never receives an empty context.
function fillBudget(rows: PassageRow[], charBudget: number, maxPassages: number): PassageRow[] {
  const selected: PassageRow[] = [];
  let chars = 0;
  for (const row of rows) {
    if (selected.length >= maxPassages) break;
    if (selected.length > 0 && chars + row.text.length > charBudget) break;
    selected.push(row);
    chars += row.text.length;
  }
  return selected;
}

function byDocumentOrder(a: PassageRow, b: PassageRow): number {
  return (
    a.source_title.localeCompare(b.source_title, 'nl') ||
    a.source_id.localeCompare(b.source_id) ||
    a.ordinal - b.ordinal
  );
}

export async function retrievePassages(
  question: string,
  opts: RetrievalOptions = {},
): Promise<{ passages: RetrievedPassage[]; ftsHits: number }> {
  if (opts.sourceIds?.length === 0) return { passages: [], ftsHits: 0 };
  opts.abortSignal?.throwIfAborted();
  const scope = scopeParam(opts.sourceIds);
  const charBudget = opts.charBudget ?? RETRIEVAL_CHAR_BUDGET;
  const maxPassages = opts.maxPassages !== undefined && Number.isFinite(opts.maxPassages)
    ? Math.max(0, Math.min(Math.floor(opts.maxPassages), MAX_PASSAGES))
    : MAX_PASSAGES;
  let rows: PassageRow[];
  let ftsHits: number;
  if (getRetrievalMode() === 'hybrid') {
    ({ rows, ftsHits } = await hybridCandidates(question, scope, opts.abortSignal));
  } else {
    const candidates = rankedCandidates(question, scope);
    ftsHits = candidates.length;
    rows = candidates.length > 0 ? candidates : stmts().fallback.all({ scope, limit: maxPassages });
  }
  const selected = fillBudget(rows, charBudget, maxPassages).sort(byDocumentOrder);
  return { passages: selected.map(mapRetrieved), ftsHits };
}

const SNIPPET_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// GET /api/search: same boundary and query, without fallback. Snippet text is
// HTML-escaped; only the FTS-generated hit markers remain bare <mark> tags.
export function searchPassages(
  q: string,
  opts: { limit?: number; sourceIds?: string[] | null } = {},
): SearchHit[] {
  if (opts.sourceIds?.length === 0) return [];
  const query = buildFtsQuery(expandTerms(tokenizeQuery(q)));
  if (query === null) return [];
  const scope = scopeParam(opts.sourceIds);
  const limit = opts.limit ?? SEARCH_LIMIT;
  let startMark: string;
  let endMark: string;
  let rows: SearchRow[];
  do {
    const nonce = randomUUID();
    startMark = `${nonce}:start`;
    endMark = `${nonce}:end`;
    rows = stmts().search.all({ query, scope, limit, startMark, endMark });
    // Even literal <mark> in a PDF is source text, not a trusted hit marker.
    // Check the entire original passage to rule out sentinel collisions.
  } while (rows.some((r) => r.text.includes(startMark) || r.text.includes(endMark)));
  return rows.map((r) => ({
    passage: mapPassage(r),
    snippet: r.snippet
      .replace(/[&<>"']/g, (character) => SNIPPET_ESCAPES[character])
      .replaceAll(startMark, '<mark>')
      .replaceAll(endMark, '</mark>'),
    score: r.score,
  }));
}

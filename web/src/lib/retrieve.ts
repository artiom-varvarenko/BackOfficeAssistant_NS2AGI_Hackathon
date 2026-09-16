// Retrieval (PLAN.md section 8.4). BM25 over passages_fts,
// bounded in SQL to the corpus that may be cited (source enabled, version
// ready and current, optional scope), filled in rank order until the character
// budget, then re-sorted by (source, ordinal) so the model reads every document
// in its natural order. The same boundary and query serve GET /api/search.
//
// Answer retrieval optionally combines BM25 and embedding ranks. Direct
// source search remains deterministic BM25 and never contacts a provider.
import { randomUUID } from 'node:crypto';
import type { Database, Statement } from 'better-sqlite3';
import { ApiError } from './api';
import { getDb } from './db';
import { decodeEmbedding, embedQuery } from './embeddings';
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
  sourceIds?: string[] | null; // non-empty array = restrict to these sources
  charBudget?: number; // default RETRIEVAL_CHAR_BUDGET
  maxPassages?: number; // default MAX_PASSAGES
  signal?: AbortSignal;
}

export const MAX_PASSAGES = 40;
// bm25 candidates fetched before the budget fill; twice the selection cap so a
// run of long passages near the top cannot starve the fill.
const CANDIDATE_LIMIT = 80;
const SEARCH_LIMIT = 20;

// PLAN.md section 8.4, verbatim.
const STOP_WORDS: Record<string, true> = Object.fromEntries(
  'de het een en van in op ik wil hoe wat is dat die voor met te om er ook aan bij dan mijn moet kan naar als zijn of niet wordt worden dien deze dit hoeveel welke waar wanneer nog'
    .split(' ')
    .map((w) => [w, true]),
);

// Lowercase, fold diacritics the way the unicode61 tokenizer does (so "één"
// is recognised as the stop word "een"), split on anything that is not a
// letter or digit, drop short tokens and stop words, dedupe in question order.
export function tokenizeQuery(q: string): string[] {
  const seen = new Set<string>();
  const folded = q.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
  for (const token of folded.split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 3 || STOP_WORDS[token] === true) continue;
    seen.add(token);
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

interface EmbeddedRow extends PassageRow {
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
  db: Database;
  exists: Statement<[string], { hit: number }>;
  ranked: Statement<[{ query: string; scope: string | null; limit: number }], PassageRow>;
  search: Statement<
    [{ query: string; scope: string | null; limit: number; startMark: string; endMark: string }],
    SearchRow
  >;
  fallback: Statement<[{ scope: string | null; limit: number }], PassageRow>;
  embedded: Statement<[{ scope: string | null }], EmbeddedRow>;
}

function prepare(db: Database): Statements {
  return {
    db,
    // Vocabulary probe for one quoted prefix term; a row when the corpus has it.
    exists: db.prepare('SELECT 1 AS hit FROM passages_fts WHERE passages_fts MATCH ? LIMIT 1'),
    // bm25() is negative-is-better, so ascending order is best first.
    ranked: db.prepare(`
      SELECT ${PASSAGE_COLUMNS}, bm25(passages_fts) AS score
      FROM passages_fts f
      JOIN passages p ON p.id = f.passage_id ${CORPUS_JOIN}
      WHERE passages_fts MATCH @query AND ${CORPUS_WHERE}
      ORDER BY score, p.id LIMIT @limit`),
    search: db.prepare(`
      SELECT ${PASSAGE_COLUMNS}, bm25(passages_fts) AS score,
             snippet(passages_fts, 0, @startMark, @endMark, '…', 24) AS snippet
      FROM passages_fts f
      JOIN passages p ON p.id = f.passage_id ${CORPUS_JOIN}
      WHERE passages_fts MATCH @query AND ${CORPUS_WHERE}
      ORDER BY score, p.id LIMIT @limit`),
    // Round-robin over the sources by ordinal: the opening passages of every
    // document, for questions whose words occur nowhere in the corpus.
    fallback: db.prepare(`
      SELECT ${PASSAGE_COLUMNS}, 0 AS score
      FROM passages p ${CORPUS_JOIN}
      WHERE ${CORPUS_WHERE}
      ORDER BY p.ordinal, s.title, s.id, p.id LIMIT @limit`),
    embedded: db.prepare(`
      SELECT ${PASSAGE_COLUMNS}, 0 AS score, e.dims, e.vector
      FROM passages p ${CORPUS_JOIN}
      LEFT JOIN passage_embeddings e ON e.passage_id = p.id
      WHERE ${CORPUS_WHERE} ORDER BY p.id`),
  };
}

let prepared: Statements | undefined;

function stmts(): Statements {
  const db = getDb();
  if (prepared?.db !== db) prepared = prepare(db);
  return prepared;
}

// Binding for @scope: an empty or missing list means "the whole corpus".
function scopeParam(sourceIds: string[] | null | undefined): string | null {
  return sourceIds && sourceIds.length > 0 ? JSON.stringify(sourceIds) : null;
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

export function retrievePassages(
  question: string,
  opts: RetrievalOptions = {},
): { passages: RetrievedPassage[]; ftsHits: number } {
  const scope = scopeParam(opts.sourceIds);
  const charBudget = opts.charBudget ?? RETRIEVAL_CHAR_BUDGET;
  const maxPassages = opts.maxPassages ?? MAX_PASSAGES;

  const candidates = rankedCandidates(question, scope);
  const rows =
    candidates.length > 0 ? candidates : stmts().fallback.all({ scope, limit: maxPassages });
  const selected = fillBudget(rows, charBudget, maxPassages).sort(byDocumentOrder);
  return { passages: selected.map(mapRetrieved), ftsHits: candidates.length };
}

function embeddingRows(scope: string | null): { row: PassageRow; vector: number[] }[] {
  return stmts().embedded.all({ scope }).map((row) => {
    const vector = row.vector === null || row.dims === null ? null : decodeEmbedding(row.vector, row.dims);
    if (vector === null) {
      throw new ApiError(409, 'embeddings_missing', 'Niet alle geselecteerde bronnen zijn voorbereid op hybride zoeken. Bereken de embeddings onder Instellingen of kies Alleen tekstzoeken.');
    }
    return { row, vector };
  });
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export async function retrieveForAnswer(
  question: string,
  opts: RetrievalOptions = {},
): Promise<{ passages: RetrievedPassage[]; ftsHits: number }> {
  opts.signal?.throwIfAborted();
  if (getRetrievalMode() === 'bm25') return retrievePassages(question, opts);
  const scope = scopeParam(opts.sourceIds);
  // Do not spend a query embedding on an empty or unprepared corpus. Partial
  // coverage must never silently make enabled documents harder to retrieve.
  if (embeddingRows(scope).length === 0) return { passages: [], ftsHits: 0 };
  const queryVector = await embedQuery(question, opts.signal);
  // Query both rankings after the provider await in the same read snapshot:
  // a source disabled or replaced while embedding the question stays excluded.
  return getDb().transaction(() => {
    const semantic = embeddingRows(scope)
      .map(({ row, vector }) => ({ ...row, score: cosine(queryVector, vector) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 40);
    const lexical = rankedCandidates(question, scope, 40);
    const fused = new Map<string, PassageRow>();
    for (const ranking of [lexical, semantic]) {
      ranking.forEach((row, index) => {
        const contribution = 1 / (60 + index + 1);
        const existing = fused.get(row.id);
        if (existing) existing.score += contribution;
        else fused.set(row.id, { ...row, score: contribution });
      });
    }
    const candidates = Array.from(fused.values()).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const selected = fillBudget(candidates, opts.charBudget ?? RETRIEVAL_CHAR_BUDGET, opts.maxPassages ?? MAX_PASSAGES)
      .sort(byDocumentOrder);
    return { passages: selected.map(mapRetrieved), ftsHits: lexical.length };
  })();
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

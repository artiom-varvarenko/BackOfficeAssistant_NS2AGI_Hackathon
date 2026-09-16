// Pure chunking over extracted page text (PLAN.md section 8.2 steps 3-7).
// No I/O. Designed against the real unpdf output of the nine seed PDFs:
// pages come back as '\n'-separated lines without blank lines, bullets and
// "§n." markers are inline, running headers/footers sit in the first or last
// lines of a page, and article headings look like
//   "Artikel 13 - Vacature en ..."   "I Artikel 4.1: Openbare markten"
//   "Art. 1. Definities"             "Art. 2. § 1. Een operator mag ..."
// Passage text is stored as extracted (after header stripping and bullet
// joining), never "repaired".

export const UNREADABLE_MESSAGE =
  'Geen leesbare tekst gevonden. Dit lijkt een gescand of beeld-PDF; OCR wordt niet ondersteund.';

export interface ChunkPassage {
  pageStart: number;
  pageEnd: number;
  article: string | null;
  section: string | null;
  text: string;
}

export type ChunkResult =
  | { ok: true; mode: 'article' | 'page'; passages: ChunkPassage[]; warning: string | null }
  | { ok: false; error: string };

interface Line {
  text: string;
  page: number; // 1-based
  breakBefore: boolean; // a blank line preceded it in the extracted text
}

interface Draft {
  lines: Line[];
  article: string | null;
  section: string | null;
}

// Readability gate.
const EMPTY_PAGE_CHARS = 20; // non-whitespace chars below which a page counts as empty
const MIN_TOTAL_CHARS = 500;
const MAX_EMPTY_SHARE = 0.7;

// Running header/footer detection: a normalised line in the first/last ZONE
// lines of a page that recurs on at least RUNNING_MIN_PAGES pages and on at
// least RUNNING_MIN_SHARE of all pages. The share guard keeps repeated but
// non-running blocks (the KB's annex signature block on 4 of 66 pages) intact.
const ZONE = 3;
const RUNNING_MIN_PAGES = 3;
const RUNNING_MIN_SHARE = 0.2;

// Chunk sizes (characters).
const ARTICLE_LIMIT = 2000;
const PAGE_LIMIT = 1500;
const HARD_LIMIT = 4000; // an indivisible § block is kept whole up to this size
const MIN_PIECE = 300; // never cut off a fragment smaller than this at a paragraph boundary
const HEADING_MAX_LENGTH = 150; // a longer line that starts with "Artikel n" is body text

// The optional 1-2 character prefix absorbs the stray glyph of the retributies
// ("I Artikel 4.1: ..."), but not an opening quote or bracket: the KB quotes
// replacement articles as "« Artikel 1. ..." inside a modifying article.
const ARTICLE_RE = /^(?:[^\s"“«(\[]{1,2}\s+)?(Artikel|Art\.)\s*(\d+(?:\.\d+)?)\b[\s.:\-–]*(.*)$/;
const CHAPTER_RE = /^(Hoofdstuk|Afdeling|HOOFDSTUK|TITEL|Titel)\b/;
const SECTION_RE = /^§\s?(\d+)\s?\./;
const BULLET_ONLY_RE = /^[-•°o*·▪–\uf0b7]$/;
const SENTENCE_END_RE = /[.!?…;][)\]"”»’']*$/;
const LOWERCASE_START_RE = /^\p{Ll}/u;

export function chunkPages(rawPages: string[]): ChunkResult {
  const pages = stripRunningLines(toLines(rawPages));

  const pageChars = pages.map((lines) => lines.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0));
  const total = pageChars.reduce((a, b) => a + b, 0);
  const emptyPages = pageChars.filter((n) => n < EMPTY_PAGE_CHARS).length;
  if (total < MIN_TOTAL_CHARS || emptyPages > MAX_EMPTY_SHARE * pages.length) {
    return { ok: false, error: UNREADABLE_MESSAGE };
  }
  const warning = emptyPages > 0 ? `${emptyPages} van ${pages.length} pagina's bevatten geen leesbare tekst` : null;

  const lines = joinBullets(pages.flat());
  const { units, headingCount } = buildUnits(lines);
  const mode = headingCount >= 3 ? 'article' : 'page';
  const drafts =
    mode === 'article'
      ? units.flatMap(unitDrafts)
      : pages.flatMap((page) => splitByParagraph(page, PAGE_LIMIT).map((lines) => ({ lines, article: null, section: null })));

  return { ok: true, mode, passages: drafts.map(materialise), warning };
}

// --- line stream ---------------------------------------------------------

function toLines(rawPages: string[]): Line[][] {
  return rawPages.map((raw, i) => {
    const out: Line[] = [];
    let breakBefore = false;
    for (const rawLine of raw.split(/\r?\n/)) {
      const text = rawLine.trim();
      if (text === '') {
        breakBefore = true;
        continue;
      }
      out.push({ text, page: i + 1, breakBefore });
      breakBefore = false;
    }
    return out;
  });
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\d+/g, '#').trim();
}

// Headings and § markers are never treated as running lines, whatever their
// frequency ("Artikel #" would otherwise match across pages).
const PROTECTED_RES = [ARTICLE_RE, CHAPTER_RE, SECTION_RE];

// "Pagina 2 van 2"-style page counters are footers even in documents too short
// for the frequency rule (the 2-page retributies would otherwise carry its
// footer into Art. 4.1 and stretch that passage to p. 1–2).
const PAGE_COUNTER_RE = /^(?:pagina|page|blz\.?|p\.)\s*\d+\s*(?:van|of|\/)\s*\d+$/i;

function stripRunningLines(pages: Line[][]): Line[][] {
  const inZone = (index: number, count: number) => index < ZONE || index >= count - ZONE;

  const running = new Set<string>();
  if (pages.length >= RUNNING_MIN_PAGES) {
    const pagesByKey = new Map<string, Set<number>>();
    pages.forEach((lines, p) => {
      lines.forEach((line, i) => {
        if (!inZone(i, lines.length)) return;
        const key = normalise(line.text);
        let set = pagesByKey.get(key);
        if (!set) pagesByKey.set(key, (set = new Set()));
        set.add(p);
      });
    });
    const minPages = Math.max(RUNNING_MIN_PAGES, Math.ceil(pages.length * RUNNING_MIN_SHARE));
    for (const [key, set] of pagesByKey) if (set.size >= minPages) running.add(key);
  }

  return pages.map((lines) =>
    lines.filter((line, i) => {
      if (!inZone(i, lines.length)) return true;
      if (PAGE_COUNTER_RE.test(line.text)) return false;
      return !(running.has(normalise(line.text)) && !PROTECTED_RES.some((re) => re.test(line.text)));
    }),
  );
}

// A bullet character alone on a line belongs to the line that follows it.
function joinBullets(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (next && BULLET_ONLY_RE.test(line.text)) {
      out.push({ text: `${line.text} ${next.text}`, page: next.page, breakBefore: line.breakBefore });
      i++;
    } else {
      out.push(line);
    }
  }
  return out;
}

// --- headings ------------------------------------------------------------

interface ArticleMatch {
  cleaned: string; // heading line without the stray glyph prefix
  title: string;
}

function matchArticle(text: string): ArticleMatch | null {
  if (text.length > HEADING_MAX_LENGTH) return null;
  const m = ARTICLE_RE.exec(text);
  if (!m) return null;
  return { cleaned: text.slice(text.indexOf(m[1])).trim(), title: m[3].trim() };
}

function isChapterHeading(text: string): boolean {
  return text.length <= HEADING_MAX_LENGTH && CHAPTER_RE.test(text);
}

// The passage label for an article heading. "Art. 2. § 1. Een operator ..."
// (Staatsblad style, body on the heading line) becomes "Art. 2.". A heading
// without title takes a short next line as its title ("Art. 1." / "Definities");
// a heading whose title wraps onto a short lower-case next line is completed
// ("... voor de subsi-" / "die"). The text itself is left untouched.
function articleLabel(match: ArticleMatch, next: Line | undefined): string {
  const { cleaned, title } = match;
  if (title.startsWith('§')) return cleaned.slice(0, cleaned.lastIndexOf(title)).trim();
  if (!next || matchArticle(next.text) || isChapterHeading(next.text) || /[.:;]$/.test(next.text)) return cleaned;
  const continuation = next.text;
  if (title === '') return continuation.length < 80 ? `${cleaned} ${continuation}` : cleaned;
  if (continuation.length >= 40) return cleaned;
  if (title.endsWith('-')) return cleaned.slice(0, -1) + continuation;
  if (LOWERCASE_START_RE.test(continuation)) return `${cleaned} ${continuation}`;
  return cleaned;
}

// --- article mode --------------------------------------------------------

interface Unit {
  article: string | null;
  lines: Line[];
  bodyCount: number;
}

// Cuts the stream into units: the preamble, then one unit per article. A
// chapter/afdeling heading (with the short lower-case lines it wraps onto)
// closes the running unit and is carried as a leading line into the next
// article's unit; so is an article heading without body ("Artikel 4:" directly
// followed by "Artikel 4.1:").
function buildUnits(lines: Line[]): { units: Unit[]; headingCount: number } {
  const units: Unit[] = [];
  let current: Unit = { article: null, lines: [], bodyCount: 0 };
  let headingCount = 0;
  const closeIfBody = () => {
    if (current.bodyCount === 0) return;
    units.push(current);
    current = { article: null, lines: [], bodyCount: 0 };
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const article = matchArticle(line.text);
    if (article) {
      headingCount++;
      closeIfBody();
      current.article = articleLabel(article, lines[i + 1]);
      current.lines.push(line);
    } else if (isChapterHeading(line.text)) {
      closeIfBody();
      current.article = null;
      current.lines.push(line);
      // wrapped rest of the heading: short lines starting in lower case
      while (i + 1 < lines.length && lines[i + 1].text.length < 80 && LOWERCASE_START_RE.test(lines[i + 1].text)) {
        current.lines.push(lines[++i]);
      }
    } else {
      current.lines.push(line);
      current.bodyCount++;
    }
  }
  if (current.lines.length > 0) units.push(current);
  return { units, headingCount };
}

function unitDrafts(unit: Unit): Draft[] {
  const { article } = unit;
  if (textLength(unit.lines) <= ARTICLE_LIMIT) return [{ lines: unit.lines, article, section: null }];
  const blocks = splitAtSections(unit.lines);
  const drafts =
    blocks.filter((b) => b.section !== null).length >= 2
      ? packSections(blocks, article)
      : splitByParagraph(unit.lines, ARTICLE_LIMIT).map((lines) => ({ lines, article, section: null }));
  return drafts.flatMap((d) =>
    textLength(d.lines) > HARD_LIMIT
      ? splitByParagraph(d.lines, ARTICLE_LIMIT).map((lines) => ({ ...d, lines }))
      : [d],
  );
}

interface SectionBlock {
  section: number | null; // null = the lines before the first § marker
  lines: Line[];
}

// A Staatsblad heading carries its first paragraph on the heading line
// ("Art. 2. § 1. Een operator ..."), which counts as that paragraph's start.
function splitAtSections(lines: Line[]): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  let current: SectionBlock = { section: null, lines: [] };
  for (const line of lines) {
    const m = SECTION_RE.exec(line.text) ?? SECTION_RE.exec(matchArticle(line.text)?.title ?? '');
    if (m) {
      if (current.lines.length > 0) blocks.push(current);
      current = { section: Number(m[1]), lines: [] };
    }
    current.lines.push(line);
  }
  if (current.lines.length > 0) blocks.push(current);
  return blocks;
}

// Greedily packs consecutive § blocks into pieces of at most ARTICLE_LIMIT
// characters. The lines before the first § always stay with the first block;
// a block that is too big on its own is kept whole.
function packSections(blocks: SectionBlock[], article: string | null): Draft[] {
  const drafts: Draft[] = [];
  let lines: Line[] = [];
  let first: number | null = null;
  let last: number | null = null;
  const flush = () => {
    if (lines.length === 0) return;
    const section = first === null ? null : first === last ? `§${first}` : `§${first}–${last}`;
    drafts.push({ lines, article, section });
    lines = [];
    first = last = null;
  };
  for (const block of blocks) {
    if (first !== null && textLength(lines) + 1 + textLength(block.lines) > ARTICLE_LIMIT) flush();
    lines.push(...block.lines);
    if (block.section !== null) {
      if (first === null) first = block.section;
      last = block.section;
    }
  }
  flush();
  return drafts;
}

// --- paragraph splitting (page mode and oversized non-§ passages) --------

// Splits a run of lines into pieces of at most `limit` characters. The run is
// divided into as few pieces as the limit allows, each cut at the paragraph
// boundary closest to the equal-share size (never leaving a fragment under
// MIN_PIECE), else at the last line that still fits. A single line longer than
// the limit is never split. A paragraph boundary is a blank line in the
// extracted text or a sentence/list-item end followed by a line that does not
// start in lower case; a line ending in ":" therefore keeps the list that
// follows it.
function splitByParagraph(lines: Line[], limit: number): Line[][] {
  const out: Line[][] = [];
  let rest = lines;
  for (;;) {
    const total = textLength(rest);
    if (total <= limit) {
      if (rest.length > 0) out.push(rest);
      return out;
    }
    const target = total / Math.ceil(total / limit);
    let best = 0;
    let bestDistance = Infinity;
    let fallback = 1;
    let length = 0;
    for (let k = 1; k < rest.length; k++) {
      length += rest[k - 1].text.length + (k > 1 ? 1 : 0); // length of rest[0..k)
      if (length > limit) break;
      fallback = k;
      if (length < MIN_PIECE) continue;
      const { breakBefore, text } = rest[k];
      if (!breakBefore && !(SENTENCE_END_RE.test(rest[k - 1].text) && !LOWERCASE_START_RE.test(text))) continue;
      const distance = Math.abs(length - target);
      if (distance < bestDistance) {
        best = k;
        bestDistance = distance;
      }
    }
    const cut = best || fallback;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
}

// --- output --------------------------------------------------------------

function textLength(lines: Line[]): number {
  let n = 0;
  for (const line of lines) n += line.text.length + 1;
  return n === 0 ? 0 : n - 1;
}

function materialise(d: Draft): ChunkPassage {
  let pageStart = d.lines[0].page;
  let pageEnd = pageStart;
  for (const line of d.lines) {
    if (line.page < pageStart) pageStart = line.page;
    if (line.page > pageEnd) pageEnd = line.page;
  }
  return {
    pageStart,
    pageEnd,
    article: d.article,
    section: d.section,
    text: d.lines.map((l) => l.text).join('\n').trim(),
  };
}

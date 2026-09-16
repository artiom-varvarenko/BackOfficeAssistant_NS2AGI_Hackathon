// E-mail draft for the entrepreneur (PLAN.md section 8.4). The `draft` model
// rewrites the officer's reviewed text as a reply e-mail; the source list is
// NOT left to the model but appended here, deterministically, in the same
// format as the UI's copy footer (PLAN.md section 9) so both surfaces match.
// The draft is a concept for the officer to edit — nothing is sent.
import { ApiError } from './api';
import { getDb, nowIso } from './db';
import { getAnswer } from './dto';
import { addAnswerEvent } from './events';
import { generateTextPlain } from './llm';
import { MUNICIPALITY_NAME } from './settings';
import type { Answer, Citation } from './types';

const DRAFT_MAX_OUTPUT_TOKENS = 1200;

const SYSTEM = `Je schrijft namens een medewerker van de dienst lokale economie van gemeente ${MUNICIPALITY_NAME} een antwoord per e-mail aan een ondernemer. De medewerker heeft de tekst hieronder beoordeeld; jij zet die om in een verzendklare e-mail.
Regels:
1. Gebruik uitsluitend wat in de beoordeelde tekst staat. Voeg niets toe uit eigen kennis: geen nieuwe feiten, voorwaarden, bedragen, termijnen, links of procedures.
2. Laat bronverwijzingen zoals [1] of [2, 3] weg en maak geen bronnenlijst; die wordt automatisch onder de e-mail toegevoegd. De naam van een reglement mag je in de lopende tekst noemen.
3. Schrijf helder, zakelijk Nederlands in de u-vorm. Geen juridisch jargon, geen opmaak met sterretjes of koppen, geen onderwerpregel.
4. Begin met de aanhef "Beste" op een eigen regel, zonder naam.
5. Herschik het antwoord tot een prettig leesbare e-mail: eerst het directe antwoord, daarna stappen of voorwaarden als opsomming, elk op een eigen regel.
6. Meldt de beoordeelde tekst dat informatie ontbreekt of onzeker is, zeg dat dan ook in de e-mail en beloof niets wat er niet staat.
7. Sluit af met een zin die uitnodigt om bijkomende vragen te stellen, gevolgd door exact deze ondertekening:
Met vriendelijke groeten,
dienst lokale economie
Gemeente ${MUNICIPALITY_NAME}`;

// `[1]`, `[12]`, `[1, 2]`, `[1,2]`.
const MARKER = String.raw`\[\d+(?:[ \t]*,[ \t]*\d+)*\]`;
const LEADING_MARKERS = new RegExp(String.raw`^(?:${MARKER}[ \t]*)+`, 'gm');
const INLINE_MARKERS = new RegExp(String.raw`[ \t]*${MARKER}`, 'g');

// "{article} {section} — p. {pageStart}[–{pageEnd}]": the middle of a footer
// line, shared with the prompt so the model sees the same reference.
function reference(c: Citation): string {
  const pages = c.pageEnd > c.pageStart ? `${c.pageStart}–${c.pageEnd}` : `${c.pageStart}`;
  return `${c.article ?? 'passage'}${c.section ? ` ${c.section}` : ''} — p. ${pages}`;
}

function buildPrompt(answer: Answer, text: string): string {
  const parts = [`VRAAG VAN DE ONDERNEMER:\n${answer.question}`, `BEOORDEELDE TEKST:\n${text}`];
  if (answer.citations.length > 0) {
    // Title, article and page only: the model may name the regulation in
    // prose, but URLs and the list itself are appended by the server.
    const lines = answer.citations.map((c) => `[${c.marker}] ${c.sourceTitle} — ${reference(c)}`);
    parts.push(`BRONNEN BIJ DE VERWIJZINGEN (ter informatie, niet opnemen in de e-mail):\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

// Removes any `[n]` markers the model left and tidies the whitespace that
// stripping leaves behind: no space before punctuation, no double spaces
// between words, no trailing spaces on a line.
function stripMarkers(text: string): string {
  return text
    .replace(LEADING_MARKERS, '')
    .replace(INLINE_MARKERS, '')
    .replace(/[ \t]+([.,;:!?)])/g, '$1')
    .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// One line per citation in marker order, identical to the UI's copy footer.
function sourcesFooter(citations: Citation[]): string {
  if (citations.length === 0) return '\n\nBronnen: geen bronverwijzingen in dit antwoord.';
  const lines = citations.map(
    (c) => `[${c.marker}] ${c.sourceTitle} — ${reference(c)} — ${c.originalUrl ?? '(intern document)'}`,
  );
  return `\n\nBronnen:\n${lines.join('\n')}`;
}

export async function draftEmail(answerId: string): Promise<Answer> {
  const answer = getAnswer(answerId);
  if (!answer) throw new ApiError(404, 'not_found', 'Antwoord niet gevonden.');
  const text = answer.reviewedAnswer ?? answer.generatedAnswer;

  const result = await generateTextPlain('draft', {
    system: SYSTEM,
    prompt: buildPrompt(answer, text),
    maxOutputTokens: DRAFT_MAX_OUTPUT_TOKENS,
  });
  const draft = stripMarkers(result.text) + sourcesFooter(answer.citations);

  const db = getDb();
  const at = nowIso();
  db.transaction(() => {
    db.prepare('UPDATE answers SET email_draft = ?, updated_at = ? WHERE id = ?').run(draft, at, answerId);
    addAnswerEvent(answerId, 'email_drafted', `${result.provider}/${result.model}`, db, at);
  })();

  return getAnswer(answerId)!;
}

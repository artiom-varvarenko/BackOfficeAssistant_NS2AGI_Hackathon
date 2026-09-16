// Calls the real, configured running application and creates ten stored answers.
// Usage: node --import tsx scripts/acceptance.ts --base-url http://127.0.0.1:3000
// Optional authentication: ACCEPTANCE_COOKIE or ACCEPTANCE_PASSWORD (never both).
// Reports are local, gitignored evidence; semantic/legal review remains manual.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Answer, Settings, Source } from '../src/lib/types';

interface Question { id: string; question: string; expected: string; sourceIds?: string[] }
interface Check { name: string; passed: boolean; detail?: string }
interface CaseResult extends Question {
  state: 'pending' | 'recorded' | 'failed' | 'skipped';
  semanticReview: 'pending';
  startedAt?: string;
  durationMs?: number;
  answerUrl?: string;
  answer?: Answer;
  checks?: Check[];
  error?: string;
}
interface Report {
  startedAt: string;
  finishedAt?: string;
  baseUrl: string;
  sourcePlan: string;
  model?: Settings['tasks']['answer'];
  retrievalMode?: Settings['retrieval']['mode'];
  sources?: Source[];
  cases: CaseResult[];
  notes: string[];
  fatalError?: string;
}

const fixtureModel = /fixture|protocol[-_ ]check|synthetic|(?:^|[-_ ])mock(?:$|[-_ ])/i;
const capturedSecrets = new Set<string>();
function options(): { help: boolean; baseUrl?: string } {
  const args = process.argv.slice(2);
  const result: { help: boolean; baseUrl?: string } = { help: false };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--help' || args[index] === '-h') result.help = true;
    else if (args[index] === '--base-url') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('--base-url requires an HTTP(S) origin.');
      result.baseUrl = value;
    } else if (args[index].startsWith('--base-url=')) result.baseUrl = args[index].slice('--base-url='.length);
    else throw new Error('Unknown option. Use --help for acceptance-runner usage.');
  }
  return result;
}
function redact(value: string): string {
  for (const secret of capturedSecrets) if (secret) value = value.split(secret).join('[REDACTED]');
  return value;
}
function say(value: string) { console.log(redact(value)); }
function safeError(error: unknown): string {
  return redact(error instanceof Error ? error.message : 'Unexpected acceptance-runner error.');
}
function planQuestions(text: string): Question[] {
  const questions = text.split(/\r?\n/).flatMap((line) => {
    const match = /^\|\s*(Q[1-9])\s*\|([^|]+)\|(.+)\|\s*$/.exec(line);
    return match ? [{ id: match[1], question: match[2].trim(), expected: match[3].trim() }] : [];
  });
  if (questions.length !== 9 || questions.some((question, index) => question.id !== `Q${index + 1}`)) {
    throw new Error('PLAN.md must contain exactly Q1–Q9 in their original acceptance table.');
  }
  return questions;
}
function fence(value: string): string {
  const longest = Math.max(2, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const boundary = '`'.repeat(longest + 1);
  return `${boundary}text\n${value}\n${boundary}`;
}
function markdown(report: Report): string {
  const lines = [
    '# Real-provider acceptance evidence', '',
    `Started: ${report.startedAt}`, `Application: ${report.baseUrl}`,
    `Configured model: ${report.model ? `${report.model.provider}/${report.model.model} (${report.model.effort ?? 'no effort setting'})` : 'Preflight incomplete'}`,
    `Retrieval: ${report.retrievalMode ?? 'Unknown'}`, '',
    '**Semantic and legal acceptance: pending human review for every case.**',
    'Technical checks establish citation/persistence structure only. They do not establish that claims follow from the passages, that the answer is complete, or that a rule applies today.', '',
    ...report.notes.map((note) => `- ${note}`), '',
  ];
  if (report.fatalError) lines.push('Run stopped:', fence(report.fatalError), '');
  for (const result of report.cases) {
    lines.push(`## ${result.id} — ${result.state}`, '', result.question, '', 'Expected findings from PLAN.md (manual review):', result.expected, '');
    if (result.sourceIds) lines.push(`Selected source IDs: ${result.sourceIds.join(', ')}`, '');
    if (result.error) lines.push(fence(result.error), '');
    if (!result.answer) continue;
    const answer = result.answer;
    lines.push(`Stored answer: ${result.answerUrl}`, `Duration: ${((result.durationMs ?? 0) / 1000).toFixed(1)} s`,
      `Model: ${answer.provider}/${answer.model}; canAnswer: ${answer.canAnswer}; status: ${answer.status}; uncited sentences reported: ${answer.uncitedSentences}`, '',
      'Technical integrity checks:', '', ...(result.checks ?? []).map((check) => `- ${check.passed ? 'PASS' : 'FAIL'}: ${check.name}${check.detail ? ` — ${check.detail}` : ''}`), '',
      'Generated answer:', fence(answer.generatedAnswer), '',
      'Gaps:', fence(answer.gaps.join('\n') || '(none reported)'),
      'Warnings:', fence(answer.warnings.join('\n') || '(none reported)'),
      'Conflicts:', fence(answer.conflicts.join('\n') || '(none reported)'), '', 'Citation evidence:', '');
    for (const citation of answer.citations) {
      lines.push(`### [${citation.marker}] ${citation.sourceTitle}`, '',
        `${citation.authority ?? 'Unknown authority'} · ${citation.level} · ${citation.article ?? 'No article'} ${citation.section ?? ''} · p. ${citation.pageStart}–${citation.pageEnd}`,
        `Version: ${citation.versionLabel ?? citation.documentDate ?? 'Date unknown'} (${citation.versionId})`,
        `Applicability: ${citation.applicability}; enabled: ${citation.sourceEnabled}; current version: ${citation.isCurrentVersion}; officer-checked: ${citation.checked}`,
        `PDF: ${new URL(citation.pdfUrl, report.baseUrl).href}`,
        `Original URL: ${citation.originalUrl ?? '(none)'}`, '',
        'Exact stored passage:', fence(citation.quoteText),
        'Validated highlight:', fence(citation.highlight ?? '(none; inspect the whole passage)'), '');
    }
    lines.push('Manual reviewer decision: PENDING', 'Reviewer and date: __________', 'Findings / corrections: __________', '');
  }
  return lines.join('\n');
}
function checks(answer: Answer, submitted: Answer, question: Question, model: Settings['tasks']['answer']): Check[] {
  const markers = Array.from(answer.generatedAnswer.matchAll(/\[(\d+)\]/g), (match) => Number(match[1]));
  const citationNumbers = new Set(answer.citations.map((citation) => citation.marker));
  const selected = question.sourceIds;
  return [
    { name: 'Stored question equals the exact PLAN question', passed: answer.question === question.question },
    { name: 'Generated text is nonempty', passed: answer.generatedAnswer.trim().length > 0 },
    { name: 'All inline citation markers resolve', passed: markers.every((marker) => Number.isSafeInteger(marker) && marker > 0 && citationNumbers.has(marker)) },
    { name: 'Citation numbers are unique positive integers', passed: citationNumbers.size === answer.citations.length && answer.citations.every((citation) => Number.isSafeInteger(citation.marker) && citation.marker > 0) },
    { name: 'Citation passages and page ranges are present', passed: answer.citations.every((citation) => citation.quoteText.trim().length > 0 && Number.isInteger(citation.pageStart) && Number.isInteger(citation.pageEnd) && citation.pageStart >= 1 && citation.pageEnd >= citation.pageStart) },
    { name: 'Highlights are exact stored substrings', passed: answer.citations.every((citation) => citation.highlight === null || citation.quoteText.includes(citation.highlight)) },
    { name: 'PDF links target the cited version and first page', passed: answer.citations.every((citation) => citation.pdfUrl === `/api/files/${citation.versionId}#page=${citation.pageStart}`) },
    { name: 'Citations are enabled and current when read back', passed: answer.citations.every((citation) => citation.sourceEnabled && citation.isCurrentVersion) },
    { name: 'Requested source selection is preserved', passed: selected ? JSON.stringify([...selected].sort()) === JSON.stringify([...(answer.scopeSourceIds ?? [])].sort()) : answer.scopeSourceIds === null },
    { name: 'Scoped citations stay within selected sources', passed: !selected || answer.citations.every((citation) => selected.includes(citation.sourceId)) },
    { name: 'Recorded model matches configuration before the request', passed: answer.provider === model.provider && answer.model === model.model && answer.effort === model.effort },
    { name: 'Original answer and citations survive a separate GET', passed: answer.id === submitted.id && answer.generatedAnswer === submitted.generatedAnswer && JSON.stringify(answer.citations) === JSON.stringify(submitted.citations) },
  ];
}

async function main() {
  const cli = options();
  if (cli.help) {
    say(`Usage (from web):
  node --import tsx scripts/acceptance.ts --base-url http://127.0.0.1:3000
  npm run acceptance -- --base-url http://127.0.0.1:3000

Options:
  --base-url URL   Explicit running application origin; overrides ACCEPTANCE_BASE_URL.
  --help, -h       Show this help without making requests.

Authentication (optional; set privately in the process environment):
  ACCEPTANCE_PASSWORD  Workspace password; logs in once through /api/login.
  ACCEPTANCE_COOKIE    Existing ea_session value, or ea_session=value.
  Supply at most one. No authentication is needed for an unprotected local app.
  Passwords and cookies are never printed or included in evidence reports.

Other environment settings:
  ACCEPTANCE_BASE_URL         Alternative to --base-url; no default target.
  ACCEPTANCE_MARKET_SOURCE_ID Exact market-regulation source ID if automatic selection is ambiguous.

This runs Q1–Q9 from PLAN.md plus scoped Q3, creating ten retained answers and
incurring configured provider costs. It changes no settings and resets no data.
Use a funded real model. Fixture/synthetic model IDs are refused.
JSON and Markdown reports: web/storage/acceptance/<timestamp>/ (gitignored).
Technical integrity is checked; semantic/legal review always remains pending.`);
    return;
  }
  const configuredBase = cli.baseUrl ?? process.env.ACCEPTANCE_BASE_URL;
  if (!configuredBase) throw new Error('Set ACCEPTANCE_BASE_URL explicitly, for example http://127.0.0.1:3000.');
  const base = new URL(configuredBase);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('ACCEPTANCE_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment.');
  }
  let cookie = process.env.ACCEPTANCE_COOKIE?.trim() ?? '';
  const password = process.env.ACCEPTANCE_PASSWORD;
  if (cookie && password) throw new Error('Use ACCEPTANCE_COOKIE or ACCEPTANCE_PASSWORD, not both.');
  if (cookie) {
    if (!cookie.startsWith('ea_session=')) cookie = `ea_session=${cookie}`;
    if (!/^ea_session=[A-Za-z0-9_.-]+$/.test(cookie)) throw new Error('ACCEPTANCE_COOKIE must contain only the ea_session cookie value or ea_session=value.');
    capturedSecrets.add(cookie); capturedSecrets.add(cookie.slice('ea_session='.length));
  }
  if (password) capturedSecrets.add(password);
  if ((cookie || password) && base.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
    throw new Error('Use HTTPS for authenticated remote acceptance runs. HTTP is supported on loopback only.');
  }
  const planPath = [path.resolve('PLAN.md'), path.resolve('../PLAN.md')].find((candidate) => fs.existsSync(candidate));
  if (!planPath) throw new Error('Run this script from the repository root or web directory so PLAN.md can be read.');
  const questions = planQuestions(fs.readFileSync(planPath, 'utf8'));
  const q3 = questions.find((question) => question.id === 'Q3')!;
  const startedAt = new Date().toISOString();
  const output = path.join(path.dirname(planPath), 'web', 'storage', 'acceptance', `${startedAt.replace(/[:.]/g, '-')}-${process.pid}`);
  fs.mkdirSync(output, { recursive: true });
  const report: Report = {
    startedAt, baseUrl: base.origin, sourcePlan: 'PLAN.md §13',
    cases: [...questions, { ...q3, id: 'Q3-scoped', expected: 'PLAN §13 item 16: marktreglement only; say the fee is absent from the selected sources. Show scope of one source and retain it in technical details.' }].map((question) => ({ ...question, state: 'pending', semanticReview: 'pending' })),
    notes: [
      'This run creates and retains answers in the configured application. Settings and existing sources/history are not modified or reset.',
      'Questions and baseline expectations are copied from PLAN.md at run time; citation metadata and full stored passages are preserved below and in report.json.',
      'No provider/model switch, approval, email, TTS, UI, public-mobile or video/submission acceptance is implied by this runner.',
      'No generation request is retried after a transport error or non-429 error: it may already have been stored. Check application history before rerunning.',
    ],
  };
  const persist = () => {
    fs.writeFileSync(path.join(output, 'report.json'), redact(JSON.stringify(report, null, 2)), 'utf8');
    fs.writeFileSync(path.join(output, 'report.md'), redact(markdown(report)), 'utf8');
  };
  let lastPost = 0;
  async function request<T>(endpoint: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (body !== undefined) {
        const wait = Math.max(0, lastPost + 6500 - Date.now());
        if (wait) await delay(wait);
        lastPost = Date.now();
      }
      let response: Response;
      try {
        response = await fetch(new URL(endpoint, base), {
          method: body === undefined ? 'GET' : 'POST', redirect: 'error',
          headers: { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base.origin }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180000),
        });
      } catch { throw new Error(`Transport failure at ${endpoint}; no automatic retry. The operation may already be stored.`); }
      if (response.status === 429 && attempt < 3) {
        const header = response.headers.get('retry-after');
        const seconds = header ? Number(header) : NaN;
        const date = header ? Date.parse(header) : NaN;
        const wait = Number.isFinite(seconds) ? Math.max(1000, seconds * 1000) : Number.isFinite(date) ? Math.max(1000, date - Date.now()) : 60000;
        await response.body?.cancel();
        if (wait > 180000) throw new Error(`HTTP 429 at ${endpoint}; Retry-After exceeds three minutes. Resume later.`);
        say(`Rate limit: waiting ${Math.ceil(wait / 1000)} s before retrying the rejected request.`);
        for (let remaining = wait; remaining > 0; remaining -= 60000) await delay(Math.min(60000, remaining));
        continue;
      }
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        throw new Error(`HTTP ${response.status} ${error?.error?.code ?? 'request_failed'} at ${endpoint}: ${error?.error?.message ?? 'No structured error message.'}`);
      }
      if (endpoint === '/api/login') {
        const session = response.headers.getSetCookie().map((value) => /^ea_session=([^;]+)/.exec(value)?.[1]).find(Boolean);
        if (session) { cookie = `ea_session=${session}`; capturedSecrets.add(cookie); capturedSecrets.add(session); }
        return undefined as T;
      }
      return await response.json() as T;
    }
    throw new Error(`Rate limit retries exhausted at ${endpoint}.`);
  }
  try {
    persist();
    if (password) await request('/api/login', { password });
    const settings = await request<Settings>('/api/settings');
    report.model = settings.tasks.answer;
    report.retrievalMode = settings.retrieval.mode;
    if (fixtureModel.test(report.model.model)) throw new Error('Refusing a fixture/synthetic model for real-provider acceptance. Configure a real model first.');
    report.sources = await request<Source[]>('/api/sources');
    const requestedMarketId = process.env.ACCEPTANCE_MARKET_SOURCE_ID;
    const markets = report.sources.filter((source) => source.enabled && source.currentVersion?.processingStatus === 'ready' && (requestedMarketId ? source.id === requestedMarketId : source.currentVersion.fileName === 'Schoten-marktreglement-2024.pdf'));
    const scoped = report.cases[9];
    if (markets.length === 1) scoped.sourceIds = [markets[0].id];
    else { scoped.state = 'skipped'; scoped.error = 'No unique enabled, ready market regulation found. Set ACCEPTANCE_MARKET_SOURCE_ID to the intended source ID and rerun.'; }
    persist();
    for (const result of report.cases) {
      if (result.state === 'skipped') continue;
      result.startedAt = new Date().toISOString();
      const started = Date.now();
      say(`${result.id}: requesting configured ${report.model.provider}/${report.model.model}…`);
      try {
        const current = (await request<Settings>('/api/settings')).tasks.answer;
        if (fixtureModel.test(current.model)) throw new Error('Refusing a fixture/synthetic model introduced during the run.');
        const submitted = await request<Answer>('/api/answers', { question: result.question, ...(result.sourceIds ? { sourceIds: result.sourceIds } : {}) });
        result.answer = submitted;
        result.answerUrl = new URL(`/geschiedenis/${encodeURIComponent(submitted.id)}`, base).href;
        if (fixtureModel.test(submitted.model)) throw new Error('Returned answer reports a fixture/synthetic model; this is not real-provider evidence.');
        const stored = await request<Answer>(`/api/answers/${encodeURIComponent(submitted.id)}`);
        result.answer = stored;
        result.checks = checks(stored, submitted, result, current);
        result.state = 'recorded';
        say(`${result.id}: stored; technical checks ${result.checks.filter((check) => check.passed).length}/${result.checks.length}; semantic review pending.`);
      } catch (error) {
        result.state = 'failed'; result.error = safeError(error); say(`${result.id}: ${result.error}`);
        if (/Transport failure|fixture\/synthetic|HTTP 401|no_model_configured/.test(result.error)) throw error;
      } finally { result.durationMs = Date.now() - started; persist(); }
    }
  } catch (error) {
    report.fatalError = safeError(error);
    for (const result of report.cases) if (result.state === 'pending') { result.state = 'skipped'; result.error = 'Run stopped before this case.'; }
  } finally {
    report.finishedAt = new Date().toISOString(); persist();
    say(`Reports: ${path.join(output, 'report.json')} and ${path.join(output, 'report.md')}`);
    say('Semantic/legal review remains pending. Inspect each answer against PLAN.md and its stored passages.');
  }
  if (report.fatalError || report.cases.some((result) => result.state !== 'recorded' || result.checks?.some((check) => !check.passed))) process.exitCode = 1;
}

main().catch((error) => { console.error(safeError(error)); process.exitCode = 1; });

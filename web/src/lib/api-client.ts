import type { Answer, AnswerListItem, ApiError, Citation, EventLogItem, LlmTask, Passage, ProviderId, SearchHit, Settings, Source, SourceVersion, TaskModel } from './types';
import { exampleQuestions, fixtureAnswer, fixtureHistory, fixtureSettings, fixtureSources } from './fixtures';

export const useFixtures = process.env.NEXT_PUBLIC_USE_FIXTURES === '1';
export class ApiClientError extends Error {
  constructor(public code: string, message: string, public status = 0) { super(message); this.name = 'ApiClientError'; }
}
async function response(path: string, init?: RequestInit) {
  if (useFixtures && init?.method && !['GET', 'HEAD'].includes(init.method.toUpperCase()) && path !== '/api/login') {
    throw new ApiClientError('fixture_read_only', 'Deze actie vereist de echte service. In de voorbeeldmodus worden geen wijzigingen naar de server gestuurd.');
  }
  let result: Response;
  try { result = await fetch(path, { ...init, cache: 'no-store' }); }
  catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ApiClientError('network_error', 'De server is niet bereikbaar. Controleer de verbinding en probeer opnieuw.');
  }
  if (result.redirected && new URL(result.url, window.location.origin).pathname === '/login') {
    throw new ApiClientError('unauthorized', 'Uw sessie is verlopen. Meld u opnieuw aan.', 401);
  }
  if (!result.ok) {
    const body = await result.json().catch(() => null) as ApiError | null;
    throw new ApiClientError(body?.error?.code ?? 'request_failed', body?.error?.message ?? `De aanvraag is mislukt (HTTP ${result.status}).`, result.status);
  }
  return result;
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const result = await response(path, init);
  try { return await result.json(); }
  catch { throw new ApiClientError('invalid_response', 'De server gaf geen geldig antwoord. Probeer opnieuw.'); }
}
const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const segment = encodeURIComponent;
const answerPath = (id: string) => `/api/answers/${segment(id)}`;
const sourcePath = (id: string) => `/api/sources/${segment(id)}`;
export const fileUrl = (versionId: string, page?: number) => `/api/files/${segment(versionId)}${page ? `#page=${page}` : ''}`;
const clone = <T,>(value: T): T => structuredClone(value);
const fixtureKey = 'economie-assistent:sprint1:answers';
function storedAnswers(): Answer[] {
  const second: Answer = { ...clone(fixtureAnswer), id: 'fixture-answer-2', question: exampleQuestions[2], status: 'rejected', canAnswer: 'nee', generatedAnswer: 'De ingeschakelde bronnen bevatten geen informatie over een startpremie voor nieuwe zelfstandigen in Schoten.', citations: [], gaps: ['Een gemeentelijke regeling voor een startpremie ontbreekt.'], warnings: [], sourcesUsed: 0, createdAt: fixtureHistory[1].createdAt };
  try { const raw = window.localStorage.getItem(fixtureKey); if (raw) return JSON.parse(raw) as Answer[]; } catch { /* Storage can be unavailable in private browsing. */ }
  return [clone(fixtureAnswer), second];
}
function saveFixture(answer: Answer) {
  const all = storedAnswers(); const index = all.findIndex((item) => item.id === answer.id);
  if (index < 0) all.unshift(answer); else all[index] = answer;
  try { window.localStorage.setItem(fixtureKey, JSON.stringify(all)); }
  catch { throw new ApiClientError('fixture_storage_unavailable', 'Voorbeeldwijzigingen kunnen niet lokaal worden bewaard. Sta browseropslag toe.'); }
  return clone(answer);
}
function getFixture(id: string) {
  const answer = storedAnswers().find((item) => item.id === id);
  if (!answer) throw new ApiClientError('not_found', 'Dit voorbeeldantwoord bestaat niet.', 404);
  return clone(answer);
}

export const getSources = (): Promise<Source[]> => useFixtures ? Promise.resolve(clone(fixtureSources)) : request('/api/sources');
export const getSource = (id: string): Promise<Source> => request(sourcePath(id));
export const getSourcePassages = (id: string): Promise<Passage[]> => request(`${sourcePath(id)}/passages`);
export const uploadSource = (form: FormData): Promise<Source> => request('/api/sources', { method: 'POST', body: form });
export type SourceMetadata = Pick<Source, 'title' | 'authority' | 'level' | 'docType' | 'scope' | 'originalUrl'> & Partial<Pick<SourceVersion, 'documentDate' | 'versionLabel' | 'validFrom' | 'validUntil'>> & { applicability?: 'unverified' | 'historical' };
export const addSourceFromUrl = (body: SourceMetadata & { url: string }): Promise<Source> => request('/api/sources/from-url', json('POST', body));
export const updateSource = (id: string, body: Partial<Pick<Source, 'title' | 'authority' | 'level' | 'docType' | 'scope' | 'originalUrl' | 'enabled'>>): Promise<Source> => request(sourcePath(id), json('PATCH', body));
export const uploadVersion = (id: string, form: FormData): Promise<Source> => request(`${sourcePath(id)}/versions`, { method: 'POST', body: form });
export const updateVersion = (id: string, vid: string, body: Partial<Pick<SourceVersion, 'applicability' | 'applicabilityNote' | 'documentDate' | 'versionLabel' | 'validFrom' | 'validUntil'>>): Promise<Source> => request(`${sourcePath(id)}/versions/${segment(vid)}`, json('PATCH', body));
export type PassageContext = { previous: Passage | null; current: Passage; next: Passage | null };
export const getPassageContext = (id: string): Promise<PassageContext> => request(`/api/passages/${segment(id)}/context`);
export const searchSources = (q: string): Promise<SearchHit[]> => request(`/api/search?${new URLSearchParams({ q })}`);

export async function askQuestion(question: string, sourceIds?: string[], signal?: AbortSignal): Promise<Answer> {
  if (!useFixtures) return request('/api/answers', { ...json('POST', { question, ...(sourceIds ? { sourceIds } : {}) }), signal });
  if (sourceIds) throw new ApiClientError('fixture_scope', 'Bronselectie vereist de echte antwoordservice. De voorbeeldmodus gebruikt vaste antwoorden.');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (!exampleQuestions.includes(question.trim())) throw new ApiClientError('fixture_question', 'De voorbeeldmodus ondersteunt de drie voorbeeldvragen. Schakel de voorbeeldmodus uit om uw eigen vraag te stellen.');
  const answer = question === exampleQuestions[2] ? getFixture('fixture-answer-2') : clone(fixtureAnswer);
  answer.id = `fixture-${crypto.randomUUID()}`; answer.question = question; answer.status = 'draft'; answer.reviewedAnswer = null; answer.reviewNote = null; answer.reviewedAt = null;
  if (question === exampleQuestions[1]) {
    answer.generatedAnswer = 'Voor een losse standplaats meldt u zich voor de loting om 08.00 uur op de hoek van de Paalstraat en de Rodeborgstraat. U of uw vertegenwoordiger moet aanwezig zijn. [1]\n\nDe vergoeding bedraagt 9,00 euro per marktdag per kavel, inclusief elektriciteit. [2]';
    answer.citations = [ { ...answer.citations[0], article: 'Artikel 12', section: null, pageStart: 5, pageEnd: 5, highlight: null, quoteText: 'Voorbeeldpassage: loting om 08.00 uur, hoek Paalstraat/Rodeborgstraat; aanwezigheid van de handelaar of vertegenwoordiger vereist.', checked: false, checkedAt: null }, { ...answer.citations[1], sourceId: fixtureSources[1].id, sourceTitle: fixtureSources[1].title, versionId: fixtureSources[1].currentVersion!.id, originalUrl: fixtureSources[1].originalUrl, documentDate: fixtureSources[1].currentVersion!.documentDate, versionLabel: fixtureSources[1].currentVersion!.versionLabel, article: 'Artikel 4.1', section: null, pageStart: 1, pageEnd: 1, pdfUrl: `${fixtureSources[1].currentVersion!.pdfUrl}#page=1`, quoteText: 'Voorbeeldpassage: losse markthandelaar — 9,00 euro per marktdag per kavel; elektriciteit inbegrepen.' } ];
    answer.gaps = []; answer.canAnswer = 'ja'; answer.sourcesUsed = 2;
  }
  answer.createdAt = answer.updatedAt = new Date().toISOString();
  answer.events = [{ type: 'generated', at: answer.createdAt, detail: 'Voorbeeldantwoord — geen modelaanroep' }];
  return saveFixture(answer);
}
export async function getAnswers(): Promise<AnswerListItem[]> {
  if (!useFixtures) return request('/api/answers');
  return storedAnswers().map((a) => ({ id: a.id, question: a.question, status: a.status, canAnswer: a.canAnswer, citationCount: a.citations.length, checkedCount: a.citations.filter((c) => c.checked).length, createdAt: a.createdAt }));
}
export const getAnswer = async (id: string): Promise<Answer> => useFixtures ? getFixture(id) : request(answerPath(id));
export type ReviewPatch = Partial<Pick<Answer, 'reviewedAnswer' | 'status' | 'reviewNote'>>;
export async function updateAnswer(id: string, body: ReviewPatch): Promise<Answer> {
  if (!useFixtures) return request(answerPath(id), json('PATCH', body));
  const answer = getFixture(id); const at = new Date().toISOString();
  const edited = body.reviewedAnswer !== undefined && body.reviewedAnswer !== (answer.reviewedAnswer ?? answer.generatedAnswer);
  const previousStatus = answer.status;
  Object.assign(answer, body, { updatedAt: at });
  if (answer.reviewedAnswer === answer.generatedAnswer) answer.reviewedAnswer = null;
  if (edited) { answer.status = 'draft'; answer.reviewedAt = null; answer.events.push({ type: 'edited', at, detail: null }); }
  if (body.status && !(edited && previousStatus === 'approved')) {
    answer.status = body.status; answer.reviewedAt = body.status === 'draft' ? null : at;
    answer.events.push({ type: body.status === 'draft' ? 'reopened' : body.status, at, detail: body.reviewNote ?? null });
  }
  return saveFixture(answer);
}
export async function updateCitation(id: string, marker: number, body: Pick<Citation, 'checked'> & Partial<Pick<Citation, 'checkNote'>>): Promise<Answer> {
  if (!useFixtures) return request(`${answerPath(id)}/citations/${marker}`, json('PATCH', body));
  const answer = getFixture(id); const citation = answer.citations.find((c) => c.marker === marker);
  if (!citation) throw new ApiClientError('not_found', 'Bronverwijzing niet gevonden.', 404);
  Object.assign(citation, body, { checkedAt: body.checked ? new Date().toISOString() : null });
  answer.updatedAt = new Date().toISOString(); answer.events.push({ type: 'citation_checked', at: answer.updatedAt, detail: `[${marker}] ${body.checked ? 'Gecontroleerd' : 'Controle opgeheven'}` });
  return saveFixture(answer);
}
export const regenerateAnswer = (id: string): Promise<Answer> => request(`${answerPath(id)}/regenerate`, json('POST'));
export const createEmailDraft = (id: string): Promise<Answer> => request(`${answerPath(id)}/email-draft`, json('POST'));
export const getSimilarAnswers = (q: string, exclude: string): Promise<AnswerListItem[]> => request(`/api/answers/similar?${new URLSearchParams({ q, exclude })}`);
export const getSettings = (): Promise<Settings> => useFixtures ? Promise.resolve(clone(fixtureSettings)) : request('/api/settings');
export interface SettingsPatch {
  tasks?: Partial<Record<LlmTask, TaskModel>>; keys?: Partial<Record<ProviderId, string | null>>;
  custom?: { baseUrl: string | null }; azure?: { resourceName: string | null };
  tts?: Partial<Pick<Settings['tts'], 'provider' | 'voiceId'>> & { key?: string | null };
  retrieval?: Pick<Settings['retrieval'], 'mode'>;
}
export const updateSettings = (body: SettingsPatch): Promise<Settings> => request('/api/settings', json('PUT', body));
export const testSettings = (task: LlmTask): Promise<{ ok: boolean; latencyMs: number; provider: ProviderId; model: string; error?: string }> => request('/api/settings/test', json('POST', { task }));
export const readAnswerAloud = async (answerId: string): Promise<Blob> => (await response('/api/tts', json('POST', { answerId }))).blob();
export const generateSourceSummary = (id: string): Promise<Source> => request(`${sourcePath(id)}/summary`, json('POST'));
export const embedSource = (id: string): Promise<{ embedded: number }> => request(`${sourcePath(id)}/embed`, json('POST'));
export const getEvents = (limit = 100): Promise<EventLogItem[]> => request(`/api/events?${new URLSearchParams({ limit: String(limit) })}`);
export const login = async (password: string): Promise<void> => { await response('/api/login', json('POST', { password })); };

// Parses SSE frames across arbitrary network boundaries, including CRLF and UTF-8 splits.
export async function streamAnswer(question: string, handlers: { partial: (text: string) => void; final: (answer: Answer) => void }, sourceIds?: string[], signal?: AbortSignal): Promise<void> {
  const result = await response('/api/answers/stream', { ...json('POST', { question, ...(sourceIds ? { sourceIds } : {}) }), signal });
  if (!result.headers.get('content-type')?.includes('text/event-stream')) {
    throw new ApiClientError('invalid_stream', 'De server gaf geen geldige antwoordstroom terug.');
  }
  const reader = result.body?.getReader();
  if (!reader) throw new ApiClientError('empty_stream', 'De server heeft geen antwoordstroom teruggestuurd.');
  const decoder = new TextDecoder(); let buffer = ''; let finished = false;
  const frame = (value: string) => {
    const lines = value.split(/\r?\n/); const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    let parsed;
    try { parsed = JSON.parse(data); }
    catch { throw new ApiClientError('invalid_stream', 'Een deel van de antwoordstroom kon niet worden gelezen.'); }
    if (!parsed || typeof parsed !== 'object') throw new ApiClientError('invalid_stream', 'De antwoordstroom bevat ongeldige gegevens.');
    if (event === 'partial' && typeof parsed.antwoord === 'string') handlers.partial(parsed.antwoord);
    if (event === 'final') {
      if (typeof parsed.id !== 'string' || typeof parsed.generatedAnswer !== 'string' || !Array.isArray(parsed.citations)) throw new ApiClientError('invalid_stream', 'Het definitieve antwoord is onvolledig.');
      finished = true; handlers.final(parsed as Answer);
    }
    if (event === 'error') throw new ApiClientError(parsed.error?.code ?? parsed.code ?? 'stream_failed', parsed.error?.message ?? parsed.message ?? 'Het opstellen is mislukt.');
  };
  try {
    while (true) {
      const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) { frame(buffer.slice(0, boundary.index)); buffer = buffer.slice(boundary.index + boundary[0].length); if (finished) return; }
      if (done) { if (buffer.trim()) frame(buffer); break; }
    }
    if (!finished) throw new ApiClientError('incomplete_stream', 'De verbinding is verbroken voordat het antwoord was gevalideerd.');
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

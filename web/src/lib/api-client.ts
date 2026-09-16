import type { Answer, AnswerListItem, ApiError, Citation, EventLogItem, LlmTask, Passage, ProviderId, SearchHit, Settings, Source, SourceVersion, TaskModel } from './types';
import { getClientLocale, translate } from './i18n';

export class ApiClientError extends Error {
  constructor(public code: string, message: string, public status = 0) { super(translate(message, getClientLocale())); this.name = 'ApiClientError'; }
}
async function response(path: string, init?: RequestInit) {
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

export function safeSourceUrl(value: string | null | undefined, allowPdfPath = false): string | null {
  if (!value) return null;
  const href = value.trim();
  if (/[\u0000-\u0020\u007f\\]/.test(href)) return null;
  if (allowPdfPath) {
    const local = /^\/api\/files\/([^/?#]+)(?:#page=[1-9]\d*)?$/.exec(href);
    if (local) {
      try {
        if (/^[A-Za-z0-9_-]+$/.test(decodeURIComponent(local[1]))) return href;
      } catch { return null; }
    }
  }
  try {
    const url = new URL(href);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export const getSources = (): Promise<Source[]> => request('/api/sources');
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
  return request('/api/answers', { ...json('POST', { question, ...(sourceIds === undefined ? {} : { sourceIds }) }), signal });
}
export const getAnswers = (): Promise<AnswerListItem[]> => request('/api/answers');
export const getAnswer = (id: string): Promise<Answer> => request(answerPath(id));
export type ReviewPatch = Partial<Pick<Answer, 'reviewedAnswer' | 'status' | 'reviewNote'>>;
export const updateAnswer = (id: string, body: ReviewPatch): Promise<Answer> => request(answerPath(id), json('PATCH', body));
export const updateCitation = (id: string, marker: number, body: Pick<Citation, 'checked'> & Partial<Pick<Citation, 'checkNote'>>): Promise<Answer> => request(`${answerPath(id)}/citations/${marker}`, json('PATCH', body));
export const regenerateAnswer = (id: string): Promise<Answer> => request(`${answerPath(id)}/regenerate`, json('POST'));
export const createEmailDraft = (id: string): Promise<Answer> => request(`${answerPath(id)}/email-draft`, json('POST'));
export const getSimilarAnswers = (q: string, exclude: string): Promise<AnswerListItem[]> => request(`/api/answers/similar?${new URLSearchParams({ q, exclude })}`);
export const getSettings = (): Promise<Settings> => request('/api/settings');
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
  const result = await response('/api/answers/stream', { ...json('POST', { question, ...(sourceIds === undefined ? {} : { sourceIds }) }), signal });
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

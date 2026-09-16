// Officer-editable configuration (PLAN.md section 4 and 7): which model runs
// which task, API keys, the custom/Azure endpoints, TTS and retrieval mode.
// Rows live in the `settings` table (key, value, updated_at); a DB row always
// overrides the environment variable, env is only the bootstrap. Saved keys are
// plaintext in the local SQLite file; only masked values enter the public DTO.
import type Database from 'better-sqlite3';
import { ApiError } from './api';
import { getDb, nowIso } from './db';
import { PROVIDERS, type ProviderDef } from './llm';
import type { Effort, LlmTask, ProviderId, ProviderInfo, Settings, TaskModel } from './types';

export const MUNICIPALITY_NAME: string = process.env.MUNICIPALITY_NAME ?? 'Schoten';

const parsedBudget = Number.parseInt(process.env.RETRIEVAL_CHAR_BUDGET ?? '', 10);
export const RETRIEVAL_CHAR_BUDGET: number =
  Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : 60000;

export const DEFAULT_TASKS: Record<LlmTask, TaskModel> = {
  answer: { provider: 'openai', model: 'gpt-5.6-terra', effort: 'xhigh' },
  draft: { provider: 'openai', model: 'gpt-5.6-terra', effort: 'none' },
  summary: { provider: 'openai', model: 'gpt-5.6-luna', effort: 'none' },
};

const TASKS: readonly LlmTask[] = ['answer', 'draft', 'summary'];
const EFFORTS: readonly Effort[] = ['none', 'low', 'medium', 'high', 'xhigh'];
const TTS_PROVIDERS = ['none', 'elevenlabs', 'openai'] as const;
const RETRIEVAL_MODES = ['bm25', 'hybrid'] as const;
type TtsProvider = (typeof TTS_PROVIDERS)[number];
type RetrievalMode = (typeof RETRIEVAL_MODES)[number];
type TtsConfig = { provider: TtsProvider; voiceId: string | null; key: string | null };

// ---------------------------------------------------------------------------
// Row access

interface Statements {
  db: Database.Database;
  get: Database.Statement<[string], { value: string }>;
  put: Database.Statement<[string, string, string]>;
  del: Database.Statement<[string]>;
  readTts: Database.Transaction<() => TtsConfig>;
}

let statements: Statements | null = null;

function stmts(): Statements {
  const db = getDb();
  if (statements?.db === db) return statements;
  statements = {
    db,
    get: db.prepare('SELECT value FROM settings WHERE key = ?'),
    put: db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ),
    del: db.prepare('DELETE FROM settings WHERE key = ?'),
    readTts: db.transaction(readTtsConfig),
  };
  return statements;
}

export function getSetting(key: string): string | null {
  return stmts().get.get(key)?.value ?? null;
}

// `null` deletes the row.
export function setSetting(key: string, value: string | null): void {
  if (value === null) stmts().del.run(key);
  else stmts().put.run(key, value, nowIso());
}

function envValue(name: string): string | null {
  const value = process.env[name];
  return value ? value : null;
}

function providerDef(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Task models

type Check<T> = { ok: true; value: T } | { ok: false; message: string };

// Shape check shared by the PUT validation (which rejects) and the reader
// (which falls back to the default rather than break every page on a bad row).
function checkTaskModel(input: unknown): Check<TaskModel> {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, message: 'Een taakmodel moet een object zijn met provider, model en effort.' };
  }
  const { provider, model, effort } = input as Record<string, unknown>;
  const def = typeof provider === 'string' ? providerDef(provider) : undefined;
  if (def === undefined) {
    return { ok: false, message: 'Onbekende provider.' };
  }
  if (typeof model !== 'string' || model.trim() === '') {
    return { ok: false, message: 'De modelnaam mag niet leeg zijn.' };
  }
  if (effort !== null && effort !== undefined && !EFFORTS.includes(effort as Effort)) {
    return {
      ok: false,
      message: 'Ongeldig redeneerniveau (toegestaan: none, low, medium, high, xhigh).',
    };
  }
  const astra = model.trim().toLowerCase() === 'gpt-6-astra';
  if (astra && !def.supportsEffort) {
    return { ok: false, message: 'Kies voor gpt-6-astra een aanbieder met instelbaar redeneerniveau, zoals OpenAI of Azure OpenAI.' };
  }
  if (astra && effort !== 'low' && effort !== 'medium') {
    return { ok: false, message: 'Voor gpt-6-astra is alleen redeneerniveau low of medium toegestaan.' };
  }
  return {
    ok: true,
    value: {
      provider: def.id,
      model: model.trim(),
      // Providers without a reasoning control get null so the stored value
      // never claims an effort that was not sent.
      effort: def.supportsEffort && effort != null ? (effort as Effort) : null,
    },
  };
}

export function getTaskModel(task: LlmTask): TaskModel {
  const raw = getSetting(`task.${task}`);
  if (raw !== null) {
    try {
      const checked = checkTaskModel(JSON.parse(raw));
      if (checked.ok) return checked.value;
    } catch {
      // unparseable row: fall through to the default
    }
  }
  return { ...DEFAULT_TASKS[task] };
}

// ---------------------------------------------------------------------------
// Keys and endpoints

export function resolveKey(provider: ProviderId): { key: string; source: 'env' | 'db' } | null {
  const fromDb = getSetting(`key.${provider}`);
  if (fromDb !== null) return { key: fromDb, source: 'db' };
  const def = providerDef(provider);
  const fromEnv = def ? envValue(def.keyEnv) : null;
  return fromEnv !== null ? { key: fromEnv, source: 'env' } : null;
}

function checkCustomBaseUrl(value: string): Check<string> {
  const text = value.trim();
  try {
    const parsed = new URL(text);
    if (
      !/^https?:\/\//i.test(text) ||
      /[\u0000-\u001f\u007f\\]/.test(value) ||
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      text.includes('?') ||
      text.includes('#')
    ) {
      throw new Error('invalid endpoint');
    }
    // The compatible SDK appends /chat/completions. Local HTTP endpoints are
    // intentional admin configuration (for example Ollama), not source URLs.
    return { ok: true, value: parsed.href.replace(/\/+$/, '') };
  } catch {
    return {
      ok: false,
      message: 'De basis-URL moet een http(s)-URL zonder gebruikersnaam, wachtwoord, query of fragment zijn.',
    };
  }
}

function checkAzureResourceName(value: string): Check<string> {
  const text = value.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(text)) {
    return {
      ok: false,
      message: 'De Azure-resourcenaam moet 1 tot 63 letters, cijfers of koppeltekens bevatten en beginnen en eindigen met een letter of cijfer.',
    };
  }
  return { ok: true, value: text };
}

export function getCustomBaseUrl(): string | null {
  const value = getSetting('custom.baseUrl') ?? envValue('CUSTOM_LLM_BASE_URL');
  if (value === null) return null;
  const checked = checkCustomBaseUrl(value);
  if (!checked.ok) throw new ApiError(409, 'no_model_configured', `${checked.message} Pas dit aan onder Instellingen.`);
  return checked.value;
}

export function getAzureResourceName(): string | null {
  const value = getSetting('azure.resourceName') ?? envValue('AZURE_RESOURCE_NAME');
  if (value === null) return null;
  const checked = checkAzureResourceName(value);
  if (!checked.ok) throw new ApiError(409, 'no_model_configured', `${checked.message} Pas dit aan onder Instellingen.`);
  return checked.value;
}

export function getRetrievalMode(): RetrievalMode {
  return getSetting('retrieval.mode') === 'hybrid' ? 'hybrid' : 'bm25';
}

function getTtsProvider(): TtsProvider {
  const stored = getSetting('tts.provider');
  return TTS_PROVIDERS.includes(stored as TtsProvider) ? (stored as TtsProvider) : 'none';
}

function readTtsConfig(): TtsConfig {
  const provider = getTtsProvider();
  // An untagged legacy key has no trustworthy provider provenance: ask for it
  // again instead of potentially sending another vendor's credential.
  let key = provider !== 'none' && getSetting('tts.keyProvider') === provider
    ? getSetting('tts.key') || null
    : null;
  if (key === null && provider === 'elevenlabs') key = envValue('ELEVENLABS_API_KEY');
  if (key === null && provider === 'openai') key = resolveKey('openai')?.key ?? null;
  return { provider, voiceId: getSetting('tts.voiceId'), key: key?.trim() ? key : null };
}

export function getTtsConfig(): TtsConfig {
  // A writer may atomically switch providers between any two SELECTs. Read the
  // provider, key provenance, credential and voice in one consistent snapshot.
  return stmts().readTts();
}

// Never reveal an entire short credential (even a one-character local key).
function maskKey(key: string): string {
  return key.length >= 12 ? `${key.slice(0, 3)}…${key.slice(-4)}` : '…';
}

function providerBaseUrl(def: ProviderDef): string | null {
  try {
    if (def.id === 'custom') return getCustomBaseUrl();
    if (def.id === 'azure') {
      const resourceName = getAzureResourceName();
      return resourceName === null ? null : `https://${resourceName}.openai.azure.com`;
    }
    return null;
  } catch (err) {
    // Keep settings editable, but never publish unsafe legacy DB/env URLs.
    // The runtime getters still reject these values before making a request.
    if (err instanceof ApiError && err.code === 'no_model_configured') return null;
    throw err;
  }
}

export function getSettingsDto(): Settings {
  const providers: ProviderInfo[] = PROVIDERS.map((def) => {
    const resolved = resolveKey(def.id);
    return {
      id: def.id,
      label: def.label,
      hasKey: resolved !== null,
      keySource: resolved?.source ?? null,
      maskedKey: resolved === null ? null : maskKey(resolved.key),
      baseUrl: providerBaseUrl(def),
      models: [...def.models],
      supportsEffort: def.supportsEffort,
    };
  });
  const tts = getTtsConfig();
  return {
    tasks: {
      answer: getTaskModel('answer'),
      draft: getTaskModel('draft'),
      summary: getTaskModel('summary'),
    },
    providers,
    tts: { provider: tts.provider, voiceId: tts.voiceId, hasKey: tts.key !== null },
    retrieval: { mode: getRetrievalMode(), embeddingsAvailable: resolveKey('openai') !== null },
    municipality: MUNICIPALITY_NAME,
    testedConfiguration: getSetting('model.lastSuccessfulTest') ?? 'Nog geen geslaagde verbindingstest in deze werkruimte.',
  };
}

// ---------------------------------------------------------------------------
// Updates (PUT /api/settings)

export interface SettingsUpdate {
  tasks?: Partial<Record<LlmTask, TaskModel>>;
  keys?: Partial<Record<ProviderId, string | null>>;
  custom?: { baseUrl: string | null };
  azure?: { resourceName: string | null };
  tts?: { provider?: TtsProvider; voiceId?: string | null; key?: string | null };
  retrieval?: { mode: RetrievalMode };
}

function invalid(message: string): ApiError {
  return new ApiError(400, 'invalid_settings', message);
}

// Optional text field from the request body: null/empty clears, text is trimmed.
function optionalText(value: unknown, what: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw invalid(`${what} moet tekst zijn.`);
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// Validates the whole update before writing anything, then applies it in one
// transaction. Every write is a [key, value | null] pair (null deletes).
export function updateSettings(update: SettingsUpdate): Settings {
  if (typeof update !== 'object' || update === null || Array.isArray(update)) {
    throw invalid('De instellingen moeten een object zijn.');
  }
  for (const field of ['tasks', 'keys', 'custom', 'azure', 'tts', 'retrieval'] as const) {
    const value = update[field];
    if (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      throw invalid(`Het veld '${field}' moet een object zijn.`);
    }
  }
  const writes: [string, string | null][] = [];
  let ttsKey: string | null | undefined;

  if (update.tasks !== undefined) {
    for (const [task, value] of Object.entries(update.tasks)) {
      if (!TASKS.includes(task as LlmTask)) throw invalid(`Onbekende taak '${task}'.`);
      const checked = checkTaskModel(value);
      if (!checked.ok) throw invalid(`Taak '${task}': ${checked.message}`);
      writes.push([`task.${task}`, JSON.stringify(checked.value)]);
    }
  }

  if (update.keys !== undefined) {
    for (const [provider, value] of Object.entries(update.keys)) {
      const def = providerDef(provider);
      if (def === undefined) throw invalid(`Onbekende provider '${provider}'.`);
      const key = optionalText(value, `De sleutel voor ${def.label}`);
      if (key !== null && key.includes('…')) {
        throw invalid(`De sleutel voor ${def.label} bevat een maskeringsteken; voer de volledige sleutel in.`);
      }
      writes.push([`key.${provider}`, key]);
    }
  }

  if (update.custom !== undefined) {
    const baseUrl = optionalText(update.custom.baseUrl, 'De basis-URL');
    const checked = baseUrl === null ? null : checkCustomBaseUrl(update.custom.baseUrl as string);
    if (checked !== null && !checked.ok) throw invalid(checked.message);
    writes.push(['custom.baseUrl', checked?.value ?? null]);
  }

  if (update.azure !== undefined) {
    const resourceName = optionalText(update.azure.resourceName, 'De Azure-resourcenaam');
    const checked = resourceName === null ? null : checkAzureResourceName(resourceName);
    if (checked !== null && !checked.ok) throw invalid(checked.message);
    writes.push(['azure.resourceName', checked?.value ?? null]);
  }

  if (update.tts !== undefined) {
    const { provider, voiceId, key } = update.tts;
    if (provider !== undefined) {
      if (!TTS_PROVIDERS.includes(provider)) throw invalid('Onbekende spraakprovider.');
      writes.push(['tts.provider', provider]);
    }
    if (voiceId !== undefined) writes.push(['tts.voiceId', optionalText(voiceId, 'De stem-id')]);
    if (key !== undefined) {
      ttsKey = optionalText(key, 'De spraaksleutel');
      if (ttsKey !== null && ttsKey.includes('…')) {
        throw invalid('De spraaksleutel bevat een maskeringsteken; voer de volledige sleutel in.');
      }
    }
  }

  if (update.retrieval !== undefined) {
    const { mode } = update.retrieval;
    if (!RETRIEVAL_MODES.includes(mode)) throw invalid('Onbekende zoekmodus.');
    writes.push(['retrieval.mode', mode]);
  }

  const apply = stmts().db.transaction((rows: [string, string | null][]) => {
    if (update.tts !== undefined) {
      // Read and compare inside the same write transaction as the key change.
      // This also protects against another server worker changing the provider.
      const currentProvider = getTtsProvider();
      const nextProvider = update.tts.provider ?? currentProvider;
      if (ttsKey !== undefined) {
        if (ttsKey !== null && nextProvider === 'none') {
          throw invalid('Kies eerst een spraakprovider voordat u een spraaksleutel opslaat.');
        }
        rows.push(['tts.key', ttsKey], ['tts.keyProvider', ttsKey === null ? null : nextProvider]);
      } else if (nextProvider !== currentProvider) {
        rows.push(['tts.key', null], ['tts.keyProvider', null]);
      }
    }
    for (const [key, value] of rows) setSetting(key, value);
  });
  apply.immediate(writes);
  return getSettingsDto();
}

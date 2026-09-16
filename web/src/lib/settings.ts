// Officer-editable configuration (PLAN.md section 4 and 7): which model runs
// which task, API keys, the custom/Azure endpoints, TTS and retrieval mode.
// Rows live in the `settings` table (key, value, updated_at); a DB row always
// overrides the environment variable, env is only the bootstrap. Keys leave
// this module masked, never in full.
import type Database from 'better-sqlite3';
import { ApiError } from './api';
import { getDb, nowIso } from './db';
import { PROVIDERS, type ProviderDef } from './llm';
import type { Effort, LlmTask, ProviderId, ProviderInfo, Settings, TaskModel } from './types';

export const MUNICIPALITY_NAME: string = process.env.MUNICIPALITY_NAME ?? 'Schoten';
export const TESTED_CONFIGURATION = 'openai/gpt-6-astra';

const parsedBudget = Number.parseInt(process.env.RETRIEVAL_CHAR_BUDGET ?? '', 10);
export const RETRIEVAL_CHAR_BUDGET: number =
  Number.isFinite(parsedBudget) && parsedBudget > 0 ? parsedBudget : 60000;

export const DEFAULT_TASKS: Record<LlmTask, TaskModel> = {
  answer: { provider: 'openai', model: 'gpt-6-astra', effort: 'low' },
  draft: { provider: 'openai', model: 'gpt-5.6-terra', effort: 'none' },
  summary: { provider: 'openai', model: 'gpt-5.6-luna', effort: 'none' },
};

const TASKS: readonly LlmTask[] = ['answer', 'draft', 'summary'];
const EFFORTS: readonly Effort[] = ['none', 'low', 'medium', 'high'];
const TTS_PROVIDERS = ['none', 'elevenlabs', 'openai'] as const;
const RETRIEVAL_MODES = ['bm25', 'hybrid'] as const;
type TtsProvider = (typeof TTS_PROVIDERS)[number];
type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

// ---------------------------------------------------------------------------
// Row access

interface Statements {
  db: Database.Database;
  get: Database.Statement<[string], { value: string }>;
  put: Database.Statement<[string, string, string]>;
  del: Database.Statement<[string]>;
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
    return { ok: false, message: `Onbekende provider '${String(provider)}'.` };
  }
  if (typeof model !== 'string' || model.trim() === '') {
    return { ok: false, message: 'De modelnaam mag niet leeg zijn.' };
  }
  if (effort !== null && effort !== undefined && !EFFORTS.includes(effort as Effort)) {
    return {
      ok: false,
      message: `Ongeldig redeneerniveau '${String(effort)}' (toegestaan: none, low, medium, high).`,
    };
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

export function getCustomBaseUrl(): string | null {
  return getSetting('custom.baseUrl') ?? envValue('CUSTOM_LLM_BASE_URL');
}

export function getAzureResourceName(): string | null {
  return getSetting('azure.resourceName') ?? envValue('AZURE_RESOURCE_NAME');
}

export function getRetrievalMode(): RetrievalMode {
  return getSetting('retrieval.mode') === 'hybrid' ? 'hybrid' : 'bm25';
}

export function getTtsConfig(): { provider: TtsProvider; voiceId: string | null; key: string | null } {
  const stored = getSetting('tts.provider');
  const provider = TTS_PROVIDERS.includes(stored as TtsProvider) ? (stored as TtsProvider) : 'none';
  let key = getSetting('tts.key');
  if (key === null && provider === 'elevenlabs') key = envValue('ELEVENLABS_API_KEY');
  if (key === null && provider === 'openai') key = resolveKey('openai')?.key ?? null;
  return { provider, voiceId: getSetting('tts.voiceId'), key };
}

// `sk-…7f3a`: first 3 + ellipsis + last 4; short keys only reveal the last 2.
function maskKey(key: string): string {
  return key.length >= 12 ? `${key.slice(0, 3)}…${key.slice(-4)}` : `…${key.slice(-2)}`;
}

function providerBaseUrl(def: ProviderDef): string | null {
  if (def.id === 'custom') return getCustomBaseUrl();
  if (def.id === 'azure') {
    const resourceName = getAzureResourceName();
    return resourceName === null ? null : `https://${resourceName}.openai.azure.com`;
  }
  return null;
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
    testedConfiguration: TESTED_CONFIGURATION,
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
  const writes: [string, string | null][] = [];

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
    if (baseUrl !== null) {
      let parsed: URL | null = null;
      try {
        parsed = new URL(baseUrl);
      } catch {
        parsed = null;
      }
      if (parsed === null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        throw invalid(`Ongeldige basis-URL '${baseUrl}' (verwacht http:// of https://).`);
      }
    }
    writes.push(['custom.baseUrl', baseUrl]);
  }

  if (update.azure !== undefined) {
    const resourceName = optionalText(update.azure.resourceName, 'De Azure-resourcenaam');
    if (resourceName !== null && !/^[A-Za-z0-9-]+$/.test(resourceName)) {
      throw invalid(`Ongeldige Azure-resourcenaam '${resourceName}' (alleen letters, cijfers en koppeltekens).`);
    }
    writes.push(['azure.resourceName', resourceName]);
  }

  if (update.tts !== undefined) {
    const { provider, voiceId, key } = update.tts;
    if (provider !== undefined) {
      if (!TTS_PROVIDERS.includes(provider)) throw invalid(`Onbekende spraakprovider '${String(provider)}'.`);
      writes.push(['tts.provider', provider]);
    }
    if (voiceId !== undefined) writes.push(['tts.voiceId', optionalText(voiceId, 'De stem-id')]);
    if (key !== undefined) writes.push(['tts.key', optionalText(key, 'De spraaksleutel')]);
  }

  if (update.retrieval !== undefined) {
    const { mode } = update.retrieval;
    if (!RETRIEVAL_MODES.includes(mode)) throw invalid(`Onbekende zoekmodus '${String(mode)}'.`);
    writes.push(['retrieval.mode', mode]);
  }

  const apply = stmts().db.transaction((rows: [string, string | null][]) => {
    for (const [key, value] of rows) setSetting(key, value);
  });
  apply(writes);
  return getSettingsDto();
}

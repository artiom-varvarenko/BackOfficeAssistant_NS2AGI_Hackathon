// Provider-neutral model layer (PLAN.md sections 4.3 and 8.3): the provider
// registry, task → model resolution from settings, and the two call shapes the
// engine needs (structured object for the answer, plain text for drafts and
// summaries). Everything goes through the AI SDK (`ai`) so the provider is a
// setting, not a code path. Never sets `temperature`.
import { setTimeout as delay } from 'node:timers/promises';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  Output,
  RetryError,
  type JSONValue,
  type LanguageModel,
  type LanguageModelCallOptions,
  type RequestOptions,
} from 'ai';
import type { z } from 'zod';
import { ApiError } from './api';
import { redactSecrets, safeModelErrorMessage } from './model-errors';
import { getAzureResourceName, getCustomBaseUrl, getTaskModel, resolveKey } from './settings';
import type { Effort, LlmTask, ProviderId, TaskModel } from './types';

// Output budget for the answer-with-citations call (PLAN.md section 4.2).
export const ANSWER_MAX_OUTPUT_TOKENS = 2500;
const PLAIN_MAX_OUTPUT_TOKENS = 1500;
export const MODEL_TIMEOUT_MS = 120_000;

export interface ProviderDef {
  id: ProviderId;
  label: string;
  keyEnv: string;
  // Curated dropdown; any model id is accepted at call time.
  models: string[];
  supportsEffort: boolean;
  keyOptional: boolean;
  make(
    key: string | null,
    opts: { baseUrl: string | null; resourceName: string | null },
  ): (modelId: string) => LanguageModel;
}

export class NoModelConfiguredError extends ApiError {
  constructor(message: string) {
    super(409, 'no_model_configured', message);
    this.name = 'NoModelConfiguredError';
  }
}

export class ModelFailedError extends ApiError {
  constructor(message: string, secrets: readonly string[] = []) {
    super(502, 'model_failed', redactSecrets(message, secrets));
    this.name = 'ModelFailedError';
  }
}

export interface LlmCallMeta {
  provider: ProviderId;
  model: string;
  effort: Effort | null;
  usage: unknown;
  latencyMs: number;
}

const SETTINGS_HINT = 'Pas dit aan onder Instellingen.';

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    keyEnv: 'OPENAI_API_KEY',
    models: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
    supportsEffort: true,
    keyOptional: false,
    make(key) {
      const provider = createOpenAI({ apiKey: key ?? undefined }); // callable = Responses API
      return (modelId) => provider(modelId);
    },
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyEnv: 'ANTHROPIC_API_KEY',
    models: ['claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-4-5'],
    supportsEffort: true,
    keyOptional: false,
    make(key) {
      const provider = createAnthropic({ apiKey: key ?? undefined });
      return (modelId) => provider(modelId);
    },
  },
  {
    id: 'google',
    label: 'Google',
    keyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    models: ['gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    supportsEffort: true,
    keyOptional: false,
    make(key) {
      const provider = createGoogleGenerativeAI({ apiKey: key ?? undefined });
      return (modelId) => provider(modelId);
    },
  },
  {
    id: 'mistral',
    label: 'Mistral (EU)',
    keyEnv: 'MISTRAL_API_KEY',
    models: ['mistral-medium-latest', 'mistral-small-latest'],
    supportsEffort: false,
    keyOptional: false,
    make(key) {
      const provider = createMistral({ apiKey: key ?? undefined });
      return (modelId) => provider(modelId);
    },
  },
  {
    id: 'azure',
    label: 'Azure OpenAI',
    keyEnv: 'AZURE_OPENAI_API_KEY',
    models: [], // the model id is the deployment name
    supportsEffort: true,
    keyOptional: false,
    make(key, { resourceName }) {
      if (resourceName === null) {
        throw new NoModelConfiguredError(`Geen Azure-resourcenaam ingesteld. ${SETTINGS_HINT}`);
      }
      const provider = createAzure({ resourceName, apiKey: key ?? undefined });
      return (deploymentId) => provider(deploymentId);
    },
  },
  {
    id: 'custom',
    label: 'Aangepast (OpenAI-compatibel)',
    keyEnv: 'CUSTOM_LLM_API_KEY',
    models: [],
    supportsEffort: false,
    keyOptional: true, // Ollama and vLLM run without a key
    make(key, { baseUrl }) {
      if (baseUrl === null) {
        throw new NoModelConfiguredError(`Geen basis-URL ingesteld voor de aangepaste provider. ${SETTINGS_HINT}`);
      }
      const provider = createOpenAICompatible({ name: 'custom', baseURL: baseUrl, apiKey: key ?? undefined });
      return (modelId) => provider(modelId);
    },
  },
];

export interface ResolvedTaskModel {
  def: ProviderDef;
  taskModel: TaskModel;
  model: LanguageModel;
}

// Credentials stay outside the exported resolved object. Capture the value used
// at request creation, not a possibly changed setting when an error arrives.
const resolvedSecrets = new WeakMap<ResolvedTaskModel, readonly string[]>();

export function resolveTaskModel(task: LlmTask): ResolvedTaskModel {
  const taskModel = getTaskModel(task);
  const def = PROVIDERS.find((p) => p.id === taskModel.provider);
  if (def === undefined) throw new Error(`Unknown provider '${taskModel.provider}' for task '${task}'`);
  const resolved = resolveKey(def.id);
  if (resolved === null && !def.keyOptional) {
    throw new NoModelConfiguredError(
      `Geen API-sleutel ingesteld voor ${def.label}. Voeg een sleutel toe onder Instellingen.`,
    );
  }
  const secrets = resolved === null ? [] : [resolved.key];
  try {
    const model = def.make(resolved?.key ?? null, {
      // Invalid configuration for an unrelated provider must not block a call.
      baseUrl: def.id === 'custom' ? getCustomBaseUrl() : null,
      resourceName: def.id === 'azure' ? getAzureResourceName() : null,
    })(taskModel.model);
    const result = { def, taskModel, model };
    resolvedSecrets.set(result, secrets);
    return result;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ModelFailedError(
      `Aanroep van ${def.label} · ${taskModel.model} mislukt: ${safeModelErrorMessage(err, secrets)}`,
      secrets,
    );
  }
}

// Everything a call needs except the `output` specification.
interface CallArgs extends LanguageModelCallOptions, RequestOptions {
  model: LanguageModel;
  abortSignal: AbortSignal;
  instructions: string;
  prompt: string;
  providerOptions?: Record<string, Record<string, JSONValue>>;
}

// Effort mapping. ai@7 has a portable top-level `reasoning` option
// ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh', ai/dist/index.d.ts:588)
// that every installed provider translates itself, with model-aware coercion
// instead of API errors:
//   openai / azure  → `reasoning.effort` on the Responses API; identical to
//                     providerOptions.openai.reasoningEffort (@ai-sdk/openai
//                     dist/index.js:7072) and dropped with a warning when the
//                     model does not support it (gpt-6 has no 'none', :65).
//   anthropic       → `thinking: { type: 'adaptive' }` + `effort`, or a token
//                     budget for older models; 'none' → thinking disabled
//                     (@ai-sdk/anthropic dist/index.js:5922-5962).
//   google          → `thinkingConfig.thinkingLevel` (Gemini 3, honouring the
//                     per-model minimum) or `thinkingBudget` (Gemini 2.5)
//                     (@ai-sdk/google dist/index.js:2547-2620).
//   mistral, custom → not sent (supportsEffort false; Mistral only knows
//                     none/high for a few reasoning models, custom servers vary).
// OpenAI/Azure additionally get `textVerbosity: 'low'` (terse prose around the
// JSON) and `store: false` (no retention of officer questions on OpenAI's side).
// Reuse this single argument object across attempts, including streaming: its
// signal is the total deadline and SDK retries are off. The caller owns at most
// one retry across transport and JSON failures, not one of each.
export function callArgs(resolved: ResolvedTaskModel, system: string, prompt: string, maxOutputTokens: number): CallArgs {
  const { def, taskModel, model } = resolved;
  const openaiFamily = def.id === 'openai' || def.id === 'azure';
  return {
    model,
    instructions: system,
    prompt,
    maxOutputTokens,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    reasoning: def.supportsEffort && taskModel.effort !== null ? taskModel.effort : undefined,
    providerOptions: openaiFamily ? { openai: { textVerbosity: 'low', store: false } } : undefined,
  };
}

// Reusable by the streaming path. Only sanitized message text may leave the
// model boundary; SDK errors also carry headers, response bodies and config.
export function toModelFailed(resolved: ResolvedTaskModel, err: unknown): ApiError {
  const secrets = resolvedSecrets.get(resolved) ?? [];
  if (err instanceof ApiError) {
    return err.code === 'model_failed'
      ? new ModelFailedError(err.message, secrets)
      : new ApiError(err.status, err.code, redactSecrets(err.message, secrets));
  }
  const root = RetryError.isInstance(err) ? err.lastError : err;
  return new ModelFailedError(
    `Aanroep van ${resolved.def.label} · ${resolved.taskModel.model} mislukt: ${safeModelErrorMessage(root, secrets)}`,
    secrets,
  );
}

function meta(resolved: ResolvedTaskModel, usage: unknown, startedAt: number): LlmCallMeta {
  return {
    provider: resolved.def.id,
    model: resolved.taskModel.model,
    effort: resolved.taskModel.effort,
    usage,
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

// One retry budget for the whole operation. A schema/JSON failure can spend it
// on JSON mode; a retryable transport failure can spend it on the same request.
// The second attempt never gets another transport or JSON retry. Compatible
// servers already use JSON mode for Output.object plus local schema validation.
export async function generateStructured<T>(
  task: LlmTask,
  args: { system: string; prompt: string; schema: z.ZodType<T>; maxOutputTokens?: number },
): Promise<{ output: T; raw: string } & LlmCallMeta> {
  const resolved = resolveTaskModel(task);
  const base = callArgs(resolved, args.system, args.prompt, args.maxOutputTokens ?? ANSWER_MAX_OUTPUT_TOKENS);
  const startedAt = performance.now();
  try {
    base.abortSignal.throwIfAborted();
    try {
      const result = await generateText({ ...base, output: Output.object({ schema: args.schema }) });
      base.abortSignal.throwIfAborted();
      return { output: result.output, raw: result.text, ...meta(resolved, result.usage, startedAt) };
    } catch (err) {
      base.abortSignal.throwIfAborted();
      if (APICallError.isInstance(err) && err.isRetryable) {
        await delay(2000, undefined, { signal: base.abortSignal });
        const result = await generateText({ ...base, output: Output.object({ schema: args.schema }) });
        base.abortSignal.throwIfAborted();
        return { output: result.output, raw: result.text, ...meta(resolved, result.usage, startedAt) };
      }
      if (!NoObjectGeneratedError.isInstance(err)) throw err;
    }
    const result = await generateText({ ...base, output: Output.json() });
    base.abortSignal.throwIfAborted();
    const parsed = args.schema.safeParse(result.output);
    if (!parsed.success) {
      throw new ModelFailedError(
        `Aanroep van ${resolved.def.label} · ${resolved.taskModel.model} mislukt: het antwoord voldeed ook na een tweede poging niet aan het verwachte formaat.`,
      );
    }
    return { output: parsed.data, raw: result.text, ...meta(resolved, result.usage, startedAt) };
  } catch (err) {
    throw toModelFailed(resolved, err);
  }
}

export async function generateTextPlain(
  task: LlmTask,
  args: { system: string; prompt: string; maxOutputTokens?: number },
): Promise<{ text: string } & LlmCallMeta> {
  const resolved = resolveTaskModel(task);
  const base = callArgs(resolved, args.system, args.prompt, args.maxOutputTokens ?? PLAIN_MAX_OUTPUT_TOKENS);
  const startedAt = performance.now();
  try {
    // No JSON fallback here, so the SDK may own the single transport retry.
    base.abortSignal.throwIfAborted();
    const result = await generateText({ ...base, maxRetries: 1 });
    base.abortSignal.throwIfAborted();
    return { text: result.text, ...meta(resolved, result.usage, startedAt) };
  } catch (err) {
    throw toModelFailed(resolved, err);
  }
}

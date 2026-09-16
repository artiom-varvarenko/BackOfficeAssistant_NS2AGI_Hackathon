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
  StreamProviderError,
  streamText,
  type DeepPartial,
  type JSONValue,
  type LanguageModel,
  type LanguageModelCallOptions,
  type RequestOptions,
} from 'ai';
import type { z } from 'zod';
import { ApiError } from './api';
import { getDb } from './db';
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
  // An atomic settings update in another worker can switch a custom endpoint
  // and its key together. Read one snapshot so the old key is never sent to
  // the new endpoint (and the task/model describe that same configuration).
  const { taskModel, def, resolved, baseUrl, resourceName } = getDb().transaction(() => {
    const taskModel = getTaskModel(task);
    const def = PROVIDERS.find((p) => p.id === taskModel.provider);
    if (def === undefined) throw new Error(`Unknown provider '${taskModel.provider}' for task '${task}'`);
    const resolved = resolveKey(def.id);
    if (resolved === null && !def.keyOptional) {
      throw new NoModelConfiguredError(
        `Geen API-sleutel ingesteld voor ${def.label}. Voeg een sleutel toe onder Instellingen.`,
      );
    }
    return {
      taskModel, def, resolved,
      // Invalid configuration for an unrelated provider must not block a call.
      baseUrl: def.id === 'custom' ? getCustomBaseUrl() : null,
      resourceName: def.id === 'azure' ? getAzureResourceName() : null,
    };
  })();
  const secrets = resolved === null ? [] : [resolved.key];
  try {
    const model = def.make(resolved?.key ?? null, { baseUrl, resourceName })(taskModel.model);
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
export function callArgs(
  resolved: ResolvedTaskModel,
  system: string,
  prompt: string,
  maxOutputTokens: number,
  abortSignal?: AbortSignal,
): CallArgs {
  const { def, taskModel, model } = resolved;
  const openaiFamily = def.id === 'openai' || def.id === 'azure';
  const deadline = AbortSignal.timeout(MODEL_TIMEOUT_MS);
  return {
    model,
    instructions: system,
    prompt,
    // OpenAI counts hidden reasoning against this same cap. Extra-high effort
    // needs room beyond the short visible-answer budget to finish its answer.
    maxOutputTokens: openaiFamily && taskModel.effort === 'xhigh' ? Math.max(maxOutputTokens, 25_000) : maxOutputTokens,
    maxRetries: 0,
    abortSignal: abortSignal === undefined ? deadline : AbortSignal.any([abortSignal, deadline]),
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

export interface StructuredArguments<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}

export interface StructuredResult<T> extends LlmCallMeta {
  output: T;
  raw: string;
  // The final attempt's actual instructions, including the schema in a JSON
  // mode retry. The answer keeps this alongside the unchanged source prompt.
  instructions: string;
}

type PartialOutputCallback = (partial: unknown) => void;
type StructuredOutput<T> = Output.Output<T, DeepPartial<T>, never>;

async function streamStructuredAttempt<T>(
  base: CallArgs,
  output: StructuredOutput<T>,
  onPartial: PartialOutputCallback,
): Promise<{ output: T; raw: string; usage: unknown }> {
  const attempt = new AbortController();
  const signal = AbortSignal.any([base.abortSignal, attempt.signal]);
  let streamFailed = false;
  let streamError: unknown;
  const result = streamText({
    ...base,
    abortSignal: signal,
    output,
    // Never use the SDK's default raw-error logger. Error parts need explicit
    // tracking: partialOutputStream can reach clean EOF after a provider error.
    // Omit streamRetries, which otherwise introduces a second retry budget.
    onError: ({ error }) => {
      if (!streamFailed) streamError = error;
      streamFailed = true;
    },
  });
  const reader = result.partialOutputStream.getReader();
  // These getters start SDK tee consumers. Observe every derived promise now,
  // not after the partial loop, so an early rejection is always handled.
  const settled = Promise.allSettled([result.output, result.text, result.usage] as const);
  let cancellation: Promise<void> | undefined;
  const cancelReader = () => {
    cancellation ??= reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancelReader, { once: true });
  if (signal.aborted) cancelReader();
  let succeeded = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      onPartial(value);
    }
    const [parsed, raw, usage] = await settled;
    signal.throwIfAborted();
    if (streamFailed) throw streamError;
    if (parsed.status === 'rejected') throw parsed.reason;
    if (raw.status === 'rejected') throw raw.reason;
    if (usage.status === 'rejected') throw usage.reason;
    succeeded = true;
    return { output: parsed.value, raw: raw.value, usage: usage.value };
  } finally {
    if (!succeeded) {
      // Cancel a tee branch only after aborting its underlying SDK request.
      attempt.abort();
      cancelReader();
    }
    signal.removeEventListener('abort', cancelReader);
    await cancellation;
    await settled;
    reader.releaseLock();
  }
}

// Exactly one retry for the entire operation, regardless of transport, streamed
// provider errors or final JSON/schema failure. The same resolved object owns
// credentials, model metadata and safe error conversion for every attempt.
async function structured<T>(
  resolved: ResolvedTaskModel,
  args: StructuredArguments<T>,
  onPartial?: PartialOutputCallback,
): Promise<StructuredResult<T>> {
  const base = callArgs(
    resolved, args.system, args.prompt, args.maxOutputTokens ?? ANSWER_MAX_OUTPUT_TOKENS, args.abortSignal,
  );
  const startedAt = performance.now();
  const schemaOutput = Output.object({ schema: args.schema });
  let output = schemaOutput;
  let instructions = base.instructions;
  let consumerFailed = false;
  const reportPartial = onPartial === undefined ? undefined : (partial: unknown) => {
    try {
      onPartial(partial);
    } catch (err) {
      consumerFailed = true;
      throw err;
    }
  };
  try {
    for (let attempt = 0; ; attempt++) {
      base.abortSignal.throwIfAborted();
      try {
        let result: { output: T; raw: string; usage: unknown };
        if (reportPartial === undefined) {
          const generated = await generateText({ ...base, instructions, output });
          result = { output: generated.output, raw: generated.text, usage: generated.usage };
        } else {
          result = await streamStructuredAttempt({ ...base, instructions }, output, reportPartial);
        }
        base.abortSignal.throwIfAborted();
        return { ...result, instructions, ...meta(resolved, result.usage, startedAt) };
      } catch (err) {
        base.abortSignal.throwIfAborted();
        if (attempt >= 1 || consumerFailed) throw err;
        const root = RetryError.isInstance(err) ? err.lastError : err;
        if (NoObjectGeneratedError.isInstance(root)) {
          // Anthropic explicitly ignores schema-less JSON mode. Every other
          // registered adapter supports it; retain Output.object's final schema
          // parser even when retrying with Output.json's response format.
          if (resolved.def.id !== 'anthropic') {
            const format = await schemaOutput.responseFormat;
            output = { ...schemaOutput, responseFormat: Output.json().responseFormat };
            // JSON-mode providers require an explicit JSON instruction, and
            // removing responseFormat.schema must not also lose field guidance.
            instructions = `${base.instructions}\n\nGeef uitsluitend een geldig JSON-object met dit schema:\n${JSON.stringify(format?.type === 'json' ? format.schema : undefined)}`;
          }
        } else if (
          (APICallError.isInstance(root) || StreamProviderError.isInstance(root)) && root.isRetryable
        ) {
          await delay(2000, undefined, { signal: base.abortSignal });
        } else {
          throw err;
        }
        // A partial is a replacement snapshot, not a delta. Clear any text
        // emitted by the failed attempt before the next attempt starts.
        reportPartial?.(undefined);
      }
    }
  } catch (err) {
    throw toModelFailed(resolved, err);
  }
}

export async function generateStructured<T>(
  task: LlmTask | ResolvedTaskModel,
  args: StructuredArguments<T>,
): Promise<StructuredResult<T>> {
  return structured(typeof task === 'string' ? resolveTaskModel(task) : task, args);
}

export async function streamStructured<T>(
  resolved: ResolvedTaskModel,
  args: StructuredArguments<T>,
  onPartial: PartialOutputCallback,
): Promise<StructuredResult<T>> {
  return structured(resolved, args, onPartial);
}

export async function generateTextPlain(
  task: LlmTask,
  args: { system: string; prompt: string; maxOutputTokens?: number; abortSignal?: AbortSignal },
): Promise<{ text: string } & LlmCallMeta> {
  const resolved = resolveTaskModel(task);
  const base = callArgs(
    resolved, args.system, args.prompt, args.maxOutputTokens ?? PLAIN_MAX_OUTPUT_TOKENS, args.abortSignal,
  );
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

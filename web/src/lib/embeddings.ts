// One embedding space for both immutable passage text and questions. The schema
// has no model column, so changing this model/dimension pair requires reindexing.
import { setTimeout as delay } from 'node:timers/promises';
import { createOpenAI } from '@ai-sdk/openai';
import { APICallError, embedMany, wrapEmbeddingModel } from 'ai';
import type { Database, Statement } from 'better-sqlite3';
import { ApiError } from './api';
import { getDb } from './db';
import { safeModelErrorMessage } from './model-errors';
import { resolveKey } from './settings';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMS = 1536;
const EMBEDDING_TIMEOUT_MS = 120_000;
const EMBEDDING_BATCH_SIZE = 64;

export interface StoredEmbedding {
  values: DataView;
  norm: number;
}

// DataView respects a Buffer's byte offset (which need not be aligned) and the
// explicit little-endian format. Never reinterpret corrupt rows as zero vectors.
export function readEmbedding(dims: unknown, vector: unknown): StoredEmbedding | null {
  if (dims !== EMBEDDING_DIMS || !(vector instanceof Uint8Array) || vector.byteLength !== EMBEDDING_DIMS * 4) {
    return null;
  }
  const values = new DataView(vector.buffer, vector.byteOffset, vector.byteLength);
  let squaredNorm = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) {
    const value = values.getFloat32(i * 4, true);
    if (!Number.isFinite(value)) return null;
    squaredNorm += value * value;
  }
  if (!Number.isFinite(squaredNorm) || squaredNorm === 0) return null;
  return { values, norm: Math.sqrt(squaredNorm) };
}

function invalidEmbedding(): Error {
  return new Error('OpenAI gaf ongeldige embeddings terug. Bereken de embeddings opnieuw.');
}

function encodeEmbedding(values: unknown): Buffer {
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMS) throw invalidEmbedding();
  const vector = Buffer.allocUnsafe(EMBEDDING_DIMS * 4);
  let squaredNorm = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) {
    const value = values[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidEmbedding();
    // Validate the stored representation too: float64 can overflow or underflow
    // on conversion to float32 even when the provider's original value is finite.
    const float = Math.fround(value);
    if (!Number.isFinite(float)) throw invalidEmbedding();
    squaredNorm += float * float;
    vector.writeFloatLE(float, i * 4);
  }
  if (!Number.isFinite(squaredNorm) || squaredNorm === 0) throw invalidEmbedding();
  return vector;
}

// A session owns one captured key, one deadline and ONE retry allowance across
// every SDK batch. SDK retries are disabled: maxRetries: 1 on embedMany would
// incorrectly allow one retry per batch. The wrapper retains OpenAI's aggregate
// byte limit, while limiting each request to 64 passages, sequentially.
export function createEmbeddingSession(abortSignal?: AbortSignal) {
  const configured = resolveKey('openai');
  if (!configured || configured.key.trim() === '') {
    throw new ApiError(409, 'no_model_configured', 'Stel in Instellingen een OpenAI-sleutel in om embeddings en hybride zoeken te gebruiken.');
  }
  const key = configured.key;
  const deadline = AbortSignal.timeout(EMBEDDING_TIMEOUT_MS);
  const signal = abortSignal ? AbortSignal.any([abortSignal, deadline]) : deadline;
  let retryAvailable = true;
  const model = wrapEmbeddingModel({
    model: createOpenAI({ apiKey: key }).embeddingModel(EMBEDDING_MODEL),
    middleware: {
      overrideMaxEmbeddingsPerCall: () => EMBEDDING_BATCH_SIZE,
      wrapEmbed: async ({ doEmbed, params }) => {
        signal.throwIfAborted();
        let result;
        try {
          result = await doEmbed();
        } catch (error) {
          signal.throwIfAborted();
          if (!retryAvailable || !APICallError.isInstance(error) || !error.isRetryable) throw error;
          retryAvailable = false;
          await delay(2000, undefined, { signal });
          result = await doEmbed();
        }
        signal.throwIfAborted();
        // The installed OpenAI adapter preserves response array order but does
        // not validate its indices. Reject an ambiguous mapping rather than
        // attaching a valid vector to the wrong immutable passage.
        const body = result.response?.body;
        const data = body && typeof body === 'object' && 'data' in body ? body.data : undefined;
        if (!Array.isArray(data) || data.length !== params.values.length ||
          data.some((item, index) => !item || typeof item !== 'object' || item.index !== index)) {
          throw invalidEmbedding();
        }
        return result;
      },
    },
  });

  return {
    signal,
    async embed(values: string[]): Promise<Buffer[]> {
      try {
        signal.throwIfAborted();
        const result = await embedMany({
          model,
          values,
          maxRetries: 0,
          maxParallelCalls: 1,
          abortSignal: signal,
          providerOptions: { openai: { dimensions: EMBEDDING_DIMS } },
        });
        signal.throwIfAborted();
        if (result.embeddings.length !== values.length) throw invalidEmbedding();
        return result.embeddings.map(encodeEmbedding);
      } catch (error) {
        throw new ApiError(502, 'model_failed', `Embeddings via OpenAI · ${EMBEDDING_MODEL} mislukt: ${safeModelErrorMessage(error, [key])}`);
      }
    },
  };
}

interface SourceState {
  current_version_id: string | null;
  processing_status: string | null;
}

interface EmbeddingPassageRow {
  id: string;
  text: string;
  dims: number | null;
  vector: Buffer | null;
}

interface Statements {
  source: Statement<[string], SourceState>;
  passages: Statement<[string], EmbeddingPassageRow>;
  upsert: Statement<[string, number, Buffer]>;
}

function prepare(db: Database): Statements {
  return {
    source: db.prepare(`
      SELECT s.current_version_id, v.processing_status
      FROM sources s LEFT JOIN source_versions v
        ON v.id = s.current_version_id AND v.source_id = s.id
      WHERE s.id = ?`),
    passages: db.prepare(`
      SELECT p.id, p.text, e.dims, e.vector FROM passages p
      LEFT JOIN passage_embeddings e ON e.passage_id = p.id
      WHERE p.version_id = ? ORDER BY p.ordinal, p.id`),
    upsert: db.prepare(`
      INSERT INTO passage_embeddings (passage_id, dims, vector) VALUES (?, ?, ?)
      ON CONFLICT(passage_id) DO UPDATE SET dims = excluded.dims, vector = excluded.vector`),
  };
}

let statements: Statements | undefined;

// Returns the TOTAL number of indexed passages in the captured current version,
// including already-compatible vectors. Replacing a source during the remote
// call discards the new vectors with source_changed; no stale success or partial
// writes. Disabled sources may be prepared, but retrieval never includes them.
export async function embedSource(sourceId: string, expectedVersionId?: string): Promise<number> {
  const db = getDb();
  const sql = (statements ??= prepare(db));
  const snapshot = db.transaction(() => {
    const source = sql.source.get(sourceId);
    if (!source) throw new ApiError(404, 'not_found', 'Bron niet gevonden.');
    if (expectedVersionId !== undefined && source.current_version_id !== expectedVersionId) {
      throw new ApiError(409, 'source_changed', 'De huidige bronversie is ondertussen gewijzigd. Bereken de embeddings opnieuw voor de huidige versie.');
    }
    if (!source.current_version_id || source.processing_status !== 'ready') {
      throw new ApiError(409, 'source_not_ready', 'De huidige bronversie is nog niet klaar. Verwerk de bron eerst voordat u embeddings berekent.');
    }
    return { versionId: source.current_version_id, passages: sql.passages.all(source.current_version_id) };
  })();
  const session = createEmbeddingSession();
  const missing = snapshot.passages.filter((passage) => readEmbedding(passage.dims, passage.vector) === null);
  const vectors = missing.length > 0 ? await session.embed(missing.map((passage) => passage.text)) : [];

  // All remote batches and vector validation complete BEFORE opening the write
  // transaction. The immediate transaction guards the version check and writes
  // together even when another process is ingesting a replacement concurrently.
  db.transaction(() => {
    const source = sql.source.get(sourceId);
    if (!source || source.current_version_id !== snapshot.versionId || source.processing_status !== 'ready') {
      throw new ApiError(409, 'source_changed', 'De huidige bronversie is ondertussen gewijzigd. Bereken de embeddings opnieuw voor de huidige versie.');
    }
    for (let i = 0; i < missing.length; i++) sql.upsert.run(missing[i].id, EMBEDDING_DIMS, vectors[i]);
  }).immediate();
  return snapshot.passages.length;
}

import { createOpenAI } from '@ai-sdk/openai';
import { embed, embedMany } from 'ai';
import { ApiError } from './api';
import { getDb } from './db';
import { safeModelErrorMessage } from './model-errors';
import { resolveKey } from './settings';

// A single, fixed model/dimension pair keeps every stored vector comparable.
// Changing this model requires recomputing the corpus, never mixing spaces.
const MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
const TIMEOUT_MS = 60_000;

function changed(): ApiError {
  return new ApiError(409, 'source_changed', 'De bron is intussen vervangen. Vernieuw de bron en bereken de embeddings opnieuw.');
}

function validateVector(vector: number[]): void {
  if (
    vector.length !== EMBEDDING_DIMENSIONS ||
    vector.some((value) => !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) ||
    !vector.some((value) => Math.fround(value) !== 0)
  ) {
    throw new ApiError(502, 'model_failed', 'De aanbieder gaf onbruikbare embeddings terug. Probeer het opnieuw.');
  }
}

function encodeVector(vector: number[]): Buffer {
  validateVector(vector);
  const bytes = Buffer.alloc(vector.length * 4);
  vector.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes;
}

export function decodeEmbedding(vector: Buffer, dims: number): number[] | null {
  if (dims !== EMBEDDING_DIMENSIONS || vector.length !== dims * 4) return null;
  const values = Array.from({ length: dims }, (_, index) => vector.readFloatLE(index * 4));
  if (values.some((value) => !Number.isFinite(value)) || !values.some((value) => value !== 0)) return null;
  return values;
}

function configuration() {
  // Keep the credential actually used across awaits, even if settings change.
  const credential = resolveKey('openai')?.key;
  if (!credential?.trim()) {
    throw new ApiError(409, 'no_model_configured', 'Voeg onder Instellingen een OpenAI-sleutel toe om embeddings en hybride zoeken te gebruiken.');
  }
  return { credential };
}

function failure(error: unknown, credential: string): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(502, 'model_failed', `Embeddings berekenen is mislukt: ${safeModelErrorMessage(error, [credential])}`);
}

interface StoredPassage { id: string; text: string }

export async function embedSource(sourceId: string, expectedVersionId?: string): Promise<{ embedded: number }> {
  const db = getDb();
  const readSource = db.prepare<[string], { version_id: string | null; processing_status: string | null }>(`
    SELECT s.current_version_id AS version_id, v.processing_status
    FROM sources s LEFT JOIN source_versions v ON v.id = s.current_version_id AND v.source_id = s.id
    WHERE s.id = ?`);
  const readPassages = db.prepare<[string], StoredPassage>(
    'SELECT id, text FROM passages WHERE version_id = ? ORDER BY ordinal, id',
  );
  const snapshot = db.transaction(() => {
    const source = readSource.get(sourceId);
    if (!source) throw new ApiError(404, 'not_found', 'Bron niet gevonden.');
    if (expectedVersionId !== undefined && source.version_id !== expectedVersionId) throw changed();
    if (!source.version_id || source.processing_status !== 'ready') {
      throw new ApiError(409, 'source_not_ready', 'Deze bron heeft geen verwerkte huidige versie. Wacht op de verwerking of upload een leesbare PDF.');
    }
    const passages = readPassages.all(source.version_id);
    if (passages.length === 0 || passages.some((passage) => passage.text.trim() === '')) {
      throw new ApiError(409, 'source_not_ready', 'Deze bron bevat geen bruikbare passages. Upload een PDF met selecteerbare tekst.');
    }
    return { versionId: source.version_id, passages };
  })();
  const { credential } = configuration();
  let vectors: Buffer[];
  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const result = await embedMany({
      model: createOpenAI({ apiKey: credential }).embeddingModel(MODEL),
      values: snapshot.passages.map((passage) => passage.text),
      maxParallelCalls: 2,
      maxRetries: 0,
      abortSignal: signal,
    });
    signal.throwIfAborted();
    if (result.embeddings.length !== snapshot.passages.length) {
      throw new ApiError(502, 'model_failed', 'De aanbieder gaf niet voor alle passages een embedding terug. Probeer het opnieuw.');
    }
    vectors = result.embeddings.map(encodeVector);
  } catch (error) {
    throw failure(error, credential);
  }

  return db.transaction(() => {
    const current = readSource.get(sourceId);
    if (current?.version_id !== snapshot.versionId || current.processing_status !== 'ready') throw changed();
    const currentPassages = readPassages.all(snapshot.versionId);
    if (
      currentPassages.length !== snapshot.passages.length ||
      currentPassages.some((passage, index) => passage.id !== snapshot.passages[index].id || passage.text !== snapshot.passages[index].text)
    ) throw changed();
    const write = db.prepare(`
      INSERT INTO passage_embeddings (passage_id, dims, vector) VALUES (?, ?, ?)
      ON CONFLICT(passage_id) DO UPDATE SET dims = excluded.dims, vector = excluded.vector`);
    snapshot.passages.forEach((passage, index) => write.run(passage.id, EMBEDDING_DIMENSIONS, vectors[index]));
    return { embedded: snapshot.passages.length };
  }).immediate();
}

export async function embedQuery(question: string, callerSignal?: AbortSignal): Promise<number[]> {
  const { credential } = configuration();
  try {
    const deadline = AbortSignal.timeout(TIMEOUT_MS);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    signal.throwIfAborted();
    const result = await embed({
      model: createOpenAI({ apiKey: credential }).embeddingModel(MODEL),
      value: question,
      maxRetries: 0,
      abortSignal: signal,
    });
    signal.throwIfAborted();
    validateVector(result.embedding);
    return result.embedding;
  } catch (error) {
    throw failure(error, credential);
  }
}

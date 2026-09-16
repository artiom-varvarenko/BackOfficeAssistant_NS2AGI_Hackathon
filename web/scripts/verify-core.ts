/**
 * Repeatable integration checks: npm exec tsx scripts/verify-core.ts
 * Uses fresh temporary SQLite/PDF storage and fake credentials only. Provider
 * responses travel over a loopback HTTP server through the actual AI SDK.
 * No real provider requests, user database, or user PDF files are touched.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http, { type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Answer } from '../src/lib/types';

type Body = Record<string, unknown>;
type Fixture = { path: string; run: (body: Body, response: ServerResponse) => void | Promise<void> };
const fixtures: Fixture[] = [];
const fixtureErrors: unknown[] = [];
const requests: { path: string; body: Body }[] = [];
const fakeKey = 'fixture-only-do-not-send-to-any-provider';
const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'backoffice-verify-core-'));
const originalFetch = globalThis.fetch;
let passed = 0;

// Set this BEFORE importing any app module: storage paths are module constants.
process.env.STORAGE_DIR = storage;
for (const key of [
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY',
  'MISTRAL_API_KEY', 'AZURE_OPENAI_API_KEY', 'CUSTOM_LLM_API_KEY',
  'ELEVENLABS_API_KEY', 'CUSTOM_LLM_BASE_URL', 'AZURE_RESOURCE_NAME',
]) delete process.env[key];

const server = http.createServer(async (request, response) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Body;
    const requestPath = request.url ?? '';
    requests.push({ path: requestPath, body });
    const fixture = fixtures.shift();
    assert.ok(fixture, `Unexpected provider request to ${requestPath}`);
    assert.equal(requestPath, fixture.path);
    if (request.headers.authorization) assert.equal(request.headers.authorization, `Bearer ${fakeKey}`);
    await fixture.run(body, response);
  } catch (error) {
    fixtureErrors.push(error);
    if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Fixture assertion failed', type: 'invalid_request_error' } }));
  }
});

function json(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function providerFailure(status = 503) {
  return (_body: Body, response: ServerResponse) => json(response, {
    error: { message: `Fixture error with ${fakeKey}`, type: 'server_error' },
  }, status);
}

function vector(axis = 0) {
  return Array.from({ length: 1536 }, (_, index) => index === axis ? 1 : 0);
}

function embeddings(options: {
  before?: (body: Body) => void;
  values?: (index: number) => number[];
  reverseIndices?: boolean;
} = {}) {
  fixtures.push({ path: '/v1/embeddings', run: (body, response) => {
    options.before?.(body);
    assert.equal(body.model, 'text-embedding-3-small');
    assert.equal(body.dimensions, 1536);
    assert.ok(Array.isArray(body.input));
    assert.ok(body.input.length <= 64);
    const count = body.input.length;
    json(response, {
      object: 'list', model: 'text-embedding-3-small', usage: { prompt_tokens: count, total_tokens: count },
      data: body.input.map((_, index) => ({
        object: 'embedding', index: options.reverseIndices ? count - index - 1 : index,
        embedding: options.values?.(index) ?? vector(),
      })),
    });
  } });
}

function completion(text: string, response: ServerResponse) {
  json(response, {
    id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture-model',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 25, completion_tokens: 40, total_tokens: 65 },
  });
}

async function streamCompletion(text: string, response: ServerResponse, hold = false) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = (content: string | null, finish: string | null = null) => response.write(`data: ${JSON.stringify({
    id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
    choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  })}\n\n`);
  for (let offset = 0; offset < text.length; offset += 45) {
    if (response.destroyed) return;
    chunk(text.slice(offset, offset + 45));
    await delay(3);
  }
  if (hold) {
    if (!response.destroyed) await new Promise<void>((resolve) => response.once('close', resolve));
    return;
  }
  chunk(null, 'stop');
  response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 25, completion_tokens: 40, total_tokens: 65 } })}\n\n`);
  response.end('data: [DONE]\n\n');
}

function chat(text: string, streaming = false, inspect?: (body: Body) => void) {
  fixtures.push({ path: '/v1/chat/completions', run: async (body, response) => {
    assert.equal(body.stream === true, streaming);
    assert.equal(body.model, 'fixture-model');
    assert.equal(body.temperature, undefined);
    inspect?.(body);
    if (streaming) await streamCompletion(text, response);
    else completion(text, response);
  } });
}

async function check(name: string, run: () => void | Promise<void>) {
  await run();
  if (fixtureErrors.length) throw fixtureErrors[0];
  assert.equal(fixtures.length, 0, 'All queued HTTP fixtures must be consumed');
  passed++;
  console.log(`PASS ${name}`);
}

async function deadline<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Operation did not settle within ${ms} ms`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

// Minimal deterministic, genuinely parseable PDF fixture (not an extractor stub).
function pdf(label: string): Buffer {
  const lines = Array.from({ length: 12 }, (_, index) =>
    `${label} passage ${index + 1}: een vergunning voor de markt is verplicht. De gemeente controleert elke aanvraag zorgvuldig.`);
  const stream = `BT /F1 10 Tf 30 780 Td 16 TL ${lines.map((line, index) =>
    `${index ? 'T* ' : ''}(${line.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let data = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(data));
    data += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(data);
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) data += `${String(offset).padStart(10, '0')} 00000 n \n`;
  data += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(data);
}

async function main() {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/embeddings') {
      return originalFetch(`${origin}${url.pathname}`, init);
    }
    assert.equal(url.origin, origin, `External network is forbidden in verify-core: ${url.origin}`);
    return originalFetch(input, init);
  };

  const { getDb, DB_PATH, pdfPathForVersion } = await import('../src/lib/db');
  const { embedSource, EMBEDDING_DIMS, readEmbedding } = await import('../src/lib/embeddings');
  const { retrievePassages, searchPassages } = await import('../src/lib/retrieve');
  const { setSetting } = await import('../src/lib/settings');
  const { createSource, addVersion } = await import('../src/lib/ingest');
  const { generateAnswer, prepareAnswer, streamAnswer } = await import('../src/lib/answer');
  const { getAnswer, getSource } = await import('../src/lib/dto');
  const { NextRequest } = await import('next/server');
  const { POST: postStream } = await import('../src/app/api/answers/stream/route');
  const db = getDb();
  assert.equal(DB_PATH, path.join(storage, 'app.db'));
  const now = new Date().toISOString();
  const count = (table: 'answers' | 'answer_citations' | 'answer_events' | 'answers_fts' | 'passage_embeddings') =>
    db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
  const storedCounts = () => ['answers', 'answer_citations', 'answer_events', 'answers_fts'].map((table) =>
    count(table as Parameters<typeof count>[0]));
  const hasCode = (code: string) => (error: unknown) => {
    assert.ok(error && typeof error === 'object' && 'code' in error);
    assert.equal(error.code, code);
    assert.ok(!String(error).includes(fakeKey), 'Error must redact the captured credential');
    return true;
  };

  function addFixtureVersion(sourceId: string, versionNo: number, texts: string[]) {
    const versionId = randomUUID();
    db.prepare(`INSERT INTO source_versions (id,source_id,version_no,file_name,file_path,sha256,processing_status,created_at)
      VALUES (?,?,?,'fixture.pdf',?,'fixture','ready',?)`).run(versionId, sourceId, versionNo, pdfPathForVersion(versionId), now);
    const passageIds = texts.map((text, index) => {
      const id = randomUUID();
      db.prepare('INSERT INTO passages (id,version_id,ordinal,page_start,page_end,text) VALUES (?,?,?,1,1,?)')
        .run(id, versionId, index + 1, text);
      db.prepare('INSERT INTO passages_fts (text,passage_id) VALUES (?,?)').run(text, id);
      return id;
    });
    db.prepare('UPDATE sources SET current_version_id = ? WHERE id = ?').run(versionId, sourceId);
    return { sourceId, versionId, passageIds };
  }

  function corpus(title: string, texts: string[]) {
    const id = randomUUID();
    db.prepare(`INSERT INTO sources (id,title,level,doc_type,created_at,updated_at)
      VALUES (?,?,'municipal','bylaw',?,?)`).run(id, title, now, now);
    return addFixtureVersion(id, 1, texts);
  }

  const versionMeta = { fileName: 'fixture.pdf', documentDate: null, versionLabel: null, validFrom: null, validUntil: null };
  let ingested: Awaited<ReturnType<typeof createSource>>;
  await check('real PDF ingestion, immutable old evidence, failed replacement, out-of-order completion', async () => {
    const bytes = pdf('Eerste');
    ingested = await createSource(bytes, {
      title: 'Ingestion fixture', authority: null, level: 'municipal', docType: 'bylaw', scope: null, originalUrl: null,
    }, { ...versionMeta, applicability: 'unverified' });
    assert.equal(ingested.pageCount, 1);
    assert.ok(ingested.passageCount > 0);
    assert.deepEqual(fs.readFileSync(pdfPathForVersion(ingested.versionId)), bytes);
    const originalText = db.prepare('SELECT text FROM passages WHERE version_id = ?').all(ingested.versionId);
    const sha = db.prepare<[string], { sha256: string }>('SELECT sha256 FROM source_versions WHERE id = ?').get(ingested.versionId)!.sha256;
    assert.equal(sha, createHash('sha256').update(bytes).digest('hex'));

    const replacement = await addVersion(pdf('Tweede'), ingested.sourceId, versionMeta);
    assert.equal(getSource(ingested.sourceId)!.currentVersion!.id, replacement.versionId);
    assert.equal(getSource(ingested.sourceId)!.versions.find((v) => v.id === ingested.versionId)!.applicability, 'superseded');
    await assert.rejects(addVersion(Buffer.from('%PDF-1.4\ncorrupt'), ingested.sourceId, versionMeta), hasCode('unreadable_pdf'));
    assert.equal(getSource(ingested.sourceId)!.currentVersion!.id, replacement.versionId);
    assert.equal(getSource(ingested.sourceId)!.versions[0].processingStatus, 'failed');

    const olderUpload = addVersion(pdf('Oudere gelijktijdige'), ingested.sourceId, versionMeta);
    // Model a newer upload which has already completed while this real PDF is
    // still awaiting extraction. This makes completion ordering deterministic.
    const pending = db.prepare<[string], { version_no: number }>(
      "SELECT version_no FROM source_versions WHERE source_id = ? AND processing_status = 'processing'").get(ingested.sourceId)!;
    assert.ok(pending);
    const newer = addFixtureVersion(ingested.sourceId, pending.version_no + 1, ['Nieuwste geldende tekst.']);
    const older = await olderUpload;
    const source = getSource(ingested.sourceId)!;
    assert.equal(source.currentVersion!.id, newer.versionId);
    assert.equal(source.versions.find((v) => v.id === older.versionId)!.applicability, 'superseded');
    assert.deepEqual(db.prepare('SELECT text FROM passages WHERE version_id = ?').all(ingested.versionId), originalText);
  });

  setSetting('key.openai', fakeKey);
  const indexed = corpus('Embeddings fixture', Array.from({ length: 65 }, (_, index) => `Vergunning passage ${index}.`));
  await check('embeddings batch at 64, store compatible vectors, and reuse without HTTP', async () => {
    embeddings({ before: (body) => assert.equal((body.input as unknown[]).length, 64) });
    embeddings({ before: (body) => assert.equal((body.input as unknown[]).length, 1) });
    assert.equal(await embedSource(indexed.sourceId), 65);
    assert.equal(count('passage_embeddings'), 65);
    const calls = requests.length;
    assert.equal(await embedSource(indexed.sourceId), 65);
    assert.equal(requests.length, calls);
    const row = db.prepare('SELECT dims,vector FROM passage_embeddings WHERE passage_id = ?').get(indexed.passageIds[0]) as { dims: number; vector: Buffer };
    assert.ok(readEmbedding(row.dims, row.vector));
    assert.equal(readEmbedding(EMBEDDING_DIMS, Buffer.alloc(EMBEDDING_DIMS * 4)), null);
    assert.equal(readEmbedding(3, row.vector), null);
    const unaligned = Buffer.concat([Buffer.from([1]), row.vector]).subarray(1);
    assert.ok(readEmbedding(EMBEDDING_DIMS, unaligned));
  });

  await check('corrupt vectors repair; malformed response indices and zero vectors write nothing', async () => {
    db.prepare('UPDATE passage_embeddings SET vector = ? WHERE passage_id = ?').run(Buffer.alloc(4), indexed.passageIds[0]);
    embeddings({ before: (body) => assert.equal((body.input as unknown[]).length, 1) });
    assert.equal(await embedSource(indexed.sourceId), 65);
    const malformed = corpus('Malformed embeddings', ['Een', 'Twee']);
    const before = count('passage_embeddings');
    embeddings({ reverseIndices: true });
    await assert.rejects(embedSource(malformed.sourceId), hasCode('model_failed'));
    embeddings({ values: (index) => index === 1 ? Array(1536).fill(0) : vector() });
    await assert.rejects(embedSource(malformed.sourceId), hasCode('model_failed'));
    assert.equal(count('passage_embeddings'), before);
  });

  await check('embedding retry budget spans batches and failed batches leave no partial vectors', async () => {
    const target = corpus('Embedding retry', Array.from({ length: 65 }, (_, index) => `Retry passage ${index}`));
    const before = count('passage_embeddings');
    const calls = requests.length;
    fixtures.push({ path: '/v1/embeddings', run: providerFailure() });
    embeddings();
    fixtures.push({ path: '/v1/embeddings', run: providerFailure() });
    await assert.rejects(embedSource(target.sourceId), hasCode('model_failed'));
    assert.equal(requests.length - calls, 3);
    assert.equal(count('passage_embeddings'), before);
  });

  await check('embedding completion refuses stale source versions', async () => {
    const target = corpus('Embedding race', ['Oude passage']);
    const before = count('passage_embeddings');
    embeddings({ before: () => { addFixtureVersion(target.sourceId, 2, ['Nieuwe passage']); } });
    await assert.rejects(embedSource(target.sourceId), hasCode('source_changed'));
    await assert.rejects(embedSource(target.sourceId, target.versionId), hasCode('source_changed'));
    assert.equal(count('passage_embeddings'), before);
  });

  const evidence = 'Een vergunning voor de markt is verplicht. De aanvraag wordt door de gemeente beoordeeld.';
  const answerSource = corpus('Answer evidence', [evidence, 'Het terras heeft een afzonderlijke toelating nodig.']);
  await check('hybrid requires complete scoped coverage; BM25 remains model-free', async () => {
    setSetting('retrieval.mode', 'hybrid');
    const calls = requests.length;
    await assert.rejects(retrievePassages('markt', { sourceIds: [answerSource.sourceId] }), hasCode('embeddings_required'));
    assert.equal(requests.length, calls);
    embeddings({ values: (index) => vector(index) });
    await embedSource(answerSource.sourceId);
    db.prepare('UPDATE passage_embeddings SET vector = ? WHERE passage_id = ?').run(Buffer.alloc(4), answerSource.passageIds[1]);
    await assert.rejects(retrievePassages('markt', { sourceIds: [answerSource.sourceId] }), hasCode('embeddings_incomplete'));
    embeddings({ values: () => vector(1) });
    await embedSource(answerSource.sourceId);
    const priorSearch = requests.length;
    const hits = searchPassages('markt', { sourceIds: [answerSource.sourceId] });
    assert.equal(hits[0].passage.id, answerSource.passageIds[0]);
    assert.equal(requests.length, priorSearch);
    assert.deepEqual((await retrievePassages('markt', { sourceIds: [] })).passages, []);
    embeddings({ values: () => vector(1) });
    const semantic = await retrievePassages('onbekend zoekwoord', { sourceIds: [answerSource.sourceId], maxPassages: 1 });
    assert.equal(semantic.passages[0].id, answerSource.passageIds[1]);
    assert.equal(semantic.ftsHits, 0);
    assert.ok(semantic.passages[0].score > 0);
  });

  await check('hybrid detects source disable during remote query; BM25 excludes old/disabled passages', async () => {
    embeddings({ before: () => { db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(answerSource.sourceId); } });
    await assert.rejects(retrievePassages('markt', { sourceIds: [answerSource.sourceId] }), hasCode('source_changed'));
    assert.deepEqual(searchPassages('markt', { sourceIds: [answerSource.sourceId] }), []);
    db.prepare('UPDATE sources SET enabled=1 WHERE id=?').run(answerSource.sourceId);
    setSetting('retrieval.mode', 'bm25');
    const scoped = await retrievePassages('passage', { sourceIds: [ingested.sourceId] });
    assert.ok(scoped.passages.every((p) => p.versionId === getSource(ingested.sourceId)!.currentVersion!.id));
  });

  setSetting('key.openai', null);
  setSetting('key.custom', fakeKey);
  setSetting('custom.baseUrl', `${origin}/v1`);
  setSetting('task.answer', JSON.stringify({ provider: 'custom', model: 'fixture-model', effort: null }));
  const input = { question: 'Is een vergunning voor de markt verplicht?', sourceIds: [answerSource.sourceId] };
  const output = {
    antwoord: 'Een vergunning voor de markt is verplicht [1, 99]. Dit is een aanvullende concrete bewering zonder ondersteunend bewijs.',
    kan_beantwoorden: 'ja',
    citaten: [
      { nummer: 1, passage: 'P1', letterlijk_fragment: 'Een vergunning voor de markt is verplicht.' },
      { nummer: 99, passage: 'P999', letterlijk_fragment: 'Onbestaande passage' },
    ],
    ontbrekende_informatie: [], waarschuwingen: [], tegenstrijdigheden: [],
  };
  let generated: Answer;
  await check('JSON generation validates citations and stores exact immutable evidence/audit metadata atomically', async () => {
    chat(JSON.stringify(output));
    const before = storedCounts();
    generated = await generateAnswer(input);
    assert.equal(generated.status, 'draft');
    assert.equal(generated.canAnswer, 'ja');
    assert.equal(generated.citations.length, 1);
    assert.equal(generated.citations[0].quoteText, evidence);
    assert.equal(generated.citations[0].highlight, output.citaten[0].letterlijk_fragment);
    assert.ok(!generated.generatedAnswer.includes('[99]'));
    assert.equal(generated.uncitedSentences, 1);
    assert.ok(generated.warnings.some((warning) => warning.includes('onbekende passage')));
    assert.ok(generated.warnings.some((warning) => warning.includes('niet geverifieerd')));
    assert.deepEqual(storedCounts().map((value, index) => value - before[index]), [1, 1, 1, 1]);
    assert.deepEqual(generated.scopeSourceIds, input.sourceIds);
    assert.ok(generated.promptSnapshot?.includes(evidence));
    assert.equal(generated.provider, 'custom');
    const row = db.prepare<[string], { raw_response: string; usage_json: string }>(
      'SELECT raw_response,usage_json FROM answers WHERE id=?').get(generated.id)!;
    assert.equal(row.raw_response, JSON.stringify(output));
    assert.ok(JSON.parse(row.usage_json));
  });

  await check('streamed answer shares validated final output and never stores provisional snapshots', async () => {
    const before = count('answers');
    const snapshots: string[] = [];
    chat(JSON.stringify(output), true);
    const streamed = await streamAnswer(await prepareAnswer(input), (text) => {
      assert.equal(count('answers'), before);
      snapshots.push(text);
    });
    assert.ok(snapshots.some((text) => text.includes('vergunning')));
    assert.equal(streamed.generatedAnswer, generated.generatedAnswer);
    assert.deepEqual(streamed.warnings, generated.warnings);
    assert.deepEqual(streamed.citations, generated.citations);
    assert.equal(count('answers'), before + 1);
  });

  await check('stream JSON fallback clears failed partials and stores final-attempt prompt/raw only', async () => {
    const snapshots: string[] = [];
    const before = count('answers');
    chat('{"antwoord":"Mislukte voorlopige tekst"}', true);
    chat(JSON.stringify(output), true, (body) => {
      assert.equal((body.response_format as { type: string }).type, 'json_object');
      assert.ok(JSON.stringify(body.messages).includes('Geef uitsluitend een geldig JSON-object'));
    });
    const answer = await streamAnswer(await prepareAnswer(input), (text) => snapshots.push(text));
    assert.ok(snapshots.some((text) => text.includes('Mislukte')));
    assert.ok(snapshots.includes(''), 'Retry clears the previous replacement snapshot');
    assert.equal(count('answers'), before + 1);
    assert.ok(answer.promptSnapshot?.includes('Geef uitsluitend een geldig JSON-object'));
    assert.ok(!answer.generatedAnswer.includes('Mislukte'));
  });

  await check('JSON validation and transport failures share one retry; no partial answer survives failure', async () => {
    const before = storedCounts();
    const calls = requests.length;
    chat('{"antwoord":"incomplete"}');
    fixtures.push({ path: '/v1/chat/completions', run: providerFailure() });
    await assert.rejects(generateAnswer(input), hasCode('model_failed'));
    assert.equal(requests.length - calls, 2);
    assert.deepEqual(storedCounts(), before);
  });

  await check('transport retry succeeds once and regenerated answer links both audit histories', async () => {
    const before = storedCounts();
    fixtures.push({ path: '/v1/chat/completions', run: providerFailure() });
    chat(JSON.stringify(output));
    const answer = await generateAnswer({ ...input, regeneratedFromId: generated.id });
    assert.equal(answer.regeneratedFromId, generated.id);
    assert.ok(getAnswer(generated.id)!.events.some((event) => event.type === 'regenerated' && event.detail === answer.id));
    assert.deepEqual(storedCounts().map((value, index) => value - before[index]), [1, 1, 2, 1]);
  });

  await check('cancellation aborts an in-flight SDK stream and leaves every answer table unchanged', async () => {
    const before = storedCounts();
    const cancellation = new AbortController();
    fixtures.push({ path: '/v1/chat/completions', run: async (_body, response) => {
      await streamCompletion('{"antwoord":"Voorlopig antwoord zonder voltooiing', response, true);
    } });
    const pending = streamAnswer(await prepareAnswer(input, cancellation.signal), () => cancellation.abort());
    await assert.rejects(deadline(pending), hasCode('model_failed'));
    assert.deepEqual(storedCounts(), before);
  });

  await check('SSE route emits one persisted final DTO; errors remain SSE errors without saved answers', async () => {
    const request = () => new NextRequest('http://localhost/api/answers/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    chat(JSON.stringify(output), true);
    const response = await postStream(request());
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.startsWith('text/event-stream'));
    const body = await deadline(response.text());
    const finals = body.split('\n\n').filter((event) => event.startsWith('event: final\n'));
    assert.equal(finals.length, 1);
    const final = JSON.parse(finals[0].split('\ndata: ')[1]) as Answer;
    assert.equal(getAnswer(final.id)!.generatedAnswer, generated.generatedAnswer);
    const before = storedCounts();
    fixtures.push({ path: '/v1/chat/completions', run: providerFailure(401) });
    const failed = await postStream(request());
    const errorBody = await deadline(failed.text());
    assert.ok(errorBody.includes('event: error\n'));
    assert.ok(!errorBody.includes('event: final\n'));
    assert.ok(!errorBody.includes(fakeKey));
    assert.deepEqual(storedCounts(), before);
    const invalid = await postStream(new NextRequest('http://localhost/api/answers/stream', {
      method: 'POST', body: JSON.stringify({ ...input, sourceIds: [] }),
    }));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'invalid_scope');
  });

  await check('SSE reader disconnect cancels provider stream without persistence', async () => {
    const before = storedCounts();
    let markClosed: () => void = () => undefined;
    const providerClosed = new Promise<void>((resolve) => { markClosed = resolve; });
    fixtures.push({ path: '/v1/chat/completions', run: async (_body, response) => {
      response.once('close', markClosed);
      await streamCompletion('{"antwoord":"Dit is een voorlopig antwoord dat nog niet compleet is', response, true);
    } });
    const response = await postStream(new NextRequest('http://localhost/api/answers/stream', {
      method: 'POST', body: JSON.stringify(input),
    }));
    const reader = response.body!.getReader();
    assert.equal((await deadline(reader.read())).done, false);
    await deadline(reader.cancel());
    await deadline(providerClosed);
    assert.deepEqual(storedCounts(), before);
  });

  await check('blank validated model answers cannot be saved through JSON or streaming', async () => {
    const before = storedCounts();
    for (const text of ['   ', '[99]', '[1]']) {
      const blank = JSON.stringify({ ...output, antwoord: text, citaten: text === '[1]' ? [output.citaten[0]] : [] });
      chat(blank);
      await assert.rejects(generateAnswer(input), hasCode('model_failed'));
      chat(blank, true);
      await assert.rejects(streamAnswer(await prepareAnswer(input), () => undefined), hasCode('model_failed'));
    }
    assert.deepEqual(storedCounts(), before);
  });

  await check('saved citations survive a new source version and source disable', () => {
    const snapshot = generated.citations[0];
    addFixtureVersion(answerSource.sourceId, 2, ['De nieuwe versie bevat andere voorschriften.']);
    db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(answerSource.sourceId);
    const saved = getAnswer(generated.id)!;
    assert.equal(saved.citations[0].quoteText, snapshot.quoteText);
    assert.equal(saved.citations[0].versionId, snapshot.versionId);
    assert.equal(saved.citations[0].isCurrentVersion, false);
    assert.equal(saved.citations[0].sourceEnabled, false);
    assert.equal(saved.sourcesChangedSince, true);
  });
  console.log(`Verified ${passed} core integration groups using ${requests.length} local HTTP provider requests.`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  globalThis.__economieAssistentDb?.close();
  globalThis.__economieAssistentDb = undefined;
  // This exact directory was created by mkdtemp above; never remove a user path.
  assert.equal(path.dirname(storage), os.tmpdir());
  assert.ok(path.basename(storage).startsWith('backoffice-verify-core-'));
  fs.rmSync(storage, { recursive: true, force: true });
});

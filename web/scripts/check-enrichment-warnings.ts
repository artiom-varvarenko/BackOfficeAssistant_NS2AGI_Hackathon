// Focused integration regression, with an isolated database and local SDK
// protocol fixture. This does not establish real-model summary quality.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-enrichment-check-'));
  process.env.STORAGE_DIR = temporary;
  let responseText = 'Dit document regelt de markt. Het is bedoeld voor markthandelaars. De datum is onbekend.';
  let calls = 0;
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) { void chunk; /* Drain the SDK request. */ }
    calls++;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      id: 'local-protocol-check', object: 'chat.completion', created: 0, model: 'protocol-check',
      choices: [{ index: 0, message: { role: 'assistant', content: responseText }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { getDb } = await import('../src/lib/db');
  const { setSetting } = await import('../src/lib/settings');
  const { summarizeSource } = await import('../src/lib/summary');
  const { embedSource, EMBEDDING_DIMS } = await import('../src/lib/embeddings');
  const { clearEnrichmentWarning, ENRICHMENT_WARNINGS } = await import('../src/lib/enrichment-warnings');
  const db = getDb();
  try {
    const address = server.address();
    assert(address && typeof address !== 'string');
    setSetting('task.summary', JSON.stringify({ provider: 'custom', model: 'protocol-check', effort: null }));
    setSetting('custom.baseUrl', `http://127.0.0.1:${address.port}/v1`);
    setSetting('key.openai', 'local-test-placeholder');
    const at = '2026-09-16T12:00:00.000Z';
    const extraction = "2 van 3 pagina's bevatten geen leesbare tekst";
    const notices = `${extraction} ${ENRICHMENT_WARNINGS.summary} ${ENRICHMENT_WARNINGS.embeddings}`;
    db.prepare(`INSERT INTO sources (id, title, level, doc_type, current_version_id, created_at, updated_at)
      VALUES ('source', 'Testbron', 'municipal', 'bylaw', 'version', ?, ?)`).run(at, at);
    db.prepare(`INSERT INTO source_versions (id, source_id, version_no, file_name, file_path, sha256,
      page_count, processing_status, extraction_warning, created_at)
      VALUES ('version', 'source', 1, 'test.pdf', 'unused.pdf', 'local', 3, 'ready', ?, ?)`).run(notices, at);
    db.prepare(`INSERT INTO passages (id, version_id, ordinal, page_start, page_end, text)
      VALUES ('passage', 'version', 1, 1, 1, 'Dit document bevat marktregels voor markthandelaars.')`).run();
    const warning = () => (db.prepare("SELECT extraction_warning AS warning FROM source_versions WHERE id = 'version'").get() as { warning: string | null }).warning;
    const setWarning = (value: string | null) => db.prepare("UPDATE source_versions SET extraction_warning = ? WHERE id = 'version'").run(value);

    const summary = await summarizeSource('source');
    assert.equal(summary.summary, responseText);
    assert.equal(summary.currentVersion?.extractionWarning, `${extraction} ${ENRICHMENT_WARNINGS.embeddings}`);
    assert.equal(warning(), `${extraction} ${ENRICHMENT_WARNINGS.embeddings}`);

    // Already-valid vectors are still a successful retry and require no API call.
    const vector = Buffer.alloc(EMBEDDING_DIMS * 4);
    vector.writeFloatLE(1, 0);
    db.prepare("INSERT INTO passage_embeddings (passage_id, dims, vector) VALUES ('passage', ?, ?)").run(EMBEDDING_DIMS, vector);
    assert.equal(await embedSource('source'), 1);
    assert.equal(warning(), extraction);
    assert.equal(calls, 1);

    // Failed retries must retain the notice and previously successful summary.
    setWarning(ENRICHMENT_WARNINGS.summary);
    responseText = '   ';
    await assert.rejects(summarizeSource('source'), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'model_failed'));
    assert.equal(warning(), ENRICHMENT_WARNINGS.summary);

    // Removing the final optional warning represents no warning as SQL NULL.
    responseText = 'De bron beschrijft marktregels. De regels zijn voor handelaars. Een datum ontbreekt.';
    const retried = await summarizeSource('source');
    assert.equal(retried.currentVersion?.extractionWarning, null);

    // Event failure rolls back both the summary write and warning clearance.
    setWarning(`${extraction} ${ENRICHMENT_WARNINGS.summary}`);
    db.exec("CREATE TEMP TRIGGER reject_summary_event BEFORE INSERT ON source_events BEGIN SELECT RAISE(ABORT, 'event failure'); END");
    const previousSummary = retried.summary;
    responseText = 'Andere eerste zin. Andere tweede zin. Andere derde zin.';
    await assert.rejects(summarizeSource('source'), /event failure/);
    assert.equal(warning(), `${extraction} ${ENRICHMENT_WARNINGS.summary}`);
    assert.equal((db.prepare("SELECT summary FROM sources WHERE id = 'source'").get() as { summary: string }).summary, previousSummary);
    db.exec('DROP TRIGGER reject_summary_event');

    // An unrelated notice and an unknown version stay untouched.
    db.transaction(() => {
      clearEnrichmentWarning('version', 'embeddings', db);
      clearEnrichmentWarning('missing', 'summary', db);
    })();
    assert.equal(warning(), `${extraction} ${ENRICHMENT_WARNINGS.summary}`);
    console.log('PASS: successful summary/reused embeddings clear only their warning; extraction warnings survive; failed retries and event rollback preserve state.');
  } finally {
    db.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const resolved = path.resolve(temporary);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert(path.basename(resolved).startsWith('ea-enrichment-check-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

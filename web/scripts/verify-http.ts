// Production HTTP integration checks. All writes use a disposable database and
// an explicit local SDK protocol fixture, never normal storage or real keys.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Answer, Source } from '../src/lib/types';

async function main() {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-http-'));
  const env = { ...process.env, STORAGE_DIR: storage, APP_PASSWORD: 'verification-workspace',
    APP_SESSION_SECRET: '0123456789abcdef-fedcba9876543210-verify', APP_TRUST_PROXY: 'local',
    APP_STREAMING: 'on', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', GOOGLE_GENERATIVE_AI_API_KEY: '',
    MISTRAL_API_KEY: '', AZURE_OPENAI_API_KEY: '', ELEVENLABS_API_KEY: '', CUSTOM_LLM_API_KEY: '',
    CUSTOM_LLM_BASE_URL: '', OPENAI_BASE_URL: '', NEXT_TELEMETRY_DISABLED: '1' };
  const fixture = http.createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const prompt: string = body.messages.map((message: { content: string }) => message.content).join('\n');
      const passages = Array.from(prompt.matchAll(/\[(P\d+)\][^\n]*\n<<<\n([\s\S]*?)\n>>>/g)).slice(0, 3);
      const result = passages.length ? JSON.stringify({
        kan_beantwoorden: 'gedeeltelijk',
        antwoord: passages.map((_, index) => `Controleer deze bronpassage bij uw aanvraag [${index + 1}].`).join('\n\n'),
        citaten: passages.map((match, index) => ({ nummer: index + 1, passage: match[1], letterlijk_fragment: match[2].slice(0, 100) })),
        ontbrekende_informatie: ['Protocolcontrole: geen echte modelbeoordeling.'], waarschuwingen: [], tegenstrijdigheden: [],
      }) : prompt.includes('precies drie') ? 'Dit document bevat regels. Het is bedoeld voor ondernemers. De status moet worden gecontroleerd.'
        : body.response_format ? JSON.stringify({ ok: true })
          : 'Beste\n\nControleer de aangehaalde bronpassages bij uw aanvraag.\n\nMet vriendelijke groeten,\ndienst lokale economie';
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (let offset = 0; offset < result.length; offset += 50) {
          if (res.destroyed) return;
          res.write(`data: ${JSON.stringify({ id: 'protocol', object: 'chat.completion.chunk', created: 1, model: 'protocol-fixture', choices: [{ index: 0, delta: { content: result.slice(offset, offset + 50) }, finish_reason: null }] })}\n\n`);
          await delay(30);
        }
        res.end(`data: ${JSON.stringify({ id: 'protocol', object: 'chat.completion.chunk', created: 1, model: 'protocol-fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'protocol', object: 'chat.completion', created: 1, model: 'protocol-fixture', choices: [{ index: 0, message: { role: 'assistant', content: result }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
      }
    } catch { res.writeHead(500).end(); }
  });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const fixturePort = (fixture.address() as { port: number }).port;
  env.OPENAI_BASE_URL = `http://127.0.0.1:${fixturePort}/v1`;
  const port = Number(process.env.VERIFY_HTTP_PORT || 3100);
  const base = `http://127.0.0.1:${port}`;
  let server: ChildProcess | undefined;
  let output = '';
  let checks = 0;
  const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); };
  async function start(mode: string) {
    output = '';
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], {
      cwd: process.cwd(), env: { ...env, APP_TRUST_PROXY: mode }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', (chunk) => { output += chunk; });
    server.stderr?.on('data', (chunk) => { output += chunk; });
    for (let retry = 0; retry < 100; retry++) {
      if (server.exitCode !== null) throw new Error(`Server exited: ${output}`);
      try { if (output.includes('Ready in') && (await fetch(`${base}/login`)).status === 200) return; } catch { /* starting */ }
      await delay(200);
    }
    throw new Error(`Server startup timeout: ${output}`);
  }
  async function stop() {
    if (server && server.exitCode === null) { server.kill(); await once(server, 'exit'); }
  }
  let cookie = '';
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function call(route: string, init: RequestInit = {}, client = '192.0.2.10') {
    return fetch(base + route, { ...init, redirect: 'manual', headers: { Cookie: cookie, 'CF-Connecting-IP': client, 'X-Forwarded-Proto': 'http', ...Object.fromEntries(new Headers(init.headers)) } });
  }
  async function value<T>(route: string, init: RequestInit = {}, client?: string): Promise<T> {
    const response = await call(route, init, client);
    const text = await response.text();
    assert.ok(response.ok, `${route}: ${response.status} ${text}`);
    return JSON.parse(text) as T;
  }
  try {
    const seeded = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/seed.ts'], { env, encoding: 'utf8', windowsHide: true });
    assert.equal(seeded.status, 0, seeded.stdout + seeded.stderr);
    await start('local');
    const home = await call('/');
    check(home.status === 307, `pages redirect to login (HTTP ${home.status}: ${home.status === 307 ? '' : (await home.text()).slice(0, 200)})`);
    check((await call('/api/sources')).status === 401, 'APIs require a session');
    check((await call('/api/files/unknown')).status === 401, 'PDFs require a session');
    check((await call('/api/login', { ...json('POST', { password: env.APP_PASSWORD }), headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' } })).status === 403, 'cross-origin login rejected');
    check((await call('/api/login', json('POST', { password: 'wrong' }))).status === 401, 'wrong password rejected');
    const login = await call('/api/login', json('POST', { password: env.APP_PASSWORD }));
    const setCookie = login.headers.get('set-cookie') || '';
    cookie = setCookie.split(';')[0];
    check(login.status === 204 && /HttpOnly/i.test(setCookie) && /SameSite=strict/i.test(setCookie), 'signed HttpOnly Strict session');
    check((await call('/api/sources', { headers: { Cookie: cookie + 'tamper' } })).status === 401, 'tampered session rejected');
    const spoofedHostStatus = await new Promise<number>((resolve, reject) => {
      // Node fetch normalizes Host; use the wire-level client for this boundary.
      const request = http.request(`${base}/api/sources`, { headers: { Host: 'attacker.invalid', Cookie: cookie,
        'CF-Connecting-IP': '192.0.2.99', 'X-Forwarded-Host': 'localhost' } }, (response) => {
        response.resume(); response.on('end', () => resolve(response.statusCode!));
      });
      request.on('error', reject); request.end();
    });
    check(spoofedHostStatus === 403, 'local host boundary resists forwarding spoof');
    for (let index = 0; index < 10; index++) check((await call('/api/answers', json('POST', {}), `198.51.100.${index + 1}`)).status === 400, `local model budget request ${index + 1}`);
    const limited = await call('/api/answers', json('POST', {}));
    check(limited.status === 429 && Number(limited.headers.get('retry-after')) > 0, 'eleventh request rate limited despite spoofed IPs');
    await stop();
    await start('cloudflare');
    check((await call('/api/sources')).status === 200, 'session persists across restart');
    check((await call('/api/sources', { headers: { 'CF-Connecting-IP': 'not-an-ip' } })).status === 400, 'invalid trusted-proxy header rejected');
    const sources = await value<Source[]>('/api/sources');
    check(sources.length === 9 && sources.every((source) => source.currentVersion?.processingStatus === 'ready'), 'nine real PDFs seeded ready');
    const market = sources.find((source) => source.title === 'Bijzonder politiereglement voor de openbare markt')!;
    assert.ok(market);
    const hits = await value<Array<{ passage: { article: string } }>>('/api/search?q=loting');
    check(hits.some((hit) => hit.passage.article?.includes('12')), 'direct search finds Article 12');
    const filePath = `/api/files/${market.currentVersion!.id}`;
    const full = await call(filePath); const bytes = new Uint8Array(await full.arrayBuffer());
    check(full.status === 200 && new TextDecoder().decode(bytes.slice(0, 4)) === '%PDF', 'stored PDF bytes');
    for (const [range, start, end] of [['bytes=0-15', 0, 15], ['bytes=-20', bytes.length - 20, bytes.length - 1], [`bytes=${bytes.length - 10}-`, bytes.length - 10, bytes.length - 1]] as const) {
      const part = await call(filePath, { headers: { Range: range } });
      check(part.status === 206 && part.headers.get('content-range') === `bytes ${start}-${end}/${bytes.length}` && Buffer.from(await part.arrayBuffer()).equals(Buffer.from(bytes.slice(start, end + 1))), `PDF range ${range}`);
    }
    check((await call(filePath, { headers: { Range: `bytes=${bytes.length}-` } })).status === 416, 'unsatisfiable PDF range rejected');
    check((await call('/api/answers', json('POST', { question: 'markt', sourceIds: [] }))).status === 400, 'explicit empty scope rejected');
    check((await call('/api/answers/stream', json('POST', { question: 'markt' }))).status === 409, 'missing model fails before stream starts');
    check((await value<Answer[]>('/api/answers')).length === 0, 'failed generations create no history');
    const model = { provider: 'custom', model: 'protocol-fixture', effort: null };
    await value('/api/settings', json('PUT', { tasks: { answer: model, draft: model, summary: model }, custom: { baseUrl: `http://127.0.0.1:${fixturePort}/v1` } }));
    const tested = await value<{ ok: boolean }>('/api/settings/test', json('POST', { task: 'answer' }));
    const testedSettings = await value<{ testedConfiguration: string }>('/api/settings');
    check(tested.ok && testedSettings.testedConfiguration.startsWith('custom/protocol-fixture'), 'model connection label records an actual successful test');
    const answer = await value<Answer>('/api/answers', json('POST', { question: 'vaste standplaats aanvraag markt', sourceIds: [market.id] }));
    check(answer.citations.length === 3 && answer.citations.every((citation) => citation.sourceId === market.id), 'JSON generation persists scoped validated citations');
    const streamed = await call('/api/answers/stream', json('POST', { question: 'markt loting' }));
    const stream = await streamed.text();
    check(streamed.status === 200 && stream.includes('event: partial') && stream.includes('event: final') && !stream.includes('event: error'), 'actual HTTP SSE partial and final events');
    for (const citation of answer.citations.slice(0, 2)) await value(`/api/answers/${answer.id}/citations/${citation.marker}`, json('PATCH', { checked: true }));
    const reviewed = await value<Answer>(`/api/answers/${answer.id}`, json('PATCH', { reviewedAnswer: 'Door medewerker gecontroleerd [1].', status: 'approved' }));
    check(reviewed.status === 'approved' && reviewed.generatedAnswer === answer.generatedAnswer && reviewed.citations.filter((citation) => citation.checked).length === 2, 'review and two citation checks persist without changing original');
    const edited = await value<Answer>(`/api/answers/${answer.id}`, json('PATCH', { reviewedAnswer: 'Gewijzigd na goedkeuring [1].', status: 'approved' }));
    check(edited.status === 'draft', 'editing approved text returns to draft');
    const drafted = await value<Answer>(`/api/answers/${answer.id}/email-draft`, json('POST', {}));
    check(drafted.emailDraft?.includes('Bronnen:'), 'email draft persisted with source footer');
    check((await call('/api/tts', json('POST', { answerId: answer.id }))).status === 409, 'unconfigured speech has actionable error');
    await value(`/api/sources/${market.id}`, json('PATCH', { enabled: false }));
    const changed = await value<Answer>(`/api/answers/${answer.id}`);
    check(changed.sourcesChangedSince && changed.citations.every((citation) => !citation.sourceEnabled && citation.quoteText), 'disabled source retains historical evidence');
    await value(`/api/sources/${market.id}`, json('PATCH', { enabled: true }));
    const regenerated = await value<Answer>(`/api/answers/${answer.id}/regenerate`, json('POST', {}), '192.0.2.11');
    check(regenerated.regeneratedFromId === answer.id, 'regeneration links old and new answers');
    const large = new Uint8Array(11 * 1024 * 1024); large.fill(32); large.set(bytes);
    function upload(data: Uint8Array, title: string) {
      const form = new FormData(); form.set('file', new Blob([Buffer.from(data)], { type: 'application/pdf' }), 'verification.pdf');
      form.set('title', title); form.set('level', 'municipal'); form.set('docType', 'bylaw'); return { method: 'POST', body: form };
    }
    const uploaded = await value<Source>('/api/sources', upload(large, 'Verification large PDF'), '192.0.2.12');
    check(uploaded.currentVersion?.processingStatus === 'ready' && Boolean(uploaded.summary), '>10 MiB PDF traverses Proxy and gets automatic summary');
    check((await call('/api/sources', upload(new Uint8Array(25 * 1024 * 1024 + 1), 'Too large'), '192.0.2.12')).status === 400, '25 MiB file limit enforced');
    check((await call('/api/sources', upload(new TextEncoder().encode('this is not a PDF'), 'Invalid'), '192.0.2.12')).status === 422, 'renamed text file rejected with readable extraction error');
    for (const url of ['http://127.0.0.1/private.pdf', 'http://169.254.169.254/latest/meta-data', 'http://[::ffff:127.0.0.1]/private.pdf']) {
      const blocked = await call('/api/sources/from-url', json('POST', { url, title: 'Blocked', level: 'municipal', docType: 'bylaw' }), '192.0.2.13');
      check(blocked.status === 422 && (await blocked.json()).error.code === 'unsafe_source_url', `URL import blocks ${new URL(url).hostname}`);
    }
    const events = await value<Array<{ label: string; href: string }>>('/api/events');
    check(events.length > 10 && events.some((event) => event.label === answer.question), 'combined logbook has readable record labels');
    await stop(); await start('cloudflare');
    const persisted = await value<Answer>(`/api/answers/${answer.id}`);
    check(persisted.reviewedAnswer === edited.reviewedAnswer && persisted.citations.filter((citation) => citation.checked).length === 2, 'review, citations, and history survive process restart');
    console.log(`HTTP verification: ${checks} checks passed. Synthetic provider only.`);
    if (process.env.VERIFY_KEEP_SERVER === '1') {
      console.log(`Browser verification workspace: ${base}; password: ${env.APP_PASSWORD}; storage: ${storage}; answer: ${answer.id}`);
      await new Promise<void>((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
    }
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    await stop(); fixture.closeAllConnections(); await new Promise<void>((resolve) => fixture.close(() => resolve()));
    // Only the exact directory created above is removed.
    assert.ok(path.resolve(storage).startsWith(path.resolve(os.tmpdir()) + path.sep + 'ea-http-'));
    fs.rmSync(storage, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

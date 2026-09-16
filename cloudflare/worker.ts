import { DurableObject } from 'cloudflare:workers';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { proxy } from '../web/src/proxy';
import { DDL, getDb, pdfPathForVersion } from '../web/src/lib/db';
import { dispatch } from './build/routes';
import { NextRequest } from './next-server';
import { runInRuntimeContext } from './runtime-context';
import { FILE_DDL, writeFileSync } from './runtime-fs';

const TABLES = new Set(['sources', 'source_versions', 'passages', 'answers', 'answer_citations', 'answer_events', 'settings', 'source_events', 'passage_embeddings']);

export class JuryWorkspace extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(DDL);
      ctx.storage.sql.exec(FILE_DDL);
    });
  }

  async fetch(request: Request): Promise<Response> {
    return runInRuntimeContext({ storage: this.ctx.storage }, async () => {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/__bootstrap/')) return this.bootstrap(request, url);
      const nextRequest = new NextRequest(request);
      const gate = await proxy(nextRequest);
      if (gate.headers.get('x-middleware-next') !== '1') return gate;
      if (!url.pathname.startsWith('/api/')) return new Response(null, { status: 204, headers: { 'x-ea-allow-assets': '1' } });
      const response = await dispatch(nextRequest);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    });
  }

  private async bootstrap(request: Request, url: URL): Promise<Response> {
    const expected = this.env.BOOTSTRAP_TOKEN;
    const actual = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    if (!expected || !timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(actual).digest())) {
      return new Response('Not found', { status: 404 });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (url.pathname === '/__bootstrap/file') {
      const id = url.searchParams.get('id') ?? '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Invalid version', { status: 400 });
      const bytes = await boundedBody(request, 25 * 1024 * 1024);
      writeFileSync(pdfPathForVersion(id), Buffer.from(bytes));
      return Response.json({ stored: bytes.byteLength });
    }
    if (url.pathname === '/__bootstrap/data') {
      const bytes = await boundedBody(request, 2 * 1024 * 1024);
      const input = JSON.parse(new TextDecoder().decode(bytes)) as { table: string; rows: Record<string, unknown>[] };
      if (!TABLES.has(input.table) || !Array.isArray(input.rows) || input.rows.length > 100) return new Response('Invalid import', { status: 400 });
      const allowed = new Set(this.ctx.storage.sql.exec<{ name: string }>(`PRAGMA table_info(${input.table})`).toArray().map(row => row.name));
      const db = getDb();
      db.transaction(() => {
        for (const row of input.rows) {
          const names = Object.keys(row);
          if (names.some(name => !allowed.has(name))) throw new Error('Invalid column');
          const values = names.map(name => {
            const value = row[name];
            if (value && typeof value === 'object' && 'base64' in value && typeof value.base64 === 'string') return Buffer.from(value.base64, 'base64');
            if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid value');
            return value;
          });
          db.prepare(`INSERT OR REPLACE INTO ${input.table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...values);
        }
      })();
      return Response.json({ imported: input.rows.length });
    }
    if (url.pathname === '/__bootstrap/finish') {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec('DELETE FROM passages_fts');
        this.ctx.storage.sql.exec('INSERT INTO passages_fts (text, passage_id) SELECT text, id FROM passages');
        this.ctx.storage.sql.exec('DELETE FROM answers_fts');
        this.ctx.storage.sql.exec('INSERT INTO answers_fts (question, answer_id) SELECT question, id FROM answers');
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES ('cloudflare.seeded','true',?)", new Date().toISOString());
      });
      return Response.json({ ready: true });
    }
    return new Response('Not found', { status: 404 });
  }
}

async function boundedBody(request: Request, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Import too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico') return env.ASSETS.fetch(request);
    const headers = new Headers(request.headers);
    // Cloudflare's public ingress supplies CF-Connecting-IP. The forwarded
    // origin is reconstructed from this request, never client forwarding headers.
    headers.set('host', url.host);
    headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
    const upstream = new Request(request, { headers });
    const result = await env.WORKSPACE.getByName('schoten-jury-workspace').fetch(upstream);
    if (result.headers.get('x-ea-allow-assets') === '1') {
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
    return result;
  },
} satisfies ExportedHandler<Env>;

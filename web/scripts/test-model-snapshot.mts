import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ea-core-review-'));
process.env.STORAGE_DIR = auditDir;
const { getDb, DB_PATH } = await import('../src/lib/db');
const db = getDb();
const writer = new Database(DB_PATH);
writer.pragma('journal_mode = WAL');
let armed = false;
let interleaved = false;
const nativePrepare = db.prepare.bind(db);
db.prepare = ((sql: string) => {
  const statement = nativePrepare(sql);
  if (sql === 'SELECT value FROM settings WHERE key = ?') {
    const nativeGet = statement.get.bind(statement);
    statement.get = (...params: unknown[]) => {
      const value = nativeGet(...params);
      if (armed && params[0] === 'key.custom') {
        armed = false;
        writer.transaction(() => {
          writer.prepare('UPDATE settings SET value = ? WHERE key = ?').run('audit-key-b', 'key.custom');
          writer.prepare('UPDATE settings SET value = ? WHERE key = ?').run('https://b.example/v1', 'custom.baseUrl');
        })();
        interleaved = true;
      }
      return value;
    };
  }
  return statement;
}) as typeof db.prepare;
const { updateSettings } = await import('../src/lib/settings');
const { resolveTaskModel, PROVIDERS } = await import('../src/lib/llm');
updateSettings({ tasks: { answer: { provider: 'custom', model: 'audit', effort: null } }, keys: { custom: 'audit-key-a' }, custom: { baseUrl: 'https://a.example/v1' } });
const provider = PROVIDERS.find((p) => p.id === 'custom')!;
const nativeMake = provider.make;
const captured: { key: string | null; baseUrl: string | null }[] = [];
provider.make = (key, options) => {
  captured.push({ key, baseUrl: options.baseUrl });
  return nativeMake(key, options);
};
armed = true;
resolveTaskModel('answer');
assert.equal(interleaved, true);
assert.deepEqual(captured[0], { key: 'audit-key-a', baseUrl: 'https://a.example/v1' });
resolveTaskModel('answer');
assert.deepEqual(captured[1], { key: 'audit-key-b', baseUrl: 'https://b.example/v1' });
provider.make = nativeMake;
writer.close();
db.close();
console.log('PASS: concurrent atomic settings update preserves credential/endpoint pairing across the model snapshot.');
assert.equal(path.dirname(path.resolve(auditDir)), path.resolve(os.tmpdir()));
assert.ok(path.basename(auditDir).startsWith('ea-core-review-'));
fs.rmSync(auditDir, { recursive: true });

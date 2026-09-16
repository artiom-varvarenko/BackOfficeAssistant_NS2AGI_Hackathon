// The API bundle aliases better-sqlite3 to this small synchronous adapter.
// Local Next.js keeps using the original native package and on-disk database.
import { Buffer } from 'node:buffer';
import { getRuntimeContext, type SqlValue } from './runtime-context';

type Params = unknown[] | Record<string, unknown>;
type Row = Record<string, unknown>;
type Transaction<Args extends unknown[], Result> = ((...args: Args) => Result) & {
  deferred: (...args: Args) => Result;
  immediate: (...args: Args) => Result;
  exclusive: (...args: Args) => Result;
};

function toBinding(value: unknown): SqlValue {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    // Respect byteOffset: pooled Node Buffers may share a much larger backing
    // allocation, and an embedding is exactly its typed view's byte range.
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
  }
  if (typeof value === 'bigint' && Number.isSafeInteger(Number(value))) return Number(value);
  throw new TypeError(`Unsupported SQLite binding: ${typeof value}`);
}

function fromRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    value instanceof ArrayBuffer ? Buffer.from(value)
      : ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : value,
  ]));
}

// Convert named bindings to the positional placeholders supported by DO SQL.
// Quoted SQL strings/identifiers and comments must not be interpreted as params.
const SQL_TOKENS = /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\/|[@:$]([A-Za-z_][A-Za-z_0-9]*)|\?(\d*)/g;

function bindSql(query: string, args: unknown[]): { query: string; values: SqlValue[] } {
  const flat = args.flatMap(value => Array.isArray(value) ? value : [value]);
  const named = flat.find(value => value !== null && typeof value === 'object'
    && !(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) as Record<string, unknown> | undefined;
  const positional = flat.filter(value => value !== named);
  const values: SqlValue[] = [];
  let nextPosition = 0;
  const compiled = query.replace(SQL_TOKENS, (token: string, name: string | undefined, index: string | undefined) => {
    if (name !== undefined) {
      const key = named && Object.hasOwn(named, name) ? name : token;
      if (!named || !Object.hasOwn(named, key)) throw new RangeError(`Missing named SQLite parameter: ${name}`);
      values.push(toBinding(named[key]));
      return '?';
    }
    if (index !== undefined) {
      const position = index ? Number(index) - 1 : nextPosition;
      nextPosition = Math.max(nextPosition, position + 1);
      if (position < 0 || position >= positional.length) throw new RangeError('Missing positional SQLite parameter.');
      values.push(toBinding(positional[position]));
      return '?';
    }
    return token;
  });
  if (nextPosition !== positional.length) throw new RangeError('Too many positional SQLite parameters.');
  return { query: compiled, values };
}

export class Statement<BindParameters extends Params = unknown[], Result = Row> {
  private bound: unknown[] | undefined;
  private rawRows = false;
  private pluckRows = false;
  constructor(public readonly source: string) {}

  private execute(args: unknown[]) {
    if (this.bound && args.length) throw new TypeError('This statement already has bound parameters.');
    const bindings = bindSql(this.source, this.bound ?? args);
    const cursor = getRuntimeContext().storage.sql.exec(bindings.query, ...bindings.values);
    // Materialize before returning: a cursor resumed after an await does not
    // have a stable snapshot in Durable Objects.
    const rows = cursor.toArray().map(fromRow);
    return { rows, columns: cursor.columnNames };
  }

  private convert(row: Row, columns: string[]): Result {
    if (this.pluckRows) return row[columns[0]] as Result;
    if (this.rawRows) return columns.map(column => row[column]) as Result;
    return row as Result;
  }

  all(...args: BindParameters extends unknown[] ? BindParameters : [BindParameters]): Result[] {
    const result = this.execute(args);
    return result.rows.map(row => this.convert(row, result.columns));
  }

  get(...args: BindParameters extends unknown[] ? BindParameters : [BindParameters]): Result | undefined {
    const result = this.execute(args);
    return result.rows[0] ? this.convert(result.rows[0], result.columns) : undefined;
  }

  run(...args: BindParameters extends unknown[] ? BindParameters : [BindParameters]): { changes: number; lastInsertRowid: number } {
    this.execute(args);
    // rowsWritten includes index updates; changes() matches better-sqlite3's
    // number of affected table rows, including zero for a no-op update.
    const result = getRuntimeContext().storage.sql.exec(
      'SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid',
    ).toArray()[0];
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  iterate(...args: BindParameters extends unknown[] ? BindParameters : [BindParameters]): IterableIterator<Result> {
    return this.all(...args)[Symbol.iterator]();
  }

  bind(...args: BindParameters extends unknown[] ? BindParameters : [BindParameters]): this {
    if (this.bound) throw new TypeError('This statement already has bound parameters.');
    this.bound = args;
    return this;
  }

  raw(toggle = true): this { this.rawRows = toggle; return this; }
  pluck(toggle = true): this { this.pluckRows = toggle; return this; }
}

export default class Database {
  readonly open = true;
  readonly readonly = false;
  readonly memory = false;
  constructor(public readonly name = ':durable-object:') {}

  prepare<BindParameters extends Params = unknown[], Result = Row>(query: string): Statement<BindParameters, Result> {
    return new Statement<BindParameters, Result>(query);
  }

  exec(query: string): this {
    getRuntimeContext().storage.sql.exec(query).toArray();
    return this;
  }

  pragma(query: string, options?: { simple?: boolean }): unknown {
    // Durable Objects manages journaling and foreign keys. The local engine's
    // connection setup must not attempt to replace the platform's journal.
    const mode = /^\s*journal_mode\s*(?:=\s*\w+)?\s*;?$/i.test(query);
    const foreignKeys = /^\s*foreign_keys\s*=\s*(?:ON|1)\s*;?$/i.test(query);
    if (mode) return options?.simple ? 'wal' : [{ journal_mode: 'wal' }];
    if (foreignKeys) return [];
    const rows = getRuntimeContext().storage.sql.exec(`PRAGMA ${query}`).toArray().map(fromRow);
    return options?.simple ? Object.values(rows[0] ?? {})[0] : rows;
  }

  transaction<Args extends unknown[], Result>(callback: (...args: Args) => Result): Transaction<Args, Result> {
    const run = ((...args: Args) => getRuntimeContext().storage.transactionSync(() => {
      const result = callback(...args);
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new TypeError('SQLite transactions must be synchronous.');
      }
      return result;
    })) as Transaction<Args, Result>;
    // A DO has one synchronous writer; lock mode variants share that guarantee.
    run.deferred = run.immediate = run.exclusive = run;
    return run;
  }

  close(): void { /* Storage lifecycle belongs to the Durable Object. */ }
}

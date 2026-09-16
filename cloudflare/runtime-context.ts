import { AsyncLocalStorage } from 'node:async_hooks';

export type SqlValue = string | number | null | ArrayBuffer | ArrayBufferView;
export interface RuntimeSqlCursor extends Iterable<Record<string, unknown>> {
  toArray(): Record<string, unknown>[];
  readonly columnNames: string[];
  readonly rowsWritten: number;
}
export interface RuntimeStorage {
  readonly sql: {
    exec(query: string, ...bindings: SqlValue[]): RuntimeSqlCursor;
  };
  transactionSync<T>(callback: () => T): T;
}
export interface RuntimeContext {
  storage: RuntimeStorage;
}

// Statements are cached by the existing engine. Resolve their storage when
// executed, rather than retaining the Durable Object of the first request.
const contexts = new AsyncLocalStorage<RuntimeContext>();

export function runInRuntimeContext<T>(context: RuntimeContext, callback: () => T): T {
  return contexts.run(context, callback);
}

export function getRuntimeContext(): RuntimeContext {
  const context = contexts.getStore();
  if (!context) throw new Error('Database access requires a Durable Object request context.');
  return context;
}

// Useful when a stream callback is invoked by a consumer outside the async
// resource where the response was created. Ordinary awaited work retains ALS.
export function bindRuntimeContext<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const context = getRuntimeContext();
  return (...args: Args): Result => contexts.run(context, () => callback(...args));
}

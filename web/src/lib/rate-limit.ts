import { jsonError } from './api';

type BucketKind = 'model' | 'login';
interface Bucket {
  tokens: number;
  updatedAt: number;
}
interface ClientBucket extends Bucket {
  lastSeenAt: number;
}
interface BucketStore {
  clients: Map<string, ClientBucket>;
  workspace: Bucket;
  sweptAt: number;
}

const PER_MINUTE: Record<BucketKind, number> = { model: 10, login: 5 };
// One public demo process: an IP rotation must not create an unbounded provider
// bill or password-guessing budget. A single client still has its own smaller cap.
const WORKSPACE_PER_MINUTE = 100;
const MAX_CLIENTS = 2048;
const IDLE_TTL_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 30_000;

// Same global singleton convention as db.ts. State survives Next dev HMR; it is
// intentionally process-local, not a distributed rate limiter or durable quota.
declare global {
  var __economieAssistentRateLimits: Partial<Record<BucketKind, BucketStore>> | undefined;
}

function refill(bucket: Bucket, capacity: number, now: number): void {
  bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, now - bucket.updatedAt) * capacity / 60_000);
  bucket.updatedAt = now;
}

function tooManyRequests(retryAfter: number): Response {
  const response = jsonError(429, 'rate_limited', 'Te veel aanvragen, probeer over een minuut opnieuw');
  response.headers.set('Retry-After', String(Math.max(1, Math.ceil(retryAfter))));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

// Central proxy only: never also consume this from a route handler (Proxy and
// app routes need not share a process/global). An unauthenticated model request
// must be rejected before calling this function.
export function rateLimit(kind: BucketKind, clientKey: string): Response | null {
  const now = performance.now();
  const stores = globalThis.__economieAssistentRateLimits ??= {};
  const store = stores[kind] ??= {
    clients: new Map(),
    workspace: { tokens: WORKSPACE_PER_MINUTE, updatedAt: now },
    sweptAt: now,
  };
  if (now - store.sweptAt >= SWEEP_INTERVAL_MS || store.clients.size >= MAX_CLIENTS) {
    for (const [key, bucket] of store.clients) {
      if (now - bucket.lastSeenAt >= IDLE_TTL_MS) store.clients.delete(key);
    }
    store.sweptAt = now;
  }

  const capacity = PER_MINUTE[kind];
  let client = store.clients.get(clientKey);
  if (client) {
    refill(client, capacity, now);
    client.lastSeenAt = now;
  }
  refill(store.workspace, WORKSPACE_PER_MINUTE, now);
  const clientWait = client && client.tokens < 1 ? (1 - client.tokens) * 60 / capacity : 0;
  const workspaceWait = store.workspace.tokens < 1 ? (1 - store.workspace.tokens) * 60 / WORKSPACE_PER_MINUTE : 0;
  if (clientWait > 0 || workspaceWait > 0) return tooManyRequests(Math.max(clientWait, workspaceWait));
  if (!client) {
    // Never evict a live bucket to admit a new IP: cycling identities could then
    // repeatedly reset that client's budget. Fail closed until idle cleanup.
    if (store.clients.size >= MAX_CLIENTS) return tooManyRequests(60);
    client = { tokens: capacity, updatedAt: now, lastSeenAt: now };
    store.clients.set(clientKey, client);
  }
  // No awaits between checking and charging both budgets: denied requests do
  // not drain the other bucket, including failed authentication upstream.
  client.tokens -= 1;
  store.workspace.tokens -= 1;
  return null;
}

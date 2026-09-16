interface Bucket {
  tokens: number;
  updatedAt: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const buckets = new Map<string, Bucket>();
let lastPrunedAt = 0;

// This is deliberately a single-process demo limiter. All expensive routes
// consume in Proxy, while login consumes in its own route handler; no code
// assumes that Proxy shares module state with route handlers. Restarts reset it.
export function consumeRateLimit(kind: 'answer' | 'login', client: string, now = Date.now()): RateLimitResult {
  const capacity = kind === 'login' ? 5 : 10;
  if (now - lastPrunedAt >= WINDOW_MS) {
    for (const [key, bucket] of buckets) {
      if (now - bucket.updatedAt >= WINDOW_MS) buckets.delete(key);
    }
    lastPrunedAt = now;
  }

  const key = `${kind}:${client}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    // Do not evict active clients: that would let address churn reset quotas.
    if (buckets.size >= MAX_BUCKETS) return { allowed: false, retryAfterSeconds: 60 };
    bucket = { tokens: capacity, updatedAt: now };
    buckets.set(key, bucket);
  }

  const elapsed = Math.max(0, now - bucket.updatedAt);
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * capacity / WINDOW_MS);
  bucket.updatedAt = Math.max(now, bucket.updatedAt);
  if (bucket.tokens < 1) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) * WINDOW_MS / capacity / 1000)) };
  }
  bucket.tokens -= 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

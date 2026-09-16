// Pure error boundary shared by generation, streaming, embeddings and speech.
// Callers must pass the credentials actually used by the failed request; never
// re-read settings after an await (the officer may have changed them meanwhile).
const REDACTED = '…';
const AUTH_PATTERNS = [
  /\b(?:proxy[-_ ]?authorization|authorization|(?:(?:x|xi)[-_ ]?)?api[-_ ]?key|access[-_ ]?token)\b["']?\s*[:=,]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;}\]&]+)/gi,
  /\b(?:Bearer|Basic)\s+[^\s"'`,;}\]<>]+/gi,
  /[?&](?:key|token|api[_-]?key|access[_-]?token)=[^&#\s"']*/gi,
  /\bhttps?:\/\/[^\s/@]+@/gi,
];

export function redactSecrets(message: string, secrets: readonly string[] = []): string {
  // Locate every sensitive range in the ORIGINAL text. Sequential replacements
  // can cut through an exact key (for example "prefix?key=suffix"), or let short
  // keys destroy the header labels before auth-pattern matching.
  const ranges: [number, number][] = [];
  for (const pattern of AUTH_PATTERNS) {
    for (const match of message.matchAll(pattern)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  // Keys may also be echoed without a label or escaped inside JSON/a URL.
  const variants = new Set<string>();
  for (const secret of secrets) {
    if (secret === '') continue;
    variants.add(secret);
    variants.add(JSON.stringify(secret).slice(1, -1));
    try {
      variants.add(encodeURIComponent(secret));
    } catch {
      // A lone surrogate has no URI encoding; the raw and JSON forms above
      // still protect it without turning error reporting into another failure.
    }
  }
  for (const value of variants) {
    let start = message.indexOf(value);
    while (start !== -1) {
      ranges.push([start, start + value.length]);
      // Include overlaps, including two different credentials sharing text.
      start = message.indexOf(value, start + 1);
    }
  }
  if (ranges.length === 0) return message;
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (end <= cursor) continue;
    if (start >= cursor) parts.push(message.slice(cursor, start), REDACTED);
    cursor = end;
  }
  parts.push(message.slice(cursor));
  return parts.join('');
}

export function safeModelErrorMessage(error: unknown, secrets: readonly string[] = []): string {
  // Only message text is eligible for display. Never serialize the error object,
  // request headers/body, response body, stack or provider configuration.
  let message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (error instanceof Error && error.cause instanceof AggregateError) {
    const first = error.cause.errors[0];
    if (first instanceof Error) message = `${message} ${first.message}`;
  }
  const safe = redactSecrets(message, secrets).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  // Redact before truncating: cutting through a credential would defeat an
  // exact-value match. Large SDK messages must not become public config dumps.
  return safe === '' ? 'De aanbieder kon de aanvraag niet uitvoeren.' : safe.slice(0, 1000);
}

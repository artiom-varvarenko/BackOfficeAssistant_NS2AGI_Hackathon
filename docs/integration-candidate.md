# Remaining-plan candidate — coordination checkpoint

This candidate is isolated on `integration/finish-plan`, based on the delivered
auxiliary branch (`a28ec00`) and integration checkpoint `0f55ac4`. It has not
been merged into the shared integration branch or `main`.

The user confirmed that the other agent is still implementing the shared engine
and owns final integration. Overlapping edits were paused at that point. Compare
this candidate with that agent's branch before choosing or combining changes;
do not assume this document transfers their ownership.

## Candidate changes

- Shared answer preparation, metadata snapshot, validation and atomic storage
  for normal and streamed generation. SSE sends throttled partial text followed
  by a validated stored answer, with cancellation and a single retry budget.
- OpenAI passage/query embeddings, strict vector validation, an embedding API,
  scoped hybrid retrieval using reciprocal-rank fusion, and configured automatic
  summaries/embeddings after PDF ingestion. Derivation failures leave readable
  passages ready and expose a safe retry warning.
- Password gate, expiring signed sessions, login API, origin checks and bounded
  request/login token buckets. Forwarded IP/HTTPS headers are trusted only with
  explicit `APP_TRUST_PROXY=cloudflare` deployment configuration.
- Email drafts reject empty output and concurrent answer/reference changes.
- Proxy buffering accommodates the existing 25 MiB PDF limit.
- `APP_STREAMING=off` selects regular answer requests for transports without
  SSE, including Cloudflare Quick Tunnels; streaming stays the default.
- Startup and deployment documentation replaces the scaffold README.

The answer changes depend on `retrieveForAnswer(question, { sourceIds, signal })`
from the retrieval changes. Keep this interface consistent when combining work.
Public DTOs, the database schema, dependencies and environment files are unchanged.

## Verification performed

All storage checks used isolated temporary directories, never normal storage.

- Authentication: 44 focused handler/proxy/session/rate-limit checks.
- Embeddings, hybrid retrieval and ingestion: 45 focused scenarios through the
  installed SDK with a local HTTP protocol fixture, including real PDF ingestion.
- Streaming/common generation: 18 grouped scenarios through 20 SDK fixture calls,
  covering errors, retries, cancellation, persistence and rollback.
- Email draft: 16 scenarios through 13 SDK fixture calls, including five
  concurrent-edit cases and event-insertion rollback.
- Combined focused TypeScript diagnostics for all 17 changed TS/TSX files: zero.
- Fresh isolated seed: all nine PDFs, 556 passages; Article 13 §3 stays on p. 5–6.
- Normal storage was unchanged: nine sources, 556 passages, zero answers/settings.

Throwaway focused-test scripts and their databases were removed. Full build,
lint, production-server integration, browser checks and public-tunnel checks
have not been performed for this candidate. Protocol fixtures do not establish
real answer quality, embedding relevance or Dutch speech quality.

## Findings for the integration owner

1. `countUncitedSentences()` in `web/src/lib/answer.ts` splits before a citation
   immediately after sentence punctuation. A long sentence ending `. [1]`
   incorrectly counts as uncited; ending `[1].` does not. Preserve trailing
   citation markers with their sentence when fixing the counter.
2. `web/src/app/api/answers/[id]/regenerate/route.ts` does not pass its request
   signal to the now-cancellable `generateAnswer()`. Forward the signal so a
   disconnected regeneration follows the same cancellation behavior.

The user will configure credentials locally. Real Q1–Q9 review, provider/speech
acceptance, final integration, the demo recording/export, public video upload
and organiser submission remain outstanding. No public tunnel, video or
submission was created by this candidate.

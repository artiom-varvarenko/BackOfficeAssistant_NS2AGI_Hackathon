# Remaining-plan candidate — laptop handoff

This candidate is isolated on `integration/finish-plan`, based on the delivered
auxiliary branch (`a28ec00`) and integration checkpoint `0f55ac4`. It has not
been merged into the shared integration branch or `main`.

The user confirmed that the other agent is still implementing the shared engine
and owns final integration. This branch contains the candidate checkpoint
`1965fac` plus final validation fixes. Compare it with that agent's branch before
choosing or combining changes; do not assume this document transfers their
ownership. Work stopped at the user's request so the other laptop can take over.

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
- Final fixes retain citations after sentence punctuation when counting uncited
  sentences and propagate request cancellation through regeneration.
- Final lint fixes stabilize review/settings callbacks, reset playback when text
  changes, preserve navigation registrations, and clean up source loading and
  search highlighting. Browser regression checks remain pending.

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
- Citation sentence counter: 25 focused cases, including trailing/grouped markers.
- Regeneration handler with temporary SQLite and a local SDK fixture: unknown ID,
  successful linked regeneration/events, and cancellation without persistence.
- Final full TypeScript check: `tsc --noEmit --incremental false` passed.
- Final full lint: `npm run lint` passed with no errors or warnings.
- Production build: `npm run build -- --webpack` passed with isolated
  `STORAGE_DIR`. Next.js reported an ignored package lock outside the repository;
  compilation, type checking and page generation all completed successfully.
- Fresh isolated seed: all nine PDFs, 556 passages; Article 13 §3 stays on p. 5–6.
- Normal storage was unchanged: nine sources, 556 passages, zero answers/settings.

Throwaway scripts and temporary databases were removed. The normal database's
SHA-256 remained unchanged after the final checks. Protocol fixtures do not
establish real answer quality, embedding relevance or Dutch speech quality.

## Remaining verification for the integration owner

Production-server HTTP and browser suites were prepared but **not executed**;
the server and browser were never started. Their scripts were removed. Existing
focused handler/protocol evidence above must not be described as browser or
production-server verification.

- Exercise login/cookies, cross-origin protection, rate limits, forwarded-header
  spoofing, safe errors/settings responses, SSRF rejection, SSE errors and a PDF
  upload larger than 10 MiB through the running server.
- Check review autosave/draft recovery and navigation during saving; settings
  with unsaved credentials; read-aloud during text changes and navigation;
  streamed rendering, citation controls, source/history/event links, upload,
  clipboard/email draft interactions and printed briefing layout.
- Static observation: the PDF route advertises `Accept-Ranges: bytes` but sends
  the full file with HTTP 200. Range behavior was not runtime-tested.

No provider credentials were available during verification; the user will
configure them locally. Real Q1–Q9 review, provider/speech
acceptance, final integration, the demo recording/export, public video upload
and organiser submission remain outstanding. No public tunnel, video or
submission was created by this candidate.

## Takeover

Fetch `origin/integration/finish-plan` and review its diff against the other
agent's working branch. The original five-file auxiliary delivery is also
available separately on `p2/auxiliary-api` at `a28ec00`. Nothing from this candidate
was merged into `integration/complete-plan` or `main`.

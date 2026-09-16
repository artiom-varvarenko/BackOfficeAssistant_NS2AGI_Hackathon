# Economie-assistent — laptop / agent handoff

## 1. Read this first

The user requested a stop and a portable handoff to another agent/laptop. The originating agent is **not continuing implementation** after this checkpoint. This is **not a declaration that PLAN.md is finished**.

Read this file, then PLAN.md (the product specification and acceptance questions), then `web/AGENTS.md`.

**Most remaining code now exists. The next job is branch reconciliation, integration and verification—not reimplementing the same features.** Preserve the teammate's work and the existing source/evidence history.

## 2. Branches and exact checkpoints

Repository: `https://github.com/artiom-varvarenko/BackOfficeAssistant_NS2AGI_Hackathon`

| Ref / commit | What it contains | Status at handoff |
|---|---|---|
| `origin/main` / `1053b00` | Part 1 through Sprint 2, Part 2 Sprint 1, original restart checkpoint | Earlier shared baseline; not the latest project |
| `origin/p2/sprints-2-4` / `de17c02` | Teammate's remaining UI and demo script/architecture slide | Already merged into our integration branch |
| `0f55ac4` on `integration/complete-plan` | Complete Tier 2 APIs, real-only UI cutover, settings/model safety and integration fixes | Typechecked; real HTTP/browser checks described below |
| `d5372b6` on `integration/complete-plan` | Hybrid embeddings/retrieval, shared streaming generation, login/proxy/rate limits, proxy upload-buffer configuration | Full TypeScript and production build passed; new core runtime checks still pending |
| `origin/p2/auxiliary-api` / `a28ec00` | Exactly the teammate's five assigned summary/TTS/event API files | Pushed; **not merged/reviewed in our integration branch** |
| `origin/integration/finish-plan` / `1965fac` | Auxiliary commit plus an alternative completion candidate touching shared engine/auth/ingestion/UI/deployment docs | Pushed separately; **overlaps our core implementation**; do not blindly merge |

The latest `origin/integration/complete-plan` tip also contains this handoff and an updated PLAN.md. Fetch all branches before doing anything. Do not reset or overwrite an existing integrator's working branch.

The candidate's own handoff is `docs/integration-candidate.md` on `origin/integration/finish-plan`. Its reported focused checks are useful, but have not been independently rerun here. It reports no full build/browser/public-tunnel verification.

## 3. Ownership — prevent overlap

### Teammate: auxiliary backend only

Her accepted exclusive assignment is these five files, delivered in `a28ec00`:

```text
web/src/lib/summary.ts
web/src/lib/tts.ts
web/src/app/api/sources/[id]/summary/route.ts
web/src/app/api/tts/route.ts
web/src/app/api/events/route.ts
```

Do not implement competing versions of these files. Merge/review her branch and coordinate any corrections with her. Do not assume this handoff authorizes simultaneous edits by two agents.

Agreed integration interfaces:

```ts
summarizeSource(sourceId: string, expectedVersionId?: string): Promise<Source>
synthesizeAnswer(answerId: string): Promise<Response>
```

- Summary: current ready source, approximately first 6,000 passage characters plus metadata, three Dutch sentences, safe stale-version check, atomic `sources.summary` + `summary_generated` event.
- TTS: reviewed text or generated text, citation markers removed, maximum 2,500 characters, configured ElevenLabs/OpenAI and safe fallback, `audio/mpeg`, missing configuration 409. Use provider-scoped key helpers; never reuse an ElevenLabs credential for OpenAI.
- Events: combine answer/source events newest first. `EventLogItem.label` is the **answer question or source title**, not the event-name translation; the UI already translates event types.

### Receiving agent: sole final integrator / remaining core

Own reconciliation of shared engine files, ingestion hooks, final UI/API fixes, credential-dependent verification, security review, deployment checks, final documentation and eventual merge to main.

The originating session's workers and test servers are stopped. No further local implementation is planned. Check with the user before assigning anyone else the same shared files.

## 4. What is implemented and what was actually verified

### Existing, integrated functionality

- SQLite/WAL schema, nine real PDFs, 556 passages, idempotent seed and retained source versions.
- Article 13 §3 spans pages 5–6; retributies Article 4.1 stays on page 1. The two expected extraction warnings remain.
- Provider-neutral model/settings layer, safe credential masking and server-side configuration.
- Dutch answer prompt, retrieval, citation/quote validation, stored original answers and review history.
- PDF serving; source upload/edit/disable/replace/applicability; review PATCH; citation checks; regeneration; e-mail draft; settings save/test.
- Direct search with escaped snippets and trusted mark boundaries; adjacent context tied to the exact cited version; similar past questions; safe public-URL PDF import.
- All teammate UI sprints: source forms/details, settings, history, briefing, e-mail modal, scope/audio/logbook/stream/login consumers.
- Frontend fixtures, fake answer storage and `NEXT_PUBLIC_USE_FIXTURES` code paths were removed. `fixtures.ts` was deleted. There is no shipped fake-model fallback.

### Runtime evidence before the final core wave

Performed against an isolated database and the actual Next server:

- All nine seeded sources and page/article sanity checks.
- `loting` search finds Article 12 with highlight markers; context stays within Article 13's actual version; similar questions return stored review counts.
- **Actual public Schoten PDF URL** downloaded through the new pinned-DNS downloader and ingested successfully.
- Loopback, link-local/cloud metadata and IPv4-mapped IPv6 loopback URL imports rejected before ingestion.
- Unsafe Astra effort and credential-bearing custom endpoint URLs rejected with 400; malformed enum objects rejected without coercion exceptions.
- Real SDK/HTTP **protocol fixture** used for generation and e-mail paths: storage, review, citation checks and similar-question lookup worked. This is not proof of real model quality.
- Native headless-Chrome clicks: explicit reopen gives the correct notice; checking a second citation persists and displays 2/3 progress.
- Editing then Copy persists fresh text and copies the source footer. Windows clipboard converts newlines to CRLF; normalize that in cross-platform assertions. The denied-clipboard-permission error was also exercised.
- E-mail dialog consumed freshly persisted reviewed text through the actual API (synthetic provider output).
- All seven briefing sections rendered; Chromium exported an A4 PDF containing stored text/evidence/status.

**This runtime evidence predates the new hybrid/streaming/auth wave. Re-run relevant regressions after reconciling the branches.**

### Latest core checkpoint

After all three core agents settled and the proxy buffering fix was added:

```text
npx tsc --noEmit                 PASS
npm run build -- --webpack      PASS (Next 16.3.5, including Proxy)
```

No successful real-provider calls, end-to-end hybrid ranking, streaming/cancellation, protected-login/rate-limit runtime, large upload through Proxy, or public tunnel are claimed for `d5372b6`.

Normal `web/storage/` was preserved and checked: **9 sources, 556 passages, 0 answers, 0 settings rows**. Synthetic test answers/configuration lived only in a separate temporary database, not normal storage.

## 5. New core interfaces — already implemented, do not duplicate

### Embeddings / retrieval

Files: `embeddings.ts`, `retrieve.ts`, `api/sources/[id]/embed/route.ts`.

- `embedSource(sourceId, expectedVersionId?) -> Promise<number>` returns total indexed passages including reusable valid vectors.
- `retrievePassages(question, opts)` is now **async**; supports `opts.abortSignal`. `searchPassages` remains synchronous, BM25-only.
- OpenAI `text-embedding-3-small`, 1536 dimensions, explicit little-endian float32 BLOBs; finite/nonzero/count/dimension checks; bounded batches and one total transport retry per embedding session.
- SQL filters enabled + ready + current version + exact scope for BM25 and vectors. Missing/null scope means all; explicit empty selection does not widen to all.
- Hybrid combines BM25 top 40 and cosine top 40 by reciprocal-rank fusion, then the common budget/order.
- Complete valid scoped embedding coverage required. `embeddings_required` / `embeddings_incomplete` 409 errors instruct indexing or choosing BM25; no silent fallback.
- Concurrent source/corpus changes reject with `source_changed`. Writes are atomic after successful validation.

### Shared generation / streaming

Files: `answer.ts`, `llm.ts`, answer POST/regenerate routes and `answers/stream/route.ts`.

- `parseAnswerInput(body)`, `prepareAnswer(input, abortSignal?)`, `generateAnswer(input, abortSignal?)`, `streamAnswer(prepared, onPartialText)`.
- Shared preparation, validation and atomic storage for normal/streaming/regenerated answers.
- `llm.generateStructured` accepts a task or the exact resolved-model object; `streamStructured` reuses that captured object for safe secret redaction.
- One shared 120-second model deadline and at most one outer retry across transport/JSON errors; native SDK retries disabled for that shared loop.
- SSE partial `{antwoord}`, final `Answer`, error `{code,message}`; approximately 100ms throttling; cancellation/cleanup and no partial-answer persistence.
- Explicit `[]` scope is 400. Invalid marker integers are discarded; unused citations cannot falsely support `ja`. Trailing `. [1]` markers are associated with the preceding sentence for uncited-sentence counting.
- `findVerbatim` permits only whitespace/case normalization; highlight remains an exact original substring.
- `StructuredResult.instructions` records the final attempt's actual instructions in the prompt snapshot, including a JSON-format retry if used.

### Access gate / request limits

Files: `src/proxy.ts`, `auth.ts`, `rate-limit.ts`, `api/login/route.ts`; configuration in `.env.example`.

- Local mode without a password remains usable. Cloudflare mode requires a password and valid secret; invalid configuration fails closed.
- Signed, server-expiring 12-hour `ea_session`, HttpOnly/SameSite Strict; credential changes invalidate it. APIs return JSON 401; pages redirect to a relative login URL.
- CSRF origin checks, exact public-path exceptions and local Host restrictions against DNS rebinding.
- Local mode only accepts localhost / 127.0.0.1 / ::1, not LAN/custom hostnames. This is deliberate, not a missing route.
- Trusted Cloudflare mode uses validated `CF-Connecting-IP`/`X-Forwarded-Proto`; never trust arbitrary forwarding headers or expose the Node port publicly in that mode.
- Shared model-bearing POST bucket: 10/IP/min; separate login 5/IP/min and workspace safety ceilings; bounded maps survive HMR.
- `next.config.ts` now sets `experimental.proxyClientMaxBodySize` to 26 MiB. Next's default 10 MiB would otherwise truncate valid 25 MiB multipart uploads. Actual large-upload runtime validation is still required.

## 6. Reconcile these branches before adding features

`integration/finish-plan` already contains auxiliary commit `a28ec00`, plus alternative shared-core work. Do not cherry-pick the auxiliary commit twice, and do not blindly replace entire files with ours/theirs.

Direct overlapping implementation areas include:

```text
web/next.config.ts
web/src/app/api/answers/route.ts
web/src/app/api/answers/stream/route.ts
web/src/app/api/login/route.ts
web/src/app/api/sources/[id]/embed/route.ts
web/src/lib/answer.ts
web/src/lib/auth.ts
web/src/lib/embeddings.ts
web/src/lib/llm.ts
web/src/lib/rate-limit.ts
web/src/lib/retrieve.ts
web/src/proxy.ts
```

Candidate-only changes worth reviewing/porting, not discarding:

- Automatic summary/embedding ingestion hooks and safe enrichment failure handling in `ingest/index.ts`.
- E-mail empty-output and concurrent-edit/reference-change guards in `email-draft.ts`.
- `APP_STREAMING=off` transport option in page/QuestionPage, with documented Quick Tunnel compatibility rationale.
- Startup/deployment READMEs and `answer-request.ts` helper.

**Interface conflict:** candidate generation uses `retrieveForAnswer(question, {sourceIds, signal})`; this branch uses async `retrievePassages(question, {sourceIds, abortSignal})`. Migrate every caller consistently and remove obsolete paths rather than keeping parallel pipelines.

The candidate's reported uncited-sentence and regeneration-abort findings are already addressed in this branch; preserve those fixes during reconciliation. Candidate runtime/test claims remain claims until reproduced against the final combined code.

## 7. Remaining checklist for the receiving agent

1. Fetch and inspect all three active branches above. Choose one final integration branch; preserve the other checkpoints. Do not modify shared files in parallel with another agent.
2. Merge/review the five auxiliary files from `p2/auxiliary-api`; coordinate any corrections with the teammate.
3. Reconcile the alternative completion candidate, preserving the best fixes and one consistent generation/retrieval/auth implementation.
4. Finish/review shared ingestion hooks. This branch does not yet call automatic summary or embedding generation. Use captured version IDs, do not attach results to a replacement version, and do not mark a readable PDF failed because optional enrichment fails. Review the candidate's existing hook implementation first.
5. Verify concurrent version uploads cannot promote an older completed version; the common ingestion transaction was corrected to select the newest ready version, but the overlapping-upload race was not exercised.
6. Run scoped/empty/disabled/superseded retrieval, embedding reuse/coverage/corruption/race, RRF ranking and request cancellation checks. Confirm actual provider batching and atomic failure behavior.
7. Run SSE preflight/error/retry/cancellation/Unicode/final-storage checks, then verify the actual streaming UI. Review removal of the now-obsolete 404/405 stream fallback only after the final route is proven. Decide the candidate's explicit nonstreaming deployment mode based on real transport behavior.
8. Verify login, cookie tampering/expiry/configuration changes, CSRF, hostname/IP trust, all protected PDF/API paths and the eleventh model request returning 429. Exercise >10 MiB valid uploads through Proxy and the actual 25 MiB limit.
9. Run an independent final security/citation review on the reconciled code, not only the individual patches.
10. Configure real model/embedding/TTS credentials locally. Run PLAN Q1–Q9, read every real answer, verify refusal/conflict/source scope/provider switching, summaries and actual Dutch audio. Do not substitute protocol-fixture output for these checks.
11. Repeat the full PLAN §13 checklist in the browser against the final backend, with persistence after reload/restart. Keep earlier evidence separate from new observations.
12. Verify a password-protected public tunnel on the intended laptop/network and actual mobile device. Never expose an unguarded server or synthetic answers as the real demo.
13. Complete recording, narration, editing/export, YouTube upload and organiser submission with the user/team. Only the script and architecture slide exist; no final video, account login or submission was produced here.
14. Update PLAN/README and evidence honestly, clean temporary scripts/data, then merge the verified final integration into main and push. **Main is not updated to the latest core checkpoint yet.**

## 8. Starting on the other laptop

Example for a fresh clone; adapt branch names if a receiving integrator already has work:

```sh
git clone https://github.com/artiom-varvarenko/BackOfficeAssistant_NS2AGI_Hackathon.git
cd BackOfficeAssistant_NS2AGI_Hackathon
git fetch origin
git switch -c integration/handoff-review origin/integration/complete-plan
cd web
npm ci
npm run seed
npm run dev -- --webpack -H 127.0.0.1
```

- Use Node 22 or a compatible supported version. Install dependencies on that laptop; do not copy Windows `node_modules` to macOS/Linux.
- Copy `.env.example` to `.env.local` locally and supply actual secrets privately. No provider/TTS credentials were available in the originating environment or normal DB at the last check. Embeddings specifically require an OpenAI key even when answers use another provider.
- `storage/`, `.env.local`, build output, temporary protocol servers, browser profiles, screenshots and test PDFs are not in Git. Fresh `npm run seed` recreates the nine-source corpus; it does not recreate test answers.
- Do not reset an existing user's storage. If transferring a real DB, transfer PDFs too and account for absolute `source_versions.file_path` values. Fresh seeding is simpler for this checkpoint because normal storage has no answers/settings.
- For isolated checks, export `STORAGE_DIR` in the shell for **both seed and server**; the standalone seed script does not automatically load `.env.local` like Next does.
- No auth is needed locally with empty APP_PASSWORD and `APP_TRUST_PROXY=local`. For a protected tunnel, configure both credentials, use a strong random session secret, set trusted Cloudflare mode and bind Next to loopback. Read `.env.example` in full.
- No cloudflared binary is committed. Install the official binary for the receiving OS. A Windows binary was downloaded and checksum-verified only for local preparation; no tunnel was launched.
- Fresh headless Chrome worked for native interaction checks. For browser clipboard checks grant clipboard-read and clipboard-sanitized-write; normalize Windows CRLF. Native e-mail dialogs are `dialog[open]`, not necessarily an explicit `[role=dialog]` attribute.

## 9. Prompt for the next agent

> Read HANDOFF.md and PLAN.md. Continue as the sole final integrator on a fresh branch from origin/integration/complete-plan unless an existing integration branch already has work. First reconcile origin/p2/auxiliary-api and origin/integration/finish-plan; do not reimplement their features or overwrite overlapping fixes blindly. The teammate owns the five auxiliary files listed in HANDOFF.md. Complete the shared hooks, combined runtime/security/browser checks and real-provider acceptance, coordinating credentials and external demo/submission prerequisites with the user. Preserve source/history data. Distinguish implemented, build-verified, runtime-verified and blocked work. Update the plan and merge into main only after the final combined project is verified.

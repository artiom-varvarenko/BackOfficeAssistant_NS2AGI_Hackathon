# Final integration and acceptance evidence

This is the combined implementation of both laptop branches. It supersedes the
handoff instructions in `HANDOFF.md` and the alternative candidate notes, while
retaining those documents as historical evidence.

## Branch reconciliation

- Started from `integration/complete-plan` at `760f1f2`.
- Fetched and merged `integration/finish-plan` at `caa7250`, including the
  auxiliary delivery `a28ec00` and the final candidate validation/UI fixes.
- Retained the stricter shared async `retrievePassages` / `prepareAnswer`
  pipeline, captured model configuration, embedding coverage validation, and
  authentication/rate-limit implementation from `d5372b6`.
- Integrated candidate summary/TTS/events APIs, automatic ingestion enrichment,
  email stale-state checks, explicit nonstreaming deployment mode, and UI fixes.
- Removed the redundant alternative answer-request parser. There is one shared
  generation and validation pipeline for JSON, SSE, and regeneration.

## Corrections found during final integration

- Production Next.js Proxy rejected relative login redirects with HTTP 500.
  Redirects now use an absolute URL built from the validated public origin.
- Empty or citation-only model output fails before history is written.
- Task, endpoint, and credential resolution uses one database snapshot, avoiding
  a mismatched custom-provider key/endpoint during concurrent settings changes.
- Successful summary/embedding retries remove their own stale failure notice
  while retaining PDF extraction warnings and unrelated failures.
- PDF serving implements byte ranges (206/416), including suffix/open-ended
  ranges, and keeps protected content private.
- The settings page records actual successful connection tests instead of
  claiming that a default model has already been tested.

## Interface and language integration

- Reworked the responsive workspace styling and navigation, including question
  entry, source cards, review panels, history, settings and activity views.
- Added an **NL / EN** switch to the login page and workspace header. Dutch is
  the default; the one-year `ea_locale` cookie persists the selection. The server
  applies it to the initial page language and metadata, while client components
  update interface text and date formatting when the selection changes.
- Translated navigation, forms, loading and error states, review controls,
  settings, route headings and system audit labels through shared dictionaries.
- New answers, email drafts and summaries follow the selected language. English
  search questions expand into Dutch terms for the supplied source collection.
  Source quotations, PDF passages, document metadata, staff notes and previously
  saved generated text retain their original language. Changing the interface
  does not silently rewrite evidence or an existing reviewed answer.

These changes describe implemented behavior. The checks recorded below are
earlier integration evidence; they do not establish funded-provider acceptance
or a completed final release build for the latest interface and language changes.

## Reproducible checks

Run from `web/`. All verification commands use disposable storage and explicit
local protocol fixtures. They do not validate real model reasoning or audio.

| Command | Coverage |
|---|---|
| `npm run check` | Whole-project TypeScript |
| `npm run lint` | Whole-project ESLint |
| `npm run build -- --webpack` | Production compilation, route generation, Proxy |
| `npm run verify:core` | 17 groups: real PDF ingestion/version races; embeddings, reuse, corruption, coverage and hybrid scope/ranking; JSON/SSE shared validation, retries, cancellation, blank output and historical evidence |
| `npm run verify:enrichment` | Warning removal/preservation, summary failure/reuse and atomic rollback through actual SQLite/SDK |
| `npm run verify:settings` | Deterministic concurrent credential/endpoint update through two SQLite connections |
| `npm run verify:auth` | Public/local absolute redirect origins, relative return targets, POST redirects and API authentication |
| `npm run verify:http` | Built Next server: login, cookies, origin/host/IP checks, eleventh-request 429, nine seeded PDFs, search, PDF ranges, JSON/SSE generation, citations/reviews, email, regeneration, 11 MiB upload, 25 MiB limit, unsafe imports and restart persistence |

The combined production HTTP run passed 47 checks after correcting the login
adapter issue above. The settings-label regression adds one further check to
the reusable suite; that additional check was not run after the user requested
an end to extra testing. TypeScript and ESLint passed for the combined code;
the final production build is the release gate.

Clean headless Chrome verified login, source list/detail navigation, a `loting`
filter returning 3/39 passages with Article 12 expansion, direct-search highlights
and page 5, one-source Ctrl+Enter generation through the real SSE route, three
validated citation cards, marker-to-card focus/highlight, adjacent context, and
persisted citation checking. Generation used the explicit local protocol fixture.
The user requested stopping further browser checks; approval/email/briefing and
settings/navigation browser regressions were not completed in this final pass.

## PLAN.md acceptance coverage

Every product feature in tiers 1–4 has an implementation in the merged tree.
Implementation and automated verification do not imply model-quality sign-off.

| PLAN §13 | Implementation and technical coverage | Outstanding real-world acceptance |
|---|---|---|
| 1–3 | Grounded prompt, validated citations, source warnings/conflicts, retained history | Read Q1/Q6/Q8 output from a funded real model |
| 4–6 | Citation checks, review state machine, copy, email draft, printable briefing | Browser flow; real email faithfulness |
| 7–9 | PDF/URL upload, replacement, applicability, version retention | Browser forms; real public PDF import regression |
| 10–11 | Model/provider selection, key masking/precedence, test/error paths | Successful funded model switch |
| 12–13 | Direct search, intentional UI states, keyboard controls | Browser visual/keyboard pass |
| 14–18 | Summaries, speech, scope, embeddings/hybrid, combined logbook | Real summary, Dutch audio, Q3 scope and Q9 hybrid relevance |
| 19 | Actual SSE partial/final events and shared stored result, cancellation | Browser progressive rendering |
| 20 | Password gate, signed cookie, Proxy and quotas | Protected public tunnel and physical-phone check |

## Real-provider dependency

The local OpenAI key was recognized on 16 September 2026, but a real model test
returned the provider's **no credits remaining** error. No successful real
answer, summary, embedding or speech call is claimed from that attempt.
Provide a funded key in `web/.env.local` or Instellingen / Settings, then restart if the
environment file changed. ElevenLabs is optional; OpenAI can also provide speech.
Dutch and English generation, summaries and spoken output still require real
provider acceptance with a funded account; language support does not remove
that dependency.

`npm run acceptance -- --base-url http://127.0.0.1:3000` records exact Q1–Q9 plus
scoped Q3 in `web/storage/acceptance/`. It refuses known fixture model IDs, keeps
full source/citation evidence, and leaves semantic acceptance pending review.

## Demo and submission

Final release build (`npm run build -- --webpack`) passed after every UI and
localization change, including TypeScript and all route generation. A clean
Chrome preview confirmed the English home screen at 1440px and 390px with no
horizontal overflow; the language switch also updated the document title.

The production app is running on `http://127.0.0.1:3000` with a password gate.
Local access credentials are in ignored `web/storage/demo-access.txt`; API keys
remain in ignored `web/.env.local` or server-side settings.

The guarded tunnel launcher verified API/PDF authentication and HTTPS login
redirects. Cloudflare issued a temporary hostname, but its connectivity checks
reported both UDP/QUIC and TCP/HTTP2 port 7844 blocked or unreachable on this
network. No working public URL or physical-phone acceptance is claimed. The
connector was stopped; rerun `npm run demo:tunnel` on an unrestricted connection.

The Dutch three-minute script and architecture slide exist. A final recording,
narration/export, YouTube publication, private-window playback and organizer
submission must be recorded as separate completed actions. A software build
does not establish that those deliverables happened.

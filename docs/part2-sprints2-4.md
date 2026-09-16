# Part 2 — sprints 2–4 handover

Base: merged Sprint 1 on `origin/main`, commit `a0e8919`. Scope follows PLAN.md §10: UI, client and demo materials. The frozen DTO contract, API routes, ingestion and model engine belong to Part 1 and were not changed.

## Implemented

| Sprint | Delivered UI |
|---|---|
| 2 | Bronnen: PDF/URL upload, metadata edit, enable/disable, applicability + dates/notes, replacement versions and history, summaries column. Geschiedenis: immutable original vs reviewed text, change banner/regenerate/backlink, timeline, technical details including passages/scope/prompt, JSON export and similar questions. Instellingen: model/provider/effort per task, save/test, masked keys, custom base URL, Azure resource, TTS, hybrid retrieval, batch embeddings and actual configured workspace budget. |
| 3 | Seven-section printable briefing using stored answer data; editable/copyable email modal; citation verification progress and notes; search on home and Bronnen; adjacent passage context; source detail with filterable/expandable passages; summary and embedding controls; feedback toasts and keyboard focus. |
| 4 | Per-question source selection; audio playback with configuration errors and object-URL cleanup; Logboek with filters and links; streamed plain-text preview replaced by the validated answer; login form with safe local return path; Dutch three-minute video script and 16:9 architecture slide. |

Officer-facing text is Dutch. Existing fixture mode remains explicitly opt-in while the real write endpoints are unavailable. It is not a fallback for API errors. New server mutations are rejected in fixture mode, preventing sample screens from modifying real source/settings data.

## Integration behavior

- `askQuestion` uses the real POST endpoint by default. The question screen prefers `/api/answers/stream`; it falls back to POST `/api/answers` only if the streaming route returns HTTP 404/405 before streaming begins. An interrupted or failed stream is never automatically resubmitted.
- An empty source selection cannot submit. Unrestricted selection omits `sourceIds`; an explicit selection sends exactly the active selected IDs. Partials are plain text; clickable citations are rendered only after `final`.
- Review mutations are serialized. Internal navigation and starting another question also flush edits first; failed saves preserve the editor. Session-only draft recovery covers browser Back/refresh and asks before replacing a newer stored review. Email, briefing, audio, regeneration and JSON export first flush the current edited text. Approval edits become drafts. Failed saves do not silently move the officer to another screen.
- Settings tests save changed model settings first. Unsaved provider keys/URLs block dependent tests. GPT-6 effort is limited to low/medium in the UI. API keys are not put in client storage. Switching TTS provider clears the old dedicated key unless a new key is explicitly supplied.
- Login renders only when `APP_PASSWORD` is set. The UI does not implement access enforcement: Part 1's proxy/login endpoint must be merged before any public tunnel is opened.
- API failures stay visible with retry/configuration actions. There are no successful-looking placeholders for missing write services.

## Verification

- All nine real PDFs were seeded in an isolated `/private/tmp/economie-part2-review` database. All versions were ready, historical/unknown-date flags and extraction warnings were present, and the Article 13 §3 sanity check passed for pages 5–6.
- TypeScript and the production webpack build passed, including source detail, briefing, logbook, settings and login routes.
- Browser rendering checked against the real sources/settings read endpoints. The source table contains nine documents and real passage details load.
- Browser contract checks used simulated responses for currently absent write endpoints. They exercised restricted source IDs, UTF-8/CRLF SSE framing and final swap, citation note+checkbox save, approval/edit ordering, fresh text in the email modal, a missing-TTS configuration error, and all seven printable briefing sections. Printing to PDF succeeded. Further checks covered a failed save retaining the editor during navigation, successful retry before leaving, saving before a new question, TTS key clearing on provider switch, rejecting credentials in custom URLs, blocking model tests while credentials are unsaved, and wrong-password feedback. These checks establish UI behavior, not live generation quality or server persistence.
- No test suite, linter or formatter was added or run during the sprints.

## Part 1 integration still required

At the time of this handover the merged backend exposes only source/answer/settings reads and PDF serving. The following contracted endpoints still need to be implemented/merged by Part 1:

- Source creation, URL import, metadata/applicability writes, replacement uploads, summary and embedding actions.
- Answer generation and streaming, review and citation writes, regeneration and email drafts.
- Search, adjacent passage context, similar answers and events.
- Settings writes and model tests; TTS; authentication proxy/login and rate limiting.

After the endpoints land, turn fixture mode off and complete PLAN.md §11 and §13 against the actual backend, especially Q1–Q9, server persistence after refresh, historical evidence, replacement/disable behavior, provider switching, TTS and login/rate limiting. Delete the fixture flag only after that integration checkpoint, as the plan specifies.

## Read-only engine review for Part 1

The requested engine review could inspect `llm.ts` and `settings.ts`; `answer.ts` is not present yet. Findings for the engine owner:

1. `settings.ts` uses a single `tts.key` across providers. The UI now clears it on provider switch; server updates should enforce provider-scoped keys or equivalent clearing so direct API callers cannot reuse another vendor's credential.
2. `llm.ts` includes raw provider error messages in `ModelFailedError`, and `api.ts` exposes them. A provider that echoes a credential could bypass the masked settings DTO. Redact resolved secrets before returning public errors.
3. `settings.ts` accepts GPT-6/high even though PLAN.md caps GPT-6 at medium. The UI enforces the ceiling; the server validator should also enforce it.
4. `settings.ts` accepts and returns the full custom base URL, including URL credentials/query strings. The UI now rejects those on entry; server-side validation/DTO handling should protect direct API updates too.

These backend files remain with their owner under the explicit handover rule in PLAN.md §10.

## Video deliverables

- `docs/video-script.md`: timed Dutch voice-over, shots, recording preparation and export/submission steps.
- `docs/architecture.svg`: accessible vector slide at 1920 × 1080, suitable for the architecture segment.

The repository contains no captured demo clips, voice recording or rendered final video. Recording, assembly/export, YouTube upload and organiser-form submission remain external steps after genuine end-to-end behavior is available. No video or submission has been claimed or published.

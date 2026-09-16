# Part 2 — Sprint 1 handover

Implemented the Sprint 0 client/fixtures prerequisite and Sprint 1 UI from PLAN.md. No Part 1 files or the frozen `web/src/lib/types.ts` contract changed.

## Run the UI independently

```sh
cd web
npm ci
NEXT_PUBLIC_USE_FIXTURES=1 npm run dev
```

On PowerShell, set `$env:NEXT_PUBLIC_USE_FIXTURES="1"` before running `npm run dev`. No model keys are needed for fixtures. No secrets have been created or added.

The amber banner identifies fixture mode. The three example chips have fixed example answers; arbitrary questions deliberately show an error. There are nine example sources, three historical sources, unknown dates, extraction warnings, a replaced version, and two initial history entries. Passage counts and nonverbatim example passages are development data, not ingestion results. Review changes and citation checks persist in browser localStorage under `economie-assistent:sprint1:answers`; clear that key to reset the examples. PDF/context requests need the actual backend and its IDs.

## Implemented

- Dutch shell, navigation, model badge, municipality from configuration, responsive 60/40 answer/evidence layout, focus styles and reduced-motion support.
- Question input, three examples, Ctrl+Enter, loading, empty, retry and missing-model states.
- Paragraph/bullet rendering with keyboard-accessible citation buttons, synchronized evidence selection, verbatim highlighting, applicability/date/source-version badges and PDF/original links.
- Citation checks and notes; context control and client endpoint ready for integration.
- Gaps, warnings, conflicts and uncited-sentence warning.
- Editable review with debounced saves, approval/rejection/reopening, restore-original control, copy including source footer and clipboard error handling. Editing approved text returns it to draft. Writes are serialized to avoid competing whole-answer responses.
- Read-only source and history tables; history details reuse the review/evidence workspace. A read-only settings page keeps shell navigation useful until Sprint 2.
- Typed API client functions for all section 7 endpoints, including binary audio, 204 login, multipart upload and SSE parsing for later sprints.

## Merge checkpoint

1. Merge Part 1's seed and read endpoints. Turn fixture mode off by unsetting `NEXT_PUBLIC_USE_FIXTURES`, then restart the dev server (or rebuild production). The flag is compiled into the client bundle.
2. Seed the backend and open `/bronnen`: verify nine real rows, three historical badges, the undated terrace and the KB extraction warning. Confirm `/geschiedenis` renders the actual answer list, including its empty state.
3. Verify model settings load in the shell. API failures must remain visible; there is no automatic fallback to fixtures.
4. At Checkpoint 2, exercise real question generation and review persistence after the write endpoints arrive. Fixture mode is a temporary Sprint 1 development aid; remove it after integration as the plan specifies.

Remaining Part 2 work: Sprint 2 source-management forms, full history and editable settings; Sprint 3 briefing, email draft, search, context/source details; Sprint 4 source scope, audio, logbook, streaming UI, login and video deliverables. The full end-to-end acceptance checklist cannot be certified before Part 1 is merged.

## Verification

`npx tsc --noEmit` and `NEXT_PUBLIC_USE_FIXTURES=1 npm run build -- --webpack` passed. The build includes `/`, `/bronnen`, `/geschiedenis`, `/geschiedenis/[id]` and `/instellingen`. HTTP checks against the production server returned 200 for all four main pages. No tests, linters or formatters were run, following the sprint rule in PLAN.md. Live backend integration and interactive browser verification remain pending.

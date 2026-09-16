# Economie-assistent — setup and operation

Use Node.js 22 or newer; the native SQLite and PDF dependencies require it.
Run commands below from `web/`.

## Local startup

```sh
npm ci
npm run seed
npm run dev -- --hostname 127.0.0.1
```

Open http://localhost:3000. Seeding imports all nine PDFs from `../data` through
the same ingestion code as uploads. It skips previously imported files by hash;
it does not erase the database. `DATA_DIR` overrides the PDF directory.

Configure a model-provider key under **Instellingen**, or copy `.env.example`
to a local `.env.local` and fill in the appropriate variable. Never commit keys.
The server resolves saved provider settings before environment defaults. No
provider key is bundled with this repository, and there are no sample answers
or successful-looking substitutes when a provider is unavailable.

SQLite, uploaded PDFs and saved settings live in `web/storage/`. `STORAGE_DIR`
selects a separate directory for testing or a demo. Preserve this directory
between restarts. Back up the database with SQLite's backup facilities and keep
its matching `files/` directory; do not copy a live WAL database without its
uncheckpointed changes. Saved API keys are plaintext in this local prototype.

## Workflow

- **Nieuwe vraag:** ask a Dutch question, optionally restrict the source scope,
  inspect the exact passages and PDF pages, then edit and approve the answer.
- **Bronnen:** upload a text PDF (at most 25 MiB), import a public PDF URL, edit
  metadata/applicability, disable a source or upload a replacement. Historical
  evidence remains available to older answers.
- **Geschiedenis:** reopen stored answers, verify citations, regenerate with
  current sources, copy with source references, create an editable email draft
  or print the officer briefing. Nothing is automatically sent.
- **Instellingen:** choose provider/model/effort per task and test it. Source
  summaries are generated after ingestion when the summary model is configured;
  the source page also offers a manual retry.
- **Logboek:** follow source and answer events with links to the actual records.

Hybrid retrieval requires an OpenAI credential. Use **Embeddings berekenen**
for existing sources before choosing **Hybride**. Newly ingested passages are
embedded automatically when that credential is available. Missing embedding
coverage produces an actionable error; switching to BM25 restores text-only
retrieval without a model call. Summaries never enter retrieval or answer prompts.

For **Lees voor**, select OpenAI or ElevenLabs under Instellingen. ElevenLabs
requires its own key and voice ID. If it fails and an OpenAI key is configured,
the server uses OpenAI's `alloy` voice. **Uit** always disables speech. Only the
stored reviewed text (or the original when unreviewed), without citation markers
and limited to 2,500 characters, is sent to the speech provider.

## Production build and checks

```sh
npx tsc --noEmit
npm run lint
npm run build -- --webpack
npm run start -- --hostname 127.0.0.1
```

Run destructive or fixture-based checks only with a temporary `STORAGE_DIR`.
The acceptance questions Q1–Q9 in `../PLAN.md` require real model calls and a
human review of the answers. HTTP/SDK fixtures establish protocol and storage
behavior, not answer quality or natural Dutch speech.

`OPENAI_BASE_URL` is honored by the installed SDKs for OpenAI-compatible test or
deployment endpoints. The separate **Aangepast** provider has its own configured
base URL and credentials. Keep model credentials server-side.

## Password-gated demo

Set `APP_PASSWORD` and a strong random `APP_SESSION_SECRET` in the server's local
environment before exposing it. An enabled password without a session secret
fails closed. Login issues an HttpOnly session cookie with a 12-hour server-side
expiry; changing the password or secret invalidates existing sessions.

The gate protects pages, JSON APIs, PDFs and streaming responses. Browser
mutations must be same-origin. Authenticated command-line clients may omit
`Origin`. Login attempts are limited separately; answer-generation POST routes
and speech share a token bucket of ten requests per minute.

For a Cloudflare tunnel, bind Next to `127.0.0.1` and set
`APP_TRUST_PROXY=cloudflare` only when the origin is reachable exclusively through
your local `cloudflared` connector. This opts into Cloudflare's client-IP and
forwarded HTTPS headers. Without it, untrusted forwarded IP headers are ignored
and requests use one conservative shared bucket. The in-memory limits reset on
restart and are intended for this single-process demo, not a server cluster.

Install `cloudflared` from the [official downloads](https://developers.cloudflare.com/tunnel/downloads/).
For an account-free quick tunnel, set `APP_STREAMING=off` on the Next server, then:

```sh
npm run start -- --hostname 127.0.0.1
```

In another terminal:

```sh
cloudflared tunnel --url http://127.0.0.1:3000
```

Check that the public address redirects to login and an unauthenticated
`/api/sources` returns 401 before sharing the URL and password with the jury.
Stop the connector to close public access.

Cloudflare [Quick Tunnels do not support SSE](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/#limitations).
`APP_STREAMING=off` makes the question page use the regular answer API before any
generation starts. It does not retry an interrupted generation. Leave the option
unset for streaming locally, or use a named tunnel/deployment that supports SSE.

## Limits and submission

The prototype handles text PDFs, not OCR, and does not determine current legal
validity. Officers maintain applicability and approve communications. Other
municipalities can change `MUNICIPALITY_NAME`, documents and model settings.

The recording script and architecture slide are in `../docs/`. Real-provider
acceptance, a final recorded video, YouTube publication and organiser-form
submission are separate deliverables; a successful build does not establish
that any of those steps happened. Supabase migration remains the plan's
post-event option, outside this SQLite implementation.

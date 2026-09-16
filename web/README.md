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

Configure a model-provider key under **Instellingen / Settings**, or copy `.env.example`
to a local `.env.local` and fill in the appropriate variable. Never commit keys.
The server resolves saved provider settings before environment defaults. No
provider key is bundled with this repository, and there are no sample answers
or successful-looking substitutes when a provider is unavailable.

The local file is **`web/.env.local`**, beside `package.json`:

```dotenv
OPENAI_API_KEY=your_openai_key
ELEVENLABS_API_KEY=your_optional_elevenlabs_key
```

Restart Next after changing this file. Keys saved through **Instellingen / Settings** take
effect immediately and override the corresponding environment key. OpenAI can
provide answers, embeddings, and speech. For speech, choose **OpenAI** under
**Voorlezen**; ElevenLabs is optional and needs its own key plus a voice ID.
An account with no API credits cannot generate answers even when its key is valid.

For local chat, keep `APP_STREAMING=on` and `APP_TRUST_PROXY=local`. The question
panel shows elapsed time while the model reasons, then streams answer text before
displaying the validated citations. Extra-high reasoning can take longer on larger
questions; sending the question again starts another independent request.

SQLite, uploaded PDFs and saved settings live in `web/storage/`. `STORAGE_DIR`
selects a separate directory for testing or a demo. Preserve this directory
between restarts. Back up the database with SQLite's backup facilities and keep
its matching `files/` directory; do not copy a live WAL database without its
uncheckpointed changes. Saved API keys are plaintext in this local prototype.

## Language and interface

Use **NL / EN** in the workspace header or on the login page. Dutch is the
default. The choice is saved for one year in the `ea_locale` cookie and applied
when the page loads, including the document language and locale-aware dates.
Interface labels, forms, loading and error messages, review controls, settings
and system activity descriptions follow the selected language.

New answers, email drafts and source summaries are generated in the selected
language. English questions also expand into Dutch search terms so the existing
Dutch source library can support English requests. This does not replace source
evidence: PDF text, quotations, document metadata and staff-written notes remain
as recorded. Switching the interface language does not rewrite saved answers,
email drafts or summaries; generate a new version to obtain different-language
output, then review it against the original passages.

The redesigned responsive workspace brings consistent navigation, source cards,
review panels, status badges and keyboard focus states across question handling,
source management, history and settings. Source verification and human approval
remain part of the same workflow in both languages.

## Workflow

- **Nieuwe vraag / New question:** ask a Dutch or English question, optionally restrict the source scope,
  inspect the exact passages and PDF pages, then edit and approve the answer.
- **Bronnen:** upload a text PDF (at most 25 MiB), import a public PDF URL, edit
  metadata/applicability, disable a source or upload a replacement. Historical
  evidence remains available to older answers.
- **Geschiedenis:** reopen stored answers, verify citations, regenerate with
  current sources, copy with source references, create an editable email draft
  or print the officer briefing. Nothing is automatically sent.
- **Instellingen:** choose provider/model/effort per task and test it. The default
  answer model is OpenAI `gpt-5.6-terra` with `medium` reasoning for faster replies.
  OpenAI reasoning calls reserve 12,000 output/reasoning tokens (25,000 at extra high) so the
  short visible-answer budget does not cut off reasoning before an answer. Source
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

Repeatable integration checks, from `web/`:

```sh
npm run verify:core
npm run verify:enrichment
npm run verify:settings
npm run verify:auth
npm run verify:http
```

`verify:http` requires the production build above. It starts its own loopback
server on port 3100, seeds disposable storage, tests the actual Proxy/routes,
and removes only its temporary files. Use `VERIFY_HTTP_PORT` for another port.
The other checks also use isolated storage. No funded API keys are required.

For real Q1–Q9 and scoped-Q3 evidence, start the normal app with a funded key,
then run `npm run acceptance -- --base-url http://127.0.0.1:3000`.
The runner writes JSON/Markdown into `storage/acceptance/`; read the answers
against PLAN.md before signing off semantic accuracy. See the runner's `--help`
for authentication. It does not change model settings or erase answers.

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

Alternatively, `npm run demo:tunnel` checks the running app's password gate,
public redirect, protected APIs/PDFs and loopback binding before opening the
tunnel. `npm run demo:tunnel -- --check` performs only that preflight. On Windows
it uses `%LOCALAPPDATA%/EconomieAssistent/bin/cloudflared.exe`; set
`CLOUDFLARED_BIN` to use an installation elsewhere. Provider keys are excluded
from the connector's environment.

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

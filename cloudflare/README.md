# Cloudflare jury workspace

This deployment builds the existing React interface as a Vite single-page application and serves it with Cloudflare Workers Static Assets. The Worker routes application requests through one SQLite-backed `JuryWorkspace` Durable Object, which runs the existing Next.js API handlers through small compatibility adapters.

The deployed Worker is `economie-assistent-jury`, available at [economie-assistent-jury.artiomvarvarenko.workers.dev](https://economie-assistent-jury.artiomvarvarenko.workers.dev). Judges can open this URL and enter directly: no password or account is required. The temporary bootstrap token has been removed from the deployed Worker and private secrets files.

## Architecture and persistence

- `frontend/` reuses the application components, English/Dutch translations, and styles from `../web/src/`. Vite replaces Next navigation with browser navigation.
- `worker.ts` applies request checks before serving pages or dispatching API requests. The jury workspace has no password gate; same-origin checks and request limits remain active. Public ingress supplies the client IP; the Worker reconstructs the trusted origin before forwarding to the Durable Object.
- `runtime-db.ts` adapts the application's synchronous SQLite calls to Durable Object SQL. Sources, passages, answers, citations, review state, events, embeddings, and settings remain in persistent SQL storage.
- `runtime-fs.ts` stores immutable PDF files as SQL metadata plus 512 KiB BLOB chunks. The original PDF version IDs remain usable by the existing file and citation routes.
- `next-server.ts` provides the request URL, cookies, JSON responses, redirects, and proxy continuation used by the API. `source-download.ts` uses bounded public-network fetches with manual redirect validation.

The `WORKSPACE` binding selects the singleton named `schoten-jury-workspace`. Keep that name, the `JuryWorkspace` class, and its migration history when updating this deployment. A normal code redeployment preserves its database and PDFs. It also preserves saved model settings. The deployed answer model is GPT-5.6 Luna (`gpt-5.6-luna`) with `medium` reasoning for faster replies. Text search (BM25) is enabled; calculate document embeddings before selecting hybrid search.

The configuration uses SQLite Durable Objects available on the Workers Free plan. It requires no R2 bucket or Cloudflare Containers. Account quotas still apply; this is a shared jury workspace, not a separate database per user. [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) describes the applicable Free plan limits.

## Build and ordinary redeployment

Use Node.js compatible with the installed Vite version and an authenticated Cloudflare account. Wrangler is pinned to **4.132.0** in this package. Install the web dependencies too: the Worker bundles the existing API libraries from `../web`.

From the repository root:

```powershell
cd web
npm ci
cd ../cloudflare
npm ci
npm run build
npx wrangler deploy
```

`npm run build` generates `build/worker.js` and `dist/client/`. `wrangler.jsonc` binds those assets and the Durable Object, enables `nodejs_compat` and `global_fetch_strictly_public`, and sets compatibility date `2026-09-16`. The public fetch flag keeps PDF downloads on public routing, including requests to the Worker's own zone. [Cloudflare compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public) explains this behavior.

For an existing jury workspace, the build and deploy commands above are sufficient. **Do not rerun bootstrap after jury edits.** Its row import uses replacement semantics and can overwrite newer remote answers, reviews, sources, or settings with the local snapshot. Do not delete or recreate the Durable Object to redeploy code.

## First deployment and one-time import

Run this sequence only for a new workspace. The local application must already have its intended database at `web/storage/app.db`, original PDFs, and provider credentials configured. OpenAI and ElevenLabs credentials stay in private files and Worker secrets; never paste their values into this document or a commit.

From `cloudflare/`, after installing both packages:

```powershell
node prepare-deploy.cjs
npm run build
npx wrangler deploy --secrets-file .private/secrets.json
```

`prepare-deploy.cjs` reads the local Next environment and a consistent SQLite snapshot. It writes:

- `.private/workspace.json`: the application rows, including saved model settings and any credentials stored in those settings.
- `.private/secrets.json`: configured provider credentials and a temporary `BOOTSTRAP_TOKEN`.
- `.dev.vars`: the same secrets for local Wrangler development.
- `.private/jury-access.txt`: direct-access instructions, with the URL filled in after a successful import.

Preparation leaves the jury workspace public and does not export or generate `APP_PASSWORD` or `APP_SESSION_SECRET`. For a separate password-protected deployment, configure both explicitly; leaving `APP_PASSWORD` unset or empty enables direct access. Treat preparation as an initialization step, since running it again replaces these private artifacts. None of these files belong in version control; `.gitignore` excludes `.private/` and `.dev.vars*`. Keep local snapshots, PDF evidence, and provider credentials private.

Replace the example origin below with the exact HTTPS `workers.dev` origin reported by Wrangler, without a trailing slash:

```powershell
node bootstrap.cjs https://economie-assistent-jury.YOUR-SUBDOMAIN.workers.dev
npx wrangler secret delete BOOTSTRAP_TOKEN
```

Bootstrap imports rows in batches, uploads the original PDF files, and rebuilds the full-text index. Wait for `Workspace import complete.` before deleting the token. **Delete `BOOTSTRAP_TOKEN` immediately after successful import** so the administrative import endpoints are disabled. Share the deployed URL with the jury; they can enter directly.

Wrangler can also upload an existing private secrets file separately:

```powershell
npx wrangler secret bulk .private/secrets.json
```

After initialization, remove `BOOTSTRAP_TOKEN` from any secrets file before uploading that file again; uploading the old file would enable the import endpoints again. Ordinary code redeployments do not require reuploading secrets or reimporting data. [Wrangler secrets commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret) document bulk updates and deletion; [uploading secrets with code](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code) documents the initial deployment option.

The local Next application remains available independently. Cloudflare uses its own persistent workspace after import; later local changes are not automatically synchronized to the jury deployment.

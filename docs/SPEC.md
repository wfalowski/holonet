# Holonet — Architecture Spec

Holonet is a **single-user personal ops console for scheduled AI news dispatches**. The user
defines cron tasks; each task runs a prompt against an LLM via **OpenRouter** (optionally with
live web search), formats the answer (digest / bullets / headlines), and relays it to a
**Discord webhook**. A dashboard shows upcoming dispatches, task management, integrations and an
activity log. The full visual design is in `design/Holonet.dc.html` (single source of truth for
the UI — a sci-fi terminal aesthetic, amber-on-dark, fonts Chakra Petch + JetBrains Mono).

## Stack

- **Runtime:** Node.js 22, ESM only (`"type": "module"`), TypeScript strict.
- **Server:** Hono (`hono`, `@hono/node-server`), REST JSON API under `/api`, serves the built
  React SPA statically.
- **DB:** PostgreSQL via `pg` (node-postgres) + `drizzle-orm` (+ `drizzle-kit` migrations, applied
  programmatically at boot via `migrate()`). Tests run the same migrations against
  `@electric-sql/pglite`, an in-memory Postgres, so no external DB is needed to run the suite.
- **Scheduler:** `croner` (cron parsing, next-run computation, in-process scheduling).
- **LLM:** OpenRouter chat-completions API (plain `fetch`, no SDK).
- **Frontend:** React 19 + Vite + TypeScript, `@tanstack/react-query`. No router — the design is
  a single screen with 4 switchable views (matches the design file exactly).
- **Validation:** Zod v4 everywhere; schemas shared between server and web via `packages/shared`.
- **Lint/format:** Biome. **Package manager:** pnpm workspaces.

## Repository layout

```
holonet/
├── apps/
│   ├── server/            # Hono API + scheduler + static hosting
│   │   ├── src/
│   │   │   ├── index.ts           # entry: config → migrate → scheduler.start → serve
│   │   │   ├── app.ts             # Hono app assembly (middleware, routes, static)
│   │   │   ├── config.ts          # zod-parsed env (fail fast)
│   │   │   ├── db/
│   │   │   │   ├── index.ts       # drizzle client factory
│   │   │   │   └── schema.ts      # tables: tasks, runs, models
│   │   │   ├── auth/
│   │   │   │   ├── middleware.ts  # session-cookie auth middleware
│   │   │   │   └── routes.ts      # POST /login, /logout, GET /me
│   │   │   ├── api/
│   │   │   │   ├── tasks.ts       # CRUD + toggle + run-now
│   │   │   │   ├── runs.ts        # activity log list
│   │   │   │   └── models.ts      # model catalog CRUD
│   │   │   ├── scheduler/
│   │   │   │   ├── scheduler.ts   # croner registry, rebuild on task change
│   │   │   │   └── executor.ts    # run pipeline: prompt → OpenRouter → Discord → run row
│   │   │   ├── services/
│   │   │   │   ├── openrouter.ts  # chat completion call (web plugin support)
│   │   │   │   └── discord.ts     # webhook dispatch (embeds, chunking)
│   │   │   └── logger.ts          # pino
│   │   ├── drizzle/               # generated SQL migrations (committed)
│   │   ├── drizzle.config.ts
│   │   └── package.json
│   └── web/               # React SPA (Vite)
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx            # auth gate → console
│       │   ├── api/client.ts      # typed fetch wrapper + query options
│       │   ├── views/             # Overview, Tasks, Integrations, Activity, Settings
│       │   ├── components/        # Rail, StatusBar, TaskDrawer, LoginScreen, chips…
│       │   └── lib/               # cron describe/countdown helpers (from shared)
│       └── package.json
├── packages/
│   └── shared/            # zod schemas, API types, cron utils
│       └── src/
│           ├── schemas.ts         # Task, TaskInput, Model, ModelInput, Run, auth payloads
│           └── cron.ts            # describe(cron) → {ok, tag, text} (port from design file)
├── design/Holonet.dc.html # imported design reference
├── docs/SPEC.md
├── Dockerfile
├── docker-compose.yml
├── .github/workflows/ci.yml      # lint + typecheck + test + build
├── .github/workflows/docker.yml  # build & push image to GHCR
├── biome.json
├── pnpm-workspace.yaml
└── package.json
```

Package names: `@holonet/server`, `@holonet/web`, `@holonet/shared`.
Root scripts (used by CI and agents — keep these exact names):
`pnpm check` (biome check .), `pnpm typecheck` (recursive tsc --noEmit),
`pnpm test` (recursive node --test), `pnpm build` (shared → web → server), `pnpm dev`.

## Environment (all read in `config.ts`, zod-parsed, fail fast)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `APP_KEY` | yes | — | The single auth credential. Min 16 chars enforced. |
| `OPENROUTER_API_KEY` | yes | — | OpenRouter bearer token. |
| `SESSION_SECRET` | no | sha256(APP_KEY + ":holonet-session") hex | HMAC key for signed cookie. |
| `DATABASE_URL` | no | `postgres://holonet:holonet@localhost:5432/holonet` | Postgres connection string. |
| `PORT` | no | `3000` | HTTP port. |
| `COOKIE_SECURE` | no | `false` | Set `true` behind TLS. |
| `TRUST_PROXY` | no | `false` | Trust X-Forwarded-For for client IP (set true only behind a reverse proxy). |
| `TZ` | no | system | Cron schedules interpret in this zone (croner default). |

`.env.example` documents all of these.

## Authentication

Single-user, `APP_KEY`-only:

- `POST /api/auth/login` body `{ key: string }`. Compare against `APP_KEY` with
  `crypto.timingSafeEqual` (hash both sides to equal length first). On success set a **signed
  cookie** via hono `setSignedCookie(c, "holonet_session", payload, SESSION_SECRET, …)` with
  `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` per `COOKIE_SECURE`, `Max-Age` 30 days.
  Payload: JSON `{ iat: <epoch ms> }` — validity = iat within 30 days.
- In-memory rate limit on login: max 5 failures per IP per 15 min → 429.
- `POST /api/auth/logout` clears the cookie. `GET /api/auth/me` → `{ authenticated: boolean }`
  (this one is NOT behind the auth middleware; it reports status).
- `authMiddleware` guards everything under `/api` except `/api/auth/*` and `/healthz`.
  Unauthenticated → `401 { error: { code: "UNAUTHORIZED" } }`.
- The SPA shows a login screen (same visual language as the design) until `/me` says authenticated.

No `better-auth` dependency — for one static key it adds surface without value; a signed cookie
via Hono's built-in helper is the consistent minimal implementation. (Documented in README.)

## Database schema (drizzle, PostgreSQL)

```ts
// tasks
id          uuid pk default gen_random_uuid()
name        text notnull
cron        text notnull          // 5-field cron expression
prompt      text notnull
model       text notnull          // OpenRouter model id, e.g. "anthropic/claude-sonnet-4.5"
webSearch   boolean notnull default true
enabled     boolean notnull default true
webhookUrl  text notnull          // Discord webhook URL
channel     text notnull          // display-only channel name (no '#')
dedupe      boolean notnull default true
format      text notnull default 'digest'   // 'digest' | 'bullets' | 'headlines'
sources     jsonb notnull default '[]'      // string[]
createdAt   timestamp with time zone notnull
updatedAt   timestamp with time zone notnull

// runs (activity log; survives task deletion via denormalized name)
id          uuid pk default gen_random_uuid()
taskId      uuid nullable references tasks.id on delete set null
taskName    text notnull
channel     text notnull
status      text notnull          // 'ok' | 'fail'
message     text notnull          // e.g. "digest compiled · 5 items relayed" / error summary
durationMs  integer notnull
createdAt   timestamp with time zone notnull
-- index runs(createdAt desc), index runs(taskId)

// models (editable inference model catalog; seeded by migration)
id          uuid pk default gen_random_uuid()
modelId     text notnull unique   // OpenRouter id, e.g. "anthropic/claude-sonnet-4.5"
label       text notnull          // display label, e.g. "SONNET 4.5"
family      text notnull          // group heading, e.g. "ANTHROPIC"
createdAt   timestamp with time zone notnull default now()
```

Server code maps DB rows to the API contract at the boundary (`api/serialize.ts`): timestamps
are exposed as epoch ms, `sources` as `string[]`, exactly per the `@holonet/shared` zod schemas
— the HTTP API and frontend are unaffected by the underlying DB engine.

## API contract (all JSON; zod schemas in `@holonet/shared`)

Success envelope: plain resource JSON. Error envelope: `{ error: { code, message } }` with
proper status. Codes: `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION`, `RATE_LIMITED`, `INTERNAL`.

- `GET  /healthz` → `{ ok: true }` (no auth, no DB).
- `POST /api/auth/login` `{ key }` → 204. `POST /api/auth/logout` → 204.
  `GET /api/auth/me` → `{ authenticated }`.
- `GET  /api/tasks` → `Task[]` — each Task = DB row (sources as string[], booleans as booleans)
  **plus computed** `nextRunAt: number | null` (epoch ms, null when disabled/invalid) and
  `lastRun: { at: number, status: 'ok'|'fail' } | null` (from latest run row).
- `POST /api/tasks` `TaskInput` → `Task` (201).
- `PUT  /api/tasks/:id` `TaskInput` → `Task`.
- `DELETE /api/tasks/:id` → 204.
- `POST /api/tasks/:id/toggle` → `Task` (flip enabled, reschedule).
- `POST /api/tasks/:id/run` → `Run` (202-style: executes immediately, awaits completion, returns
  the run row; concurrent duplicate run of same task → 409 `CONFLICT`).
- `GET  /api/runs?limit=80` → `Run[]` ordered createdAt desc (limit 1..200, default 80).
- `GET  /api/models` → `Model[]` ordered by family/label; each entry carries
  `inUse` (count of tasks bound to it).
- `POST /api/models` `ModelInput` → `Model` (201); duplicate modelId → 409 `CONFLICT`.
- `PATCH /api/models/:id` `{ label, family }` → `Model` (modelId immutable).
- `DELETE /api/models/:id` → 204; 409 `CONFLICT` while any task uses it.

`TaskInput` (zod): `name` 1..80 trimmed; `cron` must parse (validate with croner);
`prompt` min 4; `model` must match the OpenRouter id shape (`vendor/model`) and exist in the
`models` table (server-checked); `webSearch`, `enabled`, `dedupe`
booleans; `webhookUrl` must match `^https://discord(app)?\.com/api/webhooks/.+`; `channel`
trimmed, leading `#` stripped, default `"general"`; `format` enum; `sources` string[] (max 20,
each 1..60).

## Model catalog (DB-backed)

The inference model catalog lives in the `models` table and is managed from the
Settings view (`/api/models` CRUD). The initial migration seeds: SONNET 4.5,
OPUS 4.1 (ANTHROPIC), GROK 4, GROK 3 (xAI). A model referenced by a task cannot
be deleted. Shared zod schemas: `ModelSchema`, `ModelInputSchema`,
`ModelUpdateSchema`, id shape `MODEL_ID_RE`.

## Scheduler & executor (critical path)

- `scheduler.ts` keeps a `Map<taskId, Cron>` of croner jobs. `start()` loads all enabled tasks;
  `sync(task)` / `remove(taskId)` called from the API layer after every mutation. Croner options:
  `{ protect: true }` (no overlapping runs of the same task), catch-up on missed runs **disabled**
  (restart schedules from now — documented).
- Executor pipeline (`executor.ts`), one run:
  1. Guard: per-task in-flight lock (also covers run-now vs cron collision) → skip/409.
  2. Build messages: system prompt encodes the task's output contract — format
     (digest = one tight digest paragraph + linked items; bullets = concise bullet list;
     headlines = plain headline lines), `dedupe` instruction when set, priority `sources` list,
     "cite source links", Discord-markdown-friendly, hard cap ~1800 chars guidance. User message
     = task.prompt.
  3. Call OpenRouter `POST https://openrouter.ai/api/v1/chat/completions` with
     `{ model, messages, plugins: webSearch ? [{ id: "web" }] : undefined }`,
     `Authorization: Bearer`, 120 s timeout via `AbortSignal.timeout`. Non-2xx or empty content
     → fail.
  4. Post to Discord webhook: embed `{ title: task.name, description: content }`; split into
     multiple embeds/messages at 4000-char boundaries (split on newline). `?wait=true` to get
     confirmation. Non-2xx → fail.
  5. Insert run row: ok → message like `"digest compiled · relayed to #<channel>"`; fail →
     truncated error summary (never the API key). Duration measured around steps 3–4.
- Failures never crash the process; they are logged (pino) + recorded as run rows.
- Graceful shutdown: SIGTERM/SIGINT → stop croner jobs, close server, close DB.

## Frontend (port `design/Holonet.dc.html` faithfully)

- **Read the design file first**; replicate structure, spacing, colors, animations (scanlines,
  pulse, blink, slidein, flick), fonts (Google Fonts link in index.html), exact palette
  (AMBER #ffb347, OK #5fe3a1, BAD #ff5d6c, DIM #5c6678, HI #e9edf4, bg #080a0e).
- Inline style objects are acceptable and preferred where the design uses them; shared keyframes
  and resets go in a global `styles.css`.
- Views: Overview (4 stat cards, upcoming dispatches, activity feed preview), Cron Tasks (filter
  tabs all/active/paused, table rows with run-now / toggle / edit), Integrations (Discord card
  with live counts + Slack/Telegram "coming soon"), Activity (full log), Settings (inference model
  catalog: list with edit/remove + in-use counts, add-model form). Left rail nav with
  counts, status bar with active count, next dispatch and live clock (1 s tick).
- Compose drawer (new/edit): callsign, cron input + 6 presets + live human description
  (shared `describeCron`), directive textarea, model grid (from /api/models), tools list
  (WEB SEARCH toggleable; RSS/URL FETCH locked), format tabs, dedupe checkbox, priority source
  chips (Enter adds), Discord webhook + channel inputs, enabled toggle, PURGE (edit only,
  with a confirm), DEPLOY/UPDATE. Validation errors as in design (callsign/cron/prompt).
- Data: TanStack Query (`['tasks']`, `['runs']`, `['models']`), refetchInterval 15 s; countdowns/clock tick
  locally off `nextRunAt`. Mutations invalidate both keys. 401 from any request → flip to login.
- Login screen: same aesthetic — HOLONET emblem, "ACCESS KEY" password input, error state on 401,
  rate-limit message on 429.
- Overview stats derived client-side: active tasks, dispatches last 24 h (from runs),
  next dispatch, relay status.

## Prompt engineering module

A sixth surface for iterating on prompts outside the scheduled-task flow: a library with
versioning and folders/tags, an output-schema builder, a playground for one-off runs, and an
in-process A/B experiment runner comparing prompt versions × models.

### Database schema (additions)

```ts
// prompt_folders
id          uuid pk default gen_random_uuid()
name        text notnull unique
createdAt   timestamp with time zone notnull

// schemas (Drizzle export: outputSchemas)
id          uuid pk default gen_random_uuid()
name        text notnull
fields      jsonb notnull default '[]'   // SchemaField[] — source of truth;
                                          // JSON Schema is always derived via fieldsToJsonSchema
createdAt   timestamp with time zone notnull
updatedAt   timestamp with time zone notnull

// prompts
id          uuid pk default gen_random_uuid()
name        text notnull
folderId    uuid nullable references prompt_folders.id on delete set null
tags        jsonb notnull default '[]'   // string[]
schemaId    uuid nullable references schemas.id on delete set null
createdAt   timestamp with time zone notnull
updatedAt   timestamp with time zone notnull

// prompt_versions (immutable — created, never edited)
id          uuid pk default gen_random_uuid()
promptId    uuid notnull references prompts.id on delete cascade
version     integer notnull
content     text notnull
note        text nullable
createdAt   timestamp with time zone notnull
-- unique index (promptId, version)

// experiments
id          uuid pk default gen_random_uuid()
promptId    uuid nullable references prompts.id on delete set null
promptName  text notnull          // denormalized — survives prompt deletion
status      text notnull          // 'running' | 'done' | 'failed'
createdAt   timestamp with time zone notnull
finishedAt  timestamp with time zone nullable

// experiment_results (one row per version × model cell)
id            uuid pk default gen_random_uuid()
experimentId  uuid notnull references experiments.id on delete cascade
versionId     uuid notnull        // plain uuid, no FK — prompt_versions may be deleted independently
versionNumber integer notnull     // denormalized — display survives version/prompt deletion
modelId       text notnull
status        text notnull default 'pending'   // 'pending' | 'ok' | 'fail'
output        text notnull default ''
errorMessage  text nullable
durationMs    integer notnull default 0
tokensIn      integer nullable
tokensOut     integer nullable
costUsd       text nullable        // numeric string, from OpenRouter usage.cost
winner        boolean notnull default false
-- index experiment_results(experimentId)
```

`prompts.folderId` and `prompts.schemaId` are `set null` on delete — removing a folder or schema
never deletes the prompts that reference it. `prompt_versions` cascades on prompt delete (they
have no independent lifecycle). `experiment_results.versionId` is deliberately a plain UUID with
no foreign key: an experiment is a historical record of a comparison, and a prompt version may be
edited away (new version) or the whole prompt deleted after the experiment runs — the denormalized
`versionNumber` keeps results readable regardless.

### API contract (additions, all behind `authMiddleware`)

- `GET/POST /api/folders`, `PATCH/DELETE /api/folders/:id` — CRUD; each entry carries a
  prompt-count; duplicate name → 409 `CONFLICT`.
- `GET/POST /api/prompts` (list supports `?folderId=`, `?tag=`, `?q=` query params, filtered
  in-process — single-user scale), `GET /api/prompts/:id` (includes all versions),
  `PATCH /api/prompts/:id` (metadata only), `DELETE /api/prompts/:id`,
  `POST /api/prompts/:id/versions` (creates the next immutable version, auto-increments),
  `POST /api/prompts/:id/optimize` (calls an optimizer model to rewrite a version's content for a
  target model/family; response is not persisted — caller decides whether to save it as a new
  version).
- `GET/POST/PATCH/DELETE /api/schemas` — CRUD on the field-tree output-schema documents; each
  entry carries a count of prompts attached.
- `POST /api/playground/run` — one-off completion against a chosen model, optionally with a
  schema-derived strict `json_schema` response format; when a schema is attached the response is
  parsed and validated against the field tree (`validateFields`), returning `{ valid, errors }`.
- `GET/POST /api/experiments`, `GET /api/experiments/:id` (includes per-cell results),
  `PATCH /api/experiments/:id/results/:rid` `{ winner: boolean }` — marks a cell as the winner for
  that version/model pairing. `POST /api/experiments` validates that all requested version ids
  belong to the given prompt and all requested model ids exist in the catalog before creating the
  experiment row and one `pending` `experiment_results` row per version × model cell, then starts
  the runner and returns immediately with `results: []` (the grid populates on first poll).

### Experiment runner (`scheduler/experimentRunner.ts`)

- In-process, no queue/worker infra: `runner.start(id)` fires `run(id)` and lets it run in the
  background (fire-and-forget with a caught/logged rejection); `runner.run(id)` is also exposed
  directly for tests and boot recovery.
- Concurrency 3: pending cells are pulled off a shared queue by three concurrent workers
  (`Promise.all` over `CONCURRENCY` worker loops).
- Each cell resolves its prompt version's content and, if the experiment's prompt has an attached
  schema, a shared strict `json_schema` response format (built once per run, not per cell) via
  `schemaResponseFormat`. A version that no longer exists (deleted mid-run) marks the cell `fail`
  with `"prompt version no longer exists"` without calling OpenRouter.
- **Per-cell failures do not fail the experiment.** Every cell transitions to `ok` or `fail`
  independently; once the queue drains the experiment row is unconditionally set to `status: done`
  (`finishedAt` stamped), even if every cell failed. The `failed` experiment status is never set by
  `run()` — it is reserved exclusively for `recoverInterruptedExperiments`, called once at server
  boot: any experiment still `running` (meaning the process died mid-run) has its still-`pending`
  cells marked `fail` (`"interrupted by restart"`) and the experiment marked `failed`. There is no
  resume — a restart always concludes an in-flight experiment as failed, honestly, rather than
  leaving a zombie `running` row.

### OpenRouter integration (additions)

`services/openrouter.ts` adds a second call path alongside the scheduler's existing `chatComplete`:

- `chatCompleteDetailed({ apiKey, model, messages, responseFormat?, signal? })` — used by the
  playground and experiment runner. Always sends a single `user`-role message (no system prompt),
  requests `usage: { include: true }` for token/cost accounting, and optionally passes a strict
  `json_schema` `response_format`. **The web-search plugin is never used on this path** — that's a
  scheduled-task-only concern. Returns `{ content, tokensIn, tokensOut, costUsd }`; `costUsd` is a
  numeric string (or `null`) taken directly from OpenRouter's `usage.cost`.
- `schemaResponseFormat(name, fields)` derives the strict `json_schema` response format from a
  schema document's `fields` via `fieldsToJsonSchema`.
- The prompt optimizer (`POST /api/prompts/:id/optimize`) is a separate, simpler path: it calls
  the existing `chatComplete` (webSearch always `false`), not `chatCompleteDetailed` — it wants
  the rewritten prompt text, not usage accounting.

### Shared contract (`@holonet/shared`)

- `fieldsToJsonSchema(fields: SchemaField[])` — deterministic derivation of a JSON Schema object
  from the field-tree builder representation (`packages/shared/src/jsonSchema.ts`). The `fields`
  jsonb column is always the source of truth; JSON Schema is never stored, only derived on demand.
- `validateFields(fields, value, path?)` — validates a parsed JSON value against the same field
  tree, returning human-readable error strings (used by the playground's validation panel).
- `lineDiff(before, after)` — simple LCS line diff (`packages/shared/src/diff.ts`) used by the
  version history view to render add/del/same lines between two prompt versions.
- Zod schemas for every request/response shape above (`FolderInputSchema`, `PromptInputSchema`,
  `PromptMetaUpdateSchema`, `PromptVersionInputSchema`, `OptimizeInputSchema`,
  `SchemaDocInputSchema`, `PlaygroundRunInputSchema`, `ExperimentInputSchema`, …) live in
  `packages/shared/src/schemas.ts` / `prompting.ts` alongside the existing Task/Model/Run schemas.

### Frontend

- A sixth Rail view, **PROMPTS**, alongside Overview/Tasks/Integrations/Activity/Settings, with
  three internal tabs (`apps/web/src/views/prompts/PromptsView.tsx`): **LIBRARY** (folders, tags,
  search, prompt drawer with version history/diff/restore-as-new-version, optimizer modal),
  **EXPERIMENTS** (list + compose modal picking a prompt, up to 10 versions and up to 10 models;
  detail modal renders a version × model grid, marking winners, viewing full cell output), and
  **SCHEMAS** (field-tree builder, playground test-run modal with live validation).
- The experiment detail query polls every 5 s while `status === "running"` and stops polling once
  the experiment reaches a terminal status (`done` or `failed`), so the grid fills in live as cells
  complete without the user refreshing.

## Docker & CI

- **Dockerfile** multi-stage: `node:22-alpine` + corepack pnpm; stage 1 install+build all
  workspaces; stage 2 `pnpm deploy --filter @holonet/server --prod`; runtime copies server
  deploy dir, `apps/server/drizzle/` migrations and `apps/web/dist` (served path resolved via
  env `STATIC_DIR`, default `../web-dist` relative or absolute `/app/public`). Non-root user,
  `EXPOSE 3000`, healthcheck curl `/healthz`. The DB no longer lives in the app container — no
  volume, no `DATABASE_PATH`.
- **docker-compose.yml**: app service, image from GHCR (`ghcr.io/<owner>/holonet:latest`) with
  `build:` fallback, env from `.env` plus `DATABASE_URL` pointing at the compose-internal
  `postgres` service, `depends_on: postgres: condition: service_healthy`; a `postgres:17-alpine`
  service with `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB=holonet`, volume
  `holonet-pgdata:/var/lib/postgresql/data`, `pg_isready` healthcheck. Both services
  `restart: unless-stopped`.
- **CI (`ci.yml`)**: on PR + push main — pnpm install (frozen lockfile), `check`, `typecheck`,
  `test`, `build`.
- **Docker (`docker.yml`)**: on push main + tags `v*` — buildx, login GHCR with `GITHUB_TOKEN`,
  push tags `latest` (main), `sha-<short>`, semver on tags. `permissions: packages: write`.

## Conventions

- Biome defaults (2-space, double quotes), organize imports.
- No `any`, no enums (string-literal unions / `as const`), validate at IO boundaries only.
- Server logs: pino, one line per event, never log APP_KEY/OPENROUTER key/webhook tokens.
- Tests: `node:test` for shared cron describe/parse, auth session helpers, executor prompt
  building + Discord chunking. The tasks API integration test runs the committed migrations
  against an in-memory `@electric-sql/pglite` instance — no external Postgres needed.

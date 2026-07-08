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
- **DB:** SQLite via `better-sqlite3` + `drizzle-orm` (+ `drizzle-kit` migrations, applied
  programmatically at boot via `migrate()`).
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
│   │   │   │   └── schema.ts      # tables: tasks, runs
│   │   │   ├── auth/
│   │   │   │   ├── middleware.ts  # session-cookie auth middleware
│   │   │   │   └── routes.ts      # POST /login, /logout, GET /me
│   │   │   ├── api/
│   │   │   │   ├── tasks.ts       # CRUD + toggle + run-now
│   │   │   │   └── runs.ts        # activity log list
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
│       │   ├── views/             # Overview, Tasks, Integrations, Activity
│       │   ├── components/        # Rail, StatusBar, TaskDrawer, LoginScreen, chips…
│       │   └── lib/               # cron describe/countdown helpers (from shared)
│       └── package.json
├── packages/
│   └── shared/            # zod schemas, API types, cron utils, model catalog
│       └── src/
│           ├── schemas.ts         # Task, TaskInput, Run, auth payloads
│           ├── models.ts          # model catalog (OpenRouter ids + labels)
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
| `DATABASE_PATH` | no | `./data/holonet.db` | SQLite file (dir auto-created). |
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

## Database schema (drizzle, SQLite)

```ts
// tasks
id          text pk               // crypto.randomUUID()
name        text notnull
cron        text notnull          // 5-field cron expression
prompt      text notnull
model       text notnull          // OpenRouter model id, e.g. "anthropic/claude-sonnet-4.5"
webSearch   integer(boolean) notnull default true
enabled     integer(boolean) notnull default true
webhookUrl  text notnull          // Discord webhook URL
channel     text notnull          // display-only channel name (no '#')
dedupe      integer(boolean) notnull default true
format      text notnull default 'digest'   // 'digest' | 'bullets' | 'headlines'
sources     text notnull default '[]'       // JSON array of strings
createdAt   integer(timestamp_ms) notnull
updatedAt   integer(timestamp_ms) notnull

// runs (activity log; survives task deletion via denormalized name)
id          text pk
taskId      text nullable references tasks.id on delete set null
taskName    text notnull
channel     text notnull
status      text notnull          // 'ok' | 'fail'
message     text notnull          // e.g. "digest compiled · 5 items relayed" / error summary
durationMs  integer notnull
createdAt   integer(timestamp_ms) notnull
-- index runs(createdAt desc), index runs(taskId)
```

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

`TaskInput` (zod): `name` 1..80 trimmed; `cron` must parse (validate with croner);
`prompt` min 4; `model` must be in the shared model catalog; `webSearch`, `enabled`, `dedupe`
booleans; `webhookUrl` must match `^https://discord(app)?\.com/api/webhooks/.+`; `channel`
trimmed, leading `#` stripped, default `"general"`; `format` enum; `sources` string[] (max 20,
each 1..60).

## Model catalog (`packages/shared/src/models.ts`)

```ts
export const MODELS = [
  { id: "anthropic/claude-sonnet-4.5", label: "SONNET 4.5", family: "ANTHROPIC" },
  { id: "anthropic/claude-opus-4.1",   label: "OPUS 4.1",   family: "ANTHROPIC" },
  { id: "x-ai/grok-4",                 label: "GROK 4",     family: "xAI" },
  { id: "x-ai/grok-3",                 label: "GROK 3",     family: "xAI" },
] as const;
```

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
  with live counts + Slack/Telegram "coming soon"), Activity (full log). Left rail nav with
  counts, status bar with active count, next dispatch and live clock (1 s tick).
- Compose drawer (new/edit): callsign, cron input + 6 presets + live human description
  (shared `describeCron`), directive textarea, model grid (from shared catalog), tools list
  (WEB SEARCH toggleable; RSS/URL FETCH locked), format tabs, dedupe checkbox, priority source
  chips (Enter adds), Discord webhook + channel inputs, enabled toggle, PURGE (edit only,
  with a confirm), DEPLOY/UPDATE. Validation errors as in design (callsign/cron/prompt).
- Data: TanStack Query (`['tasks']`, `['runs']`), refetchInterval 15 s; countdowns/clock tick
  locally off `nextRunAt`. Mutations invalidate both keys. 401 from any request → flip to login.
- Login screen: same aesthetic — HOLONET emblem, "ACCESS KEY" password input, error state on 401,
  rate-limit message on 429.
- Overview stats derived client-side: active tasks, dispatches last 24 h (from runs),
  next dispatch, relay status.

## Docker & CI

- **Dockerfile** multi-stage: `node:22-alpine` + corepack pnpm; stage 1 install+build all
  workspaces; stage 2 `pnpm deploy --filter @holonet/server --prod` (native better-sqlite3 needs
  build deps in the build stage only); runtime copies server deploy dir, `apps/server/drizzle/`
  migrations and `apps/web/dist` (served path resolved via env `STATIC_DIR`, default
  `../web-dist` relative or absolute `/app/public`). Non-root user, `VOLUME /data`,
  `DATABASE_PATH=/data/holonet.db`, `EXPOSE 3000`, healthcheck curl `/healthz`.
- **docker-compose.yml**: single service, image from GHCR (`ghcr.io/<owner>/holonet:latest`) with
  `build:` fallback, env from `.env`, volume `holonet-data:/data`, restart unless-stopped.
- **CI (`ci.yml`)**: on PR + push main — pnpm install (frozen lockfile), `check`, `typecheck`,
  `test`, `build`.
- **Docker (`docker.yml`)**: on push main + tags `v*` — buildx, login GHCR with `GITHUB_TOKEN`,
  push tags `latest` (main), `sha-<short>`, semver on tags. `permissions: packages: write`.

## Conventions

- Biome defaults (2-space, double quotes), organize imports.
- No `any`, no enums (string-literal unions / `as const`), validate at IO boundaries only.
- Server logs: pino, one line per event, never log APP_KEY/OPENROUTER key/webhook tokens.
- Tests: `node:test` for shared cron describe/parse, auth session helpers, executor prompt
  building + Discord chunking. No test DB harness needed beyond in-memory SQLite.

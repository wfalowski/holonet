# Prompt Engineering Module (PROMPTS) — Design

**Date:** 2026-07-09
**Status:** Approved design, pre-implementation
**Scope:** One implementation cycle covering all four sub-features.

## Overview

A new module in the Holonet console for authoring, organizing, optimizing, and testing
prompts. Four sub-features share one foundation (the prompt library and the OpenRouter
call path):

1. **Prompt Library** — prompts organized in flat folders with free-form tags; immutable
   content versioning.
2. **Prompt Optimizer** — LLM-driven rewrite of a prompt version targeted at a specific
   model family, presented as a diff for manual accept.
3. **A/B Testing (Experiments)** — run selected prompt versions against selected models
   concurrently; results fill a version × model grid; manual winner marking.
4. **Structured Output Builder (Schemas)** — visual JSON-Schema builder with live
   preview and a live test panel using OpenRouter `response_format: json_schema` plus
   server-side validation.

The module is self-contained: it does **not** touch the cron-task pipeline. Tasks keep
their own `prompt` column; there is no DB relation between tasks and library prompts.

Explicitly out of scope (deliberate YAGNI): prompt variables/placeholders, LLM-as-judge
scoring, linking library prompts to cron tasks, folder hierarchy, SSE/streaming.

## Data model

Six new tables in `apps/server/src/db/schema.ts`, following existing conventions
(uuid PKs via `defaultRandom()`, `timestamp(..., { withTimezone: true })`, `jsonb` with
`$type<>`), with a generated Drizzle migration.

### `prompt_folders`

| column | type | notes |
|---|---|---|
| id | uuid PK | defaultRandom |
| name | text | not null, unique |
| createdAt | timestamptz | not null |

Flat list — no nesting.

### `prompts`

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | not null |
| folderId | uuid FK → prompt_folders | nullable, `onDelete: set null` |
| tags | jsonb string[] | not null, default `[]` |
| schemaId | uuid FK → schemas | nullable, `onDelete: set null` — optional attached output schema |
| createdAt / updatedAt | timestamptz | not null |

Metadata (name, folder, tags, schema attachment) is editable without creating a version.

### `prompt_versions`

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| promptId | uuid FK → prompts | not null, `onDelete: cascade` |
| version | integer | not null; unique `(promptId, version)`; starts at 1 |
| content | text | not null |
| note | text | nullable (e.g. "optimized for anthropic/claude-sonnet-4.5") |
| createdAt | timestamptz | not null |

Versions are **immutable**. Every content save creates the next version number.
"Restore v2" copies v2's content as a new head version. Version numbers are assigned
server-side as `max(version) + 1` inside the insert transaction.

### `experiments`

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| promptId | uuid FK → prompts | nullable, `onDelete: set null` |
| promptName | text | not null — denormalized, survives prompt deletion (same pattern as `runs.taskName`) |
| status | text | `'running' \| 'done' \| 'failed'` |
| createdAt | timestamptz | not null |
| finishedAt | timestamptz | nullable |

`failed` is reserved for experiments interrupted by a server restart (see Runner). An
experiment whose individual calls fail still ends `done` with per-cell errors.

### `experiment_results`

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| experimentId | uuid FK → experiments | not null, `onDelete: cascade` |
| versionId | uuid | not null — no FK cascade needed beyond experiment lifetime |
| versionNumber | integer | not null — denormalized for display |
| modelId | text | not null — OpenRouter id, `vendor/model` |
| status | text | `'pending' \| 'ok' \| 'fail'` |
| output | text | not null, default `''` |
| errorMessage | text | nullable |
| durationMs | integer | not null, default 0 |
| tokensIn / tokensOut | integer | nullable — from OpenRouter `usage` |
| costUsd | text (numeric string) | nullable — from OpenRouter `usage.cost` |
| winner | boolean | not null, default false — manual marking |

Index on `experimentId`.

### `schemas`

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| name | text | not null |
| fields | jsonb | not null — recursive builder field tree (source of truth) |
| createdAt / updatedAt | timestamptz | not null |

The JSON Schema document is **derived**, never stored: `fieldsToJsonSchema(fields)` is
deterministic and lives in `@holonet/shared` so both server (request `response_format`,
response validation) and web (live preview) compute it identically.

## Shared contracts (`packages/shared/src/schemas.ts` + new `promptSchemas.ts` if size warrants)

Zod schemas, exported through the barrel:

- `FolderSchema`, `FolderInputSchema` (`{ name }`)
- `PromptSchema` (row + `headVersion` number + `versionCount`), `PromptInputSchema`
  (`{ name, folderId?, tags, schemaId?, content }` — content seeds v1),
  `PromptMetaUpdateSchema` (name/folderId/tags/schemaId, all optional)
- `PromptVersionSchema`, `PromptVersionInputSchema` (`{ content, note? }`)
- `OptimizeInputSchema` (`{ versionId, targetModelId, optimizerModelId }`),
  `OptimizeOutputSchema` (`{ improved, rationale }`)
- `ExperimentInputSchema` (`{ promptId, versionIds: uuid[] (1–10), modelIds: string[] (1–10) }`),
  `ExperimentSchema`, `ExperimentResultSchema`
- `SchemaFieldSchema` — recursive (`z.lazy`):
  `{ name, type: 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array', description?, required, enumValues? (type=enum), children? (type=object), items? (type=array) }`
- `SchemaDocSchema` (`{ id, name, fields, createdAt, updatedAt }`), `SchemaDocInputSchema`
- `PlaygroundRunInputSchema` (`{ content, modelId, schemaId? }`),
  `PlaygroundRunOutputSchema` (`{ output, durationMs, tokensIn?, tokensOut?, costUsd?, validation?: { valid, errors: string[] } }`)

New shared utility **`fieldsToJsonSchema(fields: SchemaField[]): JsonSchemaObject`** —
pure function producing a draft JSON Schema object (`type: "object"`, `properties`,
`required`, `additionalProperties: false`, recursion for object/array/enum). Unit-tested
with `node:test`.

Validation-at-IO-boundaries rule holds: server routes validate request bodies with these
schemas; internals use inferred types. No `any`, string-literal unions (not enums).

## Server

### OpenRouter service extension (`apps/server/src/services/openrouter.ts`)

Add `chatCompleteDetailed(options)` returning
`{ content: string, tokensIn?: number, tokensOut?: number, costUsd?: string }`:

- accepts optional `responseFormat?: { type: "json_schema"; json_schema: { name: string; strict: true; schema: object } }`
- sends `usage: { include: true }` to get token/cost accounting back
- same 120 s timeout / abort merging / error hygiene as `chatComplete`

Existing `chatComplete` signature is **unchanged** (the task executor keeps using it);
it may delegate to the detailed variant internally.

### Routes (new files under `apps/server/src/api/`, registered in `app.ts` under the auth middleware)

- **`folders.ts`** — `GET /api/folders` (with prompt counts), `POST`, `PATCH /:id`,
  `DELETE /:id` (prompts fall back to folderless via `set null`).
- **`prompts.ts`** —
  - `GET /api/prompts` — query params `folderId`, `tag`, `q` (name substring); returns
    prompts with `headVersion`, `versionCount`, `updatedAt`.
  - `POST /api/prompts` — creates prompt + version 1 in one transaction.
  - `GET /api/prompts/:id` — prompt + all versions (descending).
  - `PATCH /api/prompts/:id` — metadata only.
  - `POST /api/prompts/:id/versions` — inserts next version, bumps `prompts.updatedAt`.
  - `DELETE /api/prompts/:id` — cascades versions.
  - `POST /api/prompts/:id/optimize` — validates version belongs to prompt, both model
    ids exist in the `models` catalog; builds the optimizer meta-prompt; calls
    `chatComplete` with the optimizer model; returns `{ improved, rationale }`.
    **Persists nothing** — accepting the result is a normal `POST /versions` from the client.
- **`experiments.ts`** — `POST /api/experiments` (validate prompt/version/model ids →
  insert experiment `running` + all `pending` result rows in one transaction → kick the
  runner → respond immediately with the experiment), `GET /api/experiments`,
  `GET /api/experiments/:id` (with results), `PATCH /api/experiments/:id/results/:rid`
  (`{ winner: boolean }`).
- **`schemas.ts`** — CRUD; `DELETE` allowed even when attached to prompts
  (`prompts.schemaId` goes null via FK).
- **`playground.ts`** — `POST /api/playground/run`: single synchronous call via
  `chatCompleteDetailed`. Message shape for playground and experiment calls alike: the
  prompt/version content is sent as a single `user` message, no system message, and the
  web-search plugin is **never** enabled on this path (it belongs to the news pipeline); when `schemaId` present, passes derived JSON Schema as
  `response_format` and validates the response body against it server-side (parse JSON →
  validate → collect readable error strings). Non-JSON or invalid output is returned
  with `validation.valid = false`, not thrown.

### Optimizer meta-prompt

Server-side template (in `apps/server/src/services/optimizer.ts`):

- System message: role ("expert prompt engineer"), instruction to preserve intent,
  output contract — return exactly two blocks: the improved prompt and a short rationale
  (delimited so the server can split them deterministically, e.g. fenced sections
  `<improved>` / `<rationale>`).
- Per-family guidance selected by the target model's `family` from the catalog (e.g.
  ANTHROPIC → XML-tag structuring, explicit role, prefill-friendly phrasing; xAI/OpenAI
  families get their own short guidance blocks; unknown family → generic best practices).
- User message: the original prompt content + target model id.

Splitting is defensive: if delimiters are missing, treat the whole response as
`improved` with empty rationale rather than failing.

### Experiment runner (`apps/server/src/scheduler/experimentRunner.ts`)

In-process, same spirit as the cron scheduler:

- `runExperiment(experimentId)` loads pending result rows, executes them with a
  **concurrency limit of 3** (simple worker-pool over the rows), each via
  `chatCompleteDetailed` (using the attached schema's `response_format` when the
  prompt has one), updating each row to `ok`/`fail` with output/usage/duration as it
  settles.
- When all rows are settled → experiment `status = 'done'`, `finishedAt = now`.
  Individual cell failures do not fail the experiment.
- Fire-and-forget from the route with logged errors (Pino, one-line events); never
  throws into the request path.
- **Boot recovery:** on server start, any experiment still `running` is marked
  `failed` and its `pending` rows marked `fail` with `errorMessage = "interrupted by restart"`.

### Config

No new env vars — reuses `OPENROUTER_API_KEY`.

## Web

### Navigation

Sixth Rail entry **PROMPTS** (count badge = number of prompts). `Console.tsx` gains the
view; existing views untouched.

### `PromptsView` — internal tabs LIBRARY / EXPERIMENTS / SCHEMAS

Tab switcher styled like the existing filter pills. All new components live under
`apps/web/src/views/prompts/`. Data fetching via TanStack Query with query keys
`['folders']`, `['prompts', filters]`, `['prompt', id]`, `['experiments']`,
`['experiment', id]`, `['schemas']`; mutations invalidate the relevant keys.

**LIBRARY**

- Left folder strip (All / per-folder with counts / + new folder, rename, delete) +
  tag filter + name search.
- Prompt list (name, folder, tags, head version, updated).
- Detail drawer (pattern of `TaskDrawer`): content editor (JetBrains Mono), Save →
  optional note → creates new version; metadata editing inline; version history list
  with a simple line-based diff between any version and head, and RESTORE (copies as
  new head version).
- **OPTIMIZE** action → modal: pick target model + optimizer model (both from the
  catalog) → shows side-by-side original/improved + rationale → ACCEPT saves a new
  version with a note, DISCARD closes.
- **TEST RUN** action → pick model → calls `/api/playground/run` with the current head
  content (and attached schema if any) → output modal with duration/tokens/cost and
  validation result when a schema is attached.

**EXPERIMENTS**

- Experiment list (prompt name, status, created, cell summary e.g. `6/9 ok`).
- NEW EXPERIMENT flow: pick prompt → checkbox versions (shows note + snippet) →
  checkbox models → START.
- Experiment detail: **grid, rows = versions, columns = models**. Cell shows status
  (pending pulse / ok / fail), duration, tokens, cost. Click → full output modal.
  ⭐ toggles `winner`. While `status === 'running'`, the detail query polls with
  `refetchInterval: 5000`; polling stops when done.

**SCHEMAS**

- Schema list; editor screen: recursive field editor (add/remove/reorder fields; per
  field: name, type select, description, required toggle; enum → value chips; object →
  nested children; array → item type editor), live JSON Schema preview pane computed
  client-side with the shared `fieldsToJsonSchema`, COPY button.
- Test panel: prompt textarea + model select → `/api/playground/run` with this schema →
  pretty-printed JSON response + validation verdict (green OK or listed errors).

### Aesthetic

Faithful to `design/Holonet.dc.html` and the existing views: amber terminal palette
(AMBER #ffb347, OK #5fe3a1, BAD #ff5d6c, DIM #5c6678, HI #e9edf4, bg #080a0e),
Chakra Petch / JetBrains Mono, inline styles, existing animation vocabulary
(scanlines, pulse, blink, slidein). Reuse existing primitives (drawer, table rows,
pills, toasts) rather than inventing new ones.

## Error handling summary

- Per-cell experiment errors → `fail` + trimmed `errorMessage`; experiment still `done`.
- Optimizer/playground OpenRouter errors → 502 with a safe message (never the API key).
- Schema validation failures in playground are **data**, not errors (`validation.valid=false`).
- Server restart mid-experiment → boot marks it `failed` (no silent zombies).
- 401 anywhere → existing login-screen flip (unchanged mechanism).

## Testing

- **shared:** `fieldsToJsonSchema` (all field types, nesting, arrays of objects, enums,
  required propagation); new Zod contract shape tests where non-obvious (recursive field).
- **server (`node:test` + pglite):**
  - prompts: create seeds v1; save increments version atomically; restore copies content;
    delete cascades; metadata patch does not create versions.
  - experiments: create inserts pending grid; runner with a mocked `chatCompleteDetailed`
    fills cells, sets `done`, tolerates per-cell failure; boot recovery marks stale
    `running` as `failed`.
  - optimizer: meta-prompt assembly per family; response splitting incl. missing
    delimiters.
  - playground: schema validation pass/fail paths.
  - Keep the quoted test glob (`"src/**/*.test.ts"`).
- **web:** typecheck (existing pattern; no component test harness in repo).

## Documentation

`docs/SPEC.md` (authoritative architecture contract) gets a new module section: tables,
routes, runner semantics, and the shared `fieldsToJsonSchema` contract.

## Verification

`pnpm check` · `pnpm typecheck` · `pnpm test` · `pnpm build` (root scripts; Biome, not
eslint) must pass before the work is considered done.

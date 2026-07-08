# Model Catalog Settings — Design

**Date:** 2026-07-08
**Status:** Approved (brainstorm with user)

## Goal

The inference model catalog (which OpenRouter models can be assigned to tasks) becomes
user-editable from the UI instead of being hardcoded in `packages/shared/src/models.ts`.
Scope is the catalog only: no default-model setting, no inference parameters.

## Data model

New `models` table in `apps/server/src/db/schema.ts`, with a new committed Drizzle SQL
migration:

```
models
  id         uuid pk default gen_random_uuid()
  modelId    text notnull unique   -- OpenRouter id, e.g. "anthropic/claude-sonnet-4.5"
  label      text notnull          -- display label, e.g. "SONNET 4.5"
  family     text notnull          -- group heading, e.g. "ANTHROPIC"
  createdAt  timestamptz notnull default now()
```

The same migration seeds the 4 current catalog entries (SONNET 4.5, OPUS 4.1, GROK 4,
GROK 3) so existing tasks remain valid.

`tasks.model` stays a plain text OpenRouter id — **no FK**. Run history and the executor
(`scheduler/executor.ts`, `services/openrouter.ts`) are untouched; they already treat the
model as an opaque string.

## Shared package (`@holonet/shared`)

- `schemas.ts`: `TaskInputSchema.model` (and `TaskSchema.model`) change from
  `z.enum(MODEL_IDS)` to a string validated by an OpenRouter-id shape check
  (`vendor/model` pattern, e.g. `/^[\w.-]+\/[\w.:-]+$/`, max 100 chars). Catalog
  membership is enforced server-side against the DB (a shared enum can't know DB state).
- `models.ts`: the hardcoded `MODELS`, `ModelId`, `MODEL_IDS` exports are **removed**
  (values live on only as the migration seed). All usages swept: direct references,
  type references, re-exports, tests.
- New schemas: `ModelSchema` (id uuid, modelId, label, family, createdAt epoch ms,
  computed `inUse` count) and `ModelInputSchema` (modelId per the shape check; label
  1–40 trimmed; family 1–20 trimmed).

## Server API

New `apps/server/src/api/models.ts` following the existing route-factory pattern
(`createModelsRoutes(db): Hono`), mounted in `app.ts` as `api.route("/models", …)`
behind the existing auth middleware. Error envelope and codes as in SPEC.md.

- `GET    /api/models` → `Model[]`, ordered by family then label. Each entry carries
  `inUse`: count of tasks whose `model` equals its `modelId`.
- `POST   /api/models` body `ModelInput` → 201 `Model`. Duplicate `modelId` →
  409 `CONFLICT`.
- `PATCH  /api/models/:id` body `{ label, family }` (`modelId` immutable) → `Model`.
  Unknown id → 404 `NOT_FOUND`.
- `DELETE /api/models/:id` → 204. If any task references its `modelId` →
  409 `CONFLICT` with message `used by N task(s)`.

Task create/update (`api/tasks.ts`) additionally verifies the submitted `model` exists
in the `models` table; unknown → 400 `VALIDATION` ("unknown model").

Serialization: `api/serialize.ts` gains a model serializer (timestamps as epoch ms),
matching the existing boundary-mapping convention.

## Frontend (`@holonet/web`)

- `lib/types.ts`: `ViewId` gains `"settings"`.
- `Rail.tsx`: new SETTINGS nav entry (same visual language as existing entries).
- New `views/SettingsView.tsx` — "INFERENCE MODELS" panel in the design-file aesthetic
  (amber-on-dark, Chakra Petch/JetBrains Mono, existing panel/chip patterns):
  - Model list: label, OpenRouter id, family, in-use count, edit + delete actions.
    Delete uses the PURGE-style confirm pattern; server 409 shown as an inline error.
  - Add-model form: three inputs (OpenRouter id, label, family) + ADD button, zod
    validation errors rendered in the design's error style.
  - Edit toggles the row into label/family inputs (modelId immutable).
- `api/client.ts`: `['models']` query + create/update/delete mutations; mutations
  invalidate `['models']` (and `['tasks']` is unaffected — tasks don't embed labels).
- `TaskDrawer.tsx`: the model grid renders from the `['models']` query instead of the
  hardcoded import; default selection = first catalog entry. Empty catalog disables
  DEPLOY/UPDATE with a hint to add models in Settings.

## Error handling summary

| Case | Response |
|---|---|
| Duplicate `modelId` on create | 409 `CONFLICT` |
| Delete model still used by tasks | 409 `CONFLICT`, message `used by N task(s)` |
| PATCH/DELETE unknown model id | 404 `NOT_FOUND` |
| Task create/update with uncataloged model | 400 `VALIDATION` |
| Malformed `ModelInput` | 400 `VALIDATION` (zod) |

## Testing

Server integration tests (node:test on pglite running the committed migrations, same
harness as the tasks API tests):

- migration seeds the 4 models;
- models CRUD happy paths; duplicate `modelId` → 409;
- delete blocked (409) while a task uses the model, allowed after the task is deleted;
- task create/update with an uncataloged model → 400 `VALIDATION`;
- existing shared/server tests updated for the `z.enum` removal.

## Docs

`docs/SPEC.md` updated: repository layout (new files), DB schema, API contract, model
catalog section (now DB-backed; seed listed), frontend views list.

## Out of scope

Default model selection, inference parameters (temperature etc.), model metadata sync
from the OpenRouter API, multi-user concerns.

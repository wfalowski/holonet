# Model Catalog Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inference model catalog (which OpenRouter models tasks can use) editable from a new Settings screen instead of hardcoded in `packages/shared/src/models.ts`.

**Architecture:** New `models` Postgres table (seeded with the current 4 entries by migration) exposed via REST CRUD at `/api/models` (Hono route factory, behind existing auth). Task create/update validates model membership against the DB. The React SPA gains a `settings` view for catalog management; the TaskDrawer model grid and model labels load from a `['models']` TanStack query.

**Tech Stack:** TypeScript strict ESM, Hono 4, Drizzle ORM + Postgres (pglite in tests), Zod v4, React 19 + TanStack Query, node:test, Biome.

**Spec:** `docs/superpowers/specs/2026-07-08-model-catalog-settings-design.md`

## Global Constraints

- Monorepo: `@holonet/shared`, `@holonet/server`, `@holonet/web`. Relative imports use `.js` extension (ESM). `"type": "module"` everywhere.
- Biome formatting: 2-space indent, double quotes. Before each commit run `pnpm exec biome check --write .` from the repo root, then `pnpm check` must pass.
- No `any`, no TS `enum` (string-literal unions / `as const` only). Validate at IO boundaries only.
- API error envelope: `{ error: { code, message } }`; codes limited to `UNAUTHORIZED | NOT_FOUND | VALIDATION | RATE_LIMITED | INTERNAL | CONFLICT`.
- Never log or echo `APP_KEY`, `OPENROUTER_API_KEY`, or webhook tokens.
- `@holonet/shared` must be rebuilt before server/web typecheck/test picks up shared changes: `pnpm --filter @holonet/shared build`. Root scripts (`pnpm typecheck`, `pnpm test`) already do this.
- Server test glob stays quoted in `apps/server/package.json` (`"src/**/*.test.ts"`).
- Verification commands (run from repo root): `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Work happens on the already-created branch `feature/model-catalog-settings`.
- UI palette/constants come from `apps/web/src/lib/theme.ts` (AMBER `#ffb347`, OK `#5fe3a1`, BAD `#ff5d6c`, DIM `#5c6678`, HI `#e9edf4`, CHAKRA font). Inline style objects are the codebase convention.

---

### Task 1: Shared model schemas; task.model becomes a validated string

The shared package gains `ModelSchema` / `ModelInputSchema` / `ModelUpdateSchema` / `MODEL_ID_RE`, and `TaskInputSchema.model` / `TaskSchema.model` switch from `z.enum(MODEL_IDS)` to a shape-checked string. The old `MODELS` / `ModelId` / `MODEL_IDS` exports stay for now (web still imports them until Task 4); they are removed in Task 6. Two mechanical downstream type fixes keep the whole repo green.

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/schemas.test.ts`
- Modify: `apps/server/src/api/serialize.ts:1-21` (drop `ModelId` cast)
- Modify: `apps/web/src/components/TaskDrawer.tsx:1-8,61-74` (FormState.model: string)

**Interfaces:**
- Consumes: existing `TaskInputSchema`, `TaskSchema` in `packages/shared/src/schemas.ts`.
- Produces (used by Tasks 3–5):
  - `MODEL_ID_RE: RegExp`
  - `ModelInputSchema` → `type ModelInput = { modelId: string; label: string; family: string }`
  - `ModelUpdateSchema` → `type ModelUpdate = { label: string; family: string }`
  - `ModelSchema` → `type Model = { id: string; modelId: string; label: string; family: string; createdAt: number; inUse: number }`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/schemas.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelInputSchema, TaskInputSchema } from "./schemas.js";

const validTask = {
  name: "Test Task",
  cron: "30 9 * * *",
  prompt: "Summarize today's headlines",
  model: "anthropic/claude-sonnet-4.5",
  webSearch: true,
  enabled: true,
  dedupe: true,
  webhookUrl: "https://discord.com/api/webhooks/123/abc",
  channel: "general",
  format: "digest",
  sources: [],
};

test("ModelInputSchema accepts a valid OpenRouter model entry", () => {
  const parsed = ModelInputSchema.safeParse({
    modelId: "meta-llama/llama-4-maverick:free",
    label: "LLAMA 4 MAVERICK",
    family: "META",
  });
  assert.equal(parsed.success, true);
});

test("ModelInputSchema trims fields", () => {
  const parsed = ModelInputSchema.parse({
    modelId: "  openai/gpt-5.2  ",
    label: " GPT 5.2 ",
    family: " OPENAI ",
  });
  assert.equal(parsed.modelId, "openai/gpt-5.2");
  assert.equal(parsed.label, "GPT 5.2");
  assert.equal(parsed.family, "OPENAI");
});

test("ModelInputSchema rejects ids without a vendor prefix", () => {
  assert.equal(
    ModelInputSchema.safeParse({
      modelId: "gpt-5.2",
      label: "GPT 5.2",
      family: "OPENAI",
    }).success,
    false,
  );
});

test("ModelInputSchema rejects empty label and overlong family", () => {
  assert.equal(
    ModelInputSchema.safeParse({
      modelId: "openai/gpt-5.2",
      label: "",
      family: "OPENAI",
    }).success,
    false,
  );
  assert.equal(
    ModelInputSchema.safeParse({
      modelId: "openai/gpt-5.2",
      label: "GPT 5.2",
      family: "X".repeat(21),
    }).success,
    false,
  );
});

test("TaskInputSchema accepts any well-shaped OpenRouter model id", () => {
  const parsed = TaskInputSchema.safeParse({
    ...validTask,
    model: "mistralai/mistral-large-2",
  });
  assert.equal(parsed.success, true);
});

test("TaskInputSchema rejects malformed model ids", () => {
  assert.equal(
    TaskInputSchema.safeParse({ ...validTask, model: "not a model id!" })
      .success,
    false,
  );
  assert.equal(
    TaskInputSchema.safeParse({ ...validTask, model: "" }).success,
    false,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @holonet/shared test`
Expected: FAIL — `ModelInputSchema` is not exported, and `TaskInputSchema` still rejects `mistralai/mistral-large-2` (not in the enum).

- [ ] **Step 3: Implement the shared schema changes**

In `packages/shared/src/schemas.ts`:

Remove the import of `MODEL_IDS` (line 3):

```ts
// DELETE this line:
import { MODEL_IDS } from "./models.js";
```

Insert after the `TaskFormat` block (after current line 6):

```ts
// OpenRouter model id shape, e.g. "anthropic/claude-sonnet-4.5" or
// "meta-llama/llama-4-maverick:free". Catalog membership is enforced
// server-side against the models table.
export const MODEL_ID_RE = /^[\w.-]+\/[\w.:-]+$/;

export const ModelInputSchema = z.object({
  modelId: z
    .string()
    .trim()
    .max(100)
    .regex(MODEL_ID_RE, "Expected an OpenRouter model id like vendor/model"),
  label: z.string().trim().min(1).max(40),
  family: z.string().trim().min(1).max(20),
});
export type ModelInput = z.infer<typeof ModelInputSchema>;

export const ModelUpdateSchema = ModelInputSchema.omit({ modelId: true });
export type ModelUpdate = z.infer<typeof ModelUpdateSchema>;

export const ModelSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  label: z.string(),
  family: z.string(),
  createdAt: z.number(),
  inUse: z.number(),
});
export type Model = z.infer<typeof ModelSchema>;
```

In `TaskInputSchema` (current line 15) replace:

```ts
  model: z.enum(MODEL_IDS),
```

with:

```ts
  model: z
    .string()
    .trim()
    .max(100)
    .regex(MODEL_ID_RE, "Invalid model id (expected vendor/model)"),
```

In `TaskSchema` (current line 40) replace:

```ts
  model: z.enum(MODEL_IDS),
```

with:

```ts
  model: z.string(),
```

- [ ] **Step 4: Fix the two downstream type usages**

`apps/server/src/api/serialize.ts` — remove `type ModelId` from the import block (lines 1-8) and change line 21 from:

```ts
    model: row.model as ModelId,
```

to:

```ts
    model: row.model,
```

`apps/web/src/components/TaskDrawer.tsx` — remove `type ModelId,` from the `@holonet/shared` import (line 4), and in `interface FormState` (line 65) change:

```ts
  model: ModelId;
```

to:

```ts
  model: string;
```

(`MODELS[0].id` in `blankForm` still typechecks as a string; leave the rest of the file alone — it changes in Task 4.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @holonet/shared test`
Expected: PASS (all schemas.test.ts and cron.test.ts tests).

- [ ] **Step 6: Verify the whole repo is green**

Run: `pnpm exec biome check --write . && pnpm check && pnpm typecheck && pnpm test`
Expected: all pass (root scripts rebuild shared first).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts apps/server/src/api/serialize.ts apps/web/src/components/TaskDrawer.tsx
git commit -m "feat(shared): model catalog schemas; task model becomes validated string"
```

---

### Task 2: `models` table + seeded migration

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/drizzle/0001_<generated-name>.sql` (via drizzle-kit, then hand-append seed)
- Create: `apps/server/src/db/migrations.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 3): drizzle table `models` with columns `id (uuid pk)`, `modelId (text unique, DB column model_id)`, `label (text)`, `family (text)`, `createdAt (timestamptz, default now())`; types `ModelRow`, `NewModelRow`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/db/migrations.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.js";
import { models } from "./schema.js";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

test("migrations create and seed the model catalog", async () => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });

  const rows = await db.select().from(models);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => r.modelId).sort(),
    [
      "anthropic/claude-opus-4.1",
      "anthropic/claude-sonnet-4.5",
      "x-ai/grok-3",
      "x-ai/grok-4",
    ],
  );
  for (const row of rows) {
    assert.ok(row.id);
    assert.ok(row.label.length > 0);
    assert.ok(row.family.length > 0);
    assert.ok(row.createdAt instanceof Date);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @holonet/server exec node --import tsx --test src/db/migrations.test.ts`
Expected: FAIL — `models` is not exported from `./schema.js`.

- [ ] **Step 3: Add the table to the drizzle schema**

In `apps/server/src/db/schema.ts`, insert after the `runs` table definition (after current line 47):

```ts
export const models = pgTable("models", {
  id: uuid("id").primaryKey().defaultRandom(),
  modelId: text("model_id").notNull().unique(),
  label: text("label").notNull(),
  family: text("family").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

And extend the type exports at the bottom:

```ts
export type ModelRow = typeof models.$inferSelect;
export type NewModelRow = typeof models.$inferInsert;
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @holonet/server db:generate`
Expected output: a new file `apps/server/drizzle/0001_<random_name>.sql` containing `CREATE TABLE "models" (...)` with the unique constraint, plus an updated `apps/server/drizzle/meta/_journal.json` and `apps/server/drizzle/meta/0001_snapshot.json`. Note the generated filename for the next step.

- [ ] **Step 5: Append the seed to the generated migration**

Open the generated `apps/server/drizzle/0001_*.sql` and append at the end (drizzle separates statements with `--> statement-breakpoint`):

```sql
--> statement-breakpoint
INSERT INTO "models" ("model_id", "label", "family") VALUES
  ('anthropic/claude-sonnet-4.5', 'SONNET 4.5', 'ANTHROPIC'),
  ('anthropic/claude-opus-4.1', 'OPUS 4.1', 'ANTHROPIC'),
  ('x-ai/grok-4', 'GROK 4', 'xAI'),
  ('x-ai/grok-3', 'GROK 3', 'xAI');
```

Do NOT edit the snapshot/journal — seeds are data, not schema; only the .sql file carries them.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @holonet/server exec node --import tsx --test src/db/migrations.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify repo green and commit**

Run: `pnpm exec biome check --write . && pnpm check && pnpm typecheck && pnpm test`
Expected: all pass.

```bash
git add apps/server/src/db/schema.ts apps/server/src/db/migrations.test.ts apps/server/drizzle
git commit -m "feat(server): models table with seeded default catalog"
```

---

### Task 3: `/api/models` CRUD + task model membership check

**Files:**
- Create: `apps/server/src/api/models.ts`
- Create: `apps/server/src/api/models.test.ts`
- Modify: `apps/server/src/api/serialize.ts` (add `rowToModel`)
- Modify: `apps/server/src/api/tasks.ts` (membership check in POST `/` and PUT `/:id`)
- Modify: `apps/server/src/app.ts:70-71` (mount route)

**Interfaces:**
- Consumes: `models`, `tasks`, `ModelRow` from `../db/schema.js`; `ModelInputSchema`, `ModelUpdateSchema`, `Model` from `@holonet/shared` (Task 1); seeded table (Task 2).
- Produces (used by Tasks 4–5):
  - `GET /api/models` → `Model[]` (ordered by family, label; `inUse` = count of tasks with that `modelId`)
  - `POST /api/models` body `ModelInput` → 201 `Model`; duplicate modelId → 409 CONFLICT
  - `PATCH /api/models/:id` body `ModelUpdate` → 200 `Model`; unknown id → 404
  - `DELETE /api/models/:id` → 204; in use → 409 CONFLICT `Model is used by N task(s)`; unknown id → 404
  - Task create/update with a model absent from the catalog → 400 VALIDATION `Unknown model — add it in Settings first`
  - `createModelsRoutes(db: Db): Hono`; `rowToModel(row: ModelRow, inUse: number): Model`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/api/models.test.ts` (same harness as `tasks.test.ts`):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import * as schema from "../db/schema.js";
import { logger } from "../logger.js";
import { createExecutor } from "../scheduler/executor.js";
import { createScheduler } from "../scheduler/scheduler.js";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

async function buildApp() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  const config = loadConfig({
    APP_KEY: "test-app-key-123456",
    OPENROUTER_API_KEY: "x",
  });
  const executor = createExecutor({ db, config, logger });
  const scheduler = createScheduler({ db, executor, logger });
  const app = createApp({ db, config, scheduler, executor });
  return { app, scheduler };
}

async function loginHeaders(app: Awaited<ReturnType<typeof buildApp>>["app"]) {
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "1.2.3.4",
    },
    body: JSON.stringify({ key: "test-app-key-123456" }),
  });
  assert.equal(login.status, 204);
  const setCookie = login.headers.get("set-cookie");
  assert.ok(setCookie);
  return { Cookie: (setCookie as string).split(";")[0] as string };
}

const validTask = {
  name: "Test Task",
  cron: "30 9 * * *",
  prompt: "Summarize today's headlines",
  model: "anthropic/claude-sonnet-4.5",
  webSearch: true,
  enabled: true,
  dedupe: true,
  webhookUrl: "https://discord.com/api/webhooks/123/abc",
  channel: "general",
  format: "digest",
  sources: [],
};

test("models API: CRUD, seed, conflicts, task membership check", async () => {
  const { app, scheduler } = await buildApp();

  // Auth guard.
  const noAuth = await app.request("/api/models");
  assert.equal(noAuth.status, 401);

  const auth = await loginHeaders(app);

  // Seeded list.
  const listRes = await app.request("/api/models", { headers: auth });
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as {
    id: string;
    modelId: string;
    label: string;
    family: string;
    createdAt: number;
    inUse: number;
  }[];
  assert.equal(list.length, 4);
  assert.ok(list.every((m) => m.inUse === 0));
  assert.ok(list.every((m) => typeof m.createdAt === "number"));
  const sonnet = list.find((m) => m.modelId === "anthropic/claude-sonnet-4.5");
  assert.ok(sonnet);

  // Create.
  const createRes = await app.request("/api/models", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId: "openai/gpt-5.2",
      label: "GPT 5.2",
      family: "OPENAI",
    }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as { id: string; inUse: number };
  assert.ok(created.id);
  assert.equal(created.inUse, 0);

  // Invalid body.
  const badRes = await app.request("/api/models", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ modelId: "no-slash", label: "X", family: "Y" }),
  });
  assert.equal(badRes.status, 400);

  // Duplicate.
  const dupRes = await app.request("/api/models", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId: "openai/gpt-5.2",
      label: "DUPE",
      family: "OPENAI",
    }),
  });
  assert.equal(dupRes.status, 409);

  // Patch label/family.
  const patchRes = await app.request(`/api/models/${created.id}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ label: "GPT 5.2 TURBO", family: "OPENAI" }),
  });
  assert.equal(patchRes.status, 200);
  const patched = (await patchRes.json()) as { label: string };
  assert.equal(patched.label, "GPT 5.2 TURBO");

  // Patch unknown id.
  const patch404 = await app.request(
    "/api/models/00000000-0000-0000-0000-000000000000",
    {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "X", family: "Y" }),
    },
  );
  assert.equal(patch404.status, 404);

  // Task using an uncataloged model is rejected.
  const badTask = await app.request("/api/tasks", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ ...validTask, model: "vendor/not-in-catalog" }),
  });
  assert.equal(badTask.status, 400);
  const badTaskBody = (await badTask.json()) as {
    error: { code: string };
  };
  assert.equal(badTaskBody.error.code, "VALIDATION");

  // Create a task using gpt-5.2, then deleting that model is blocked.
  const taskRes = await app.request("/api/tasks", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ ...validTask, model: "openai/gpt-5.2" }),
  });
  assert.equal(taskRes.status, 201);
  const task = (await taskRes.json()) as { id: string };

  const delBlocked = await app.request(`/api/models/${created.id}`, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(delBlocked.status, 409);

  // inUse is reported.
  const listRes2 = await app.request("/api/models", { headers: auth });
  const list2 = (await listRes2.json()) as { modelId: string; inUse: number }[];
  assert.equal(list2.find((m) => m.modelId === "openai/gpt-5.2")?.inUse, 1);

  // Delete the task, then the model deletes cleanly.
  const delTask = await app.request(`/api/tasks/${task.id}`, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(delTask.status, 204);

  const delOk = await app.request(`/api/models/${created.id}`, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(delOk.status, 204);

  const del404 = await app.request(`/api/models/${created.id}`, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(del404.status, 404);

  scheduler.stop();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @holonet/shared build && pnpm --filter @holonet/server exec node --import tsx --test src/api/models.test.ts`
Expected: FAIL — `/api/models` returns 404 (route not mounted).

- [ ] **Step 3: Add `rowToModel` to the serializer**

In `apps/server/src/api/serialize.ts`, extend the shared import with `type Model` and the schema import with `ModelRow`:

```ts
import {
  type Model,
  nextRun,
  type Run,
  type RunStatus,
  type Task,
  type TaskFormat,
} from "@holonet/shared";
import type { ModelRow, RunRow, TaskRow } from "../db/schema.js";
```

Append at the end of the file:

```ts
export function rowToModel(row: ModelRow, inUse: number): Model {
  return {
    id: row.id,
    modelId: row.modelId,
    label: row.label,
    family: row.family,
    createdAt: row.createdAt.getTime(),
    inUse,
  };
}
```

- [ ] **Step 4: Implement the routes**

Create `apps/server/src/api/models.ts`:

```ts
import { randomUUID } from "node:crypto";
import { ModelInputSchema, ModelUpdateSchema } from "@holonet/shared";
import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/index.js";
import type { ModelRow } from "../db/schema.js";
import { models, tasks } from "../db/schema.js";
import { rowToModel } from "./serialize.js";

function validationError(message: string) {
  return { error: { code: "VALIDATION" as const, message } };
}

function notFound() {
  return { error: { code: "NOT_FOUND" as const, message: "Model not found" } };
}

function conflict(message: string) {
  return { error: { code: "CONFLICT" as const, message } };
}

async function getModel(db: Db, id: string): Promise<ModelRow | undefined> {
  const rows = await db.select().from(models).where(eq(models.id, id));
  return rows[0];
}

async function tasksUsing(db: Db, modelId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.model, modelId));
  return rows[0]?.count ?? 0;
}

export function createModelsRoutes(db: Db): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const rows = await db
      .select()
      .from(models)
      .orderBy(asc(models.family), asc(models.label));
    const counts = await db
      .select({ model: tasks.model, count: sql<number>`count(*)::int` })
      .from(tasks)
      .groupBy(tasks.model);
    const inUse = new Map(counts.map((r) => [r.model, r.count]));
    return c.json(
      rows.map((row) => rowToModel(row, inUse.get(row.modelId) ?? 0)),
    );
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ModelInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid model"),
        400,
      );
    }

    const dupes = await db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.modelId, parsed.data.modelId));
    if (dupes.length > 0) {
      return c.json(conflict("Model already in catalog"), 409);
    }

    const id = randomUUID();
    await db.insert(models).values({ id, ...parsed.data });
    const created = (await getModel(db, id)) as ModelRow;
    return c.json(rowToModel(created, 0), 201);
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await getModel(db, id);
    if (!existing) return c.json(notFound(), 404);

    const body = await c.req.json().catch(() => null);
    const parsed = ModelUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid model"),
        400,
      );
    }

    await db.update(models).set(parsed.data).where(eq(models.id, id));
    const updated = (await getModel(db, id)) as ModelRow;
    return c.json(rowToModel(updated, await tasksUsing(db, updated.modelId)));
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await getModel(db, id);
    if (!existing) return c.json(notFound(), 404);

    const used = await tasksUsing(db, existing.modelId);
    if (used > 0) {
      return c.json(conflict(`Model is used by ${used} task(s)`), 409);
    }

    await db.delete(models).where(eq(models.id, id));
    return c.body(null, 204);
  });

  return app;
}
```

Note: the `models` table has a DB uuid default on `id`, but PGlite + drizzle inserts pass it explicitly (matches the `tasks` route convention with `randomUUID()`). `createdAt` relies on the `defaultNow()` column default.

- [ ] **Step 5: Enforce catalog membership on task create/update**

In `apps/server/src/api/tasks.ts`:

Extend the schema import (line 7):

```ts
import { models, runs, tasks } from "../db/schema.js";
```

Add a helper below `getTask` (after line 34):

```ts
async function modelInCatalog(db: Db, modelId: string): Promise<boolean> {
  const rows = await db
    .select({ id: models.id })
    .from(models)
    .where(eq(models.modelId, modelId));
  return rows.length > 0;
}
```

In `app.post("/", ...)`, insert directly after the `if (!parsed.success) { ... }` block (after current line 81):

```ts
    if (!(await modelInCatalog(db, parsed.data.model))) {
      return c.json(
        validationError("Unknown model — add it in Settings first"),
        400,
      );
    }
```

Insert the identical block in `app.put("/:id", ...)` directly after its `if (!parsed.success) { ... }` block (after current line 110).

- [ ] **Step 6: Mount the route**

In `apps/server/src/app.ts`, add the import:

```ts
import { createModelsRoutes } from "./api/models.js";
```

and after `api.route("/tasks", ...)` (line 70) add:

```ts
  api.route("/models", createModelsRoutes(db));
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @holonet/server exec node --import tsx --test src/api/models.test.ts`
Expected: PASS.

Run: `pnpm test` (root)
Expected: PASS — including the pre-existing `tasks.test.ts` (its `validTask` uses seeded `anthropic/claude-sonnet-4.5`, so the membership check passes).

- [ ] **Step 8: Verify repo green and commit**

Run: `pnpm exec biome check --write . && pnpm check && pnpm typecheck && pnpm build`
Expected: all pass.

```bash
git add apps/server/src/api/models.ts apps/server/src/api/models.test.ts apps/server/src/api/serialize.ts apps/server/src/api/tasks.ts apps/server/src/app.ts
git commit -m "feat(server): /api/models CRUD with in-use guard and task catalog check"
```

---

### Task 4: Web reads the catalog from the API

The SPA stops using the hardcoded `MODELS`: the client gains a `['models']` query + mutations, `modelLabel` takes the fetched list, views/drawer receive it via props.

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/lib/modelLabel.ts`
- Modify: `apps/web/src/views/OverviewView.tsx:1-3,20-26,65-71`
- Modify: `apps/web/src/views/TasksView.tsx:1-3,26-47,247`
- Modify: `apps/web/src/components/TaskDrawer.tsx`
- Modify: `apps/web/src/components/Console.tsx`

**Interfaces:**
- Consumes: `GET /api/models` (Task 3); `Model`, `ModelInput`, `ModelUpdate` from `@holonet/shared` (Task 1).
- Produces (used by Task 5):
  - `modelsQueryOptions` (queryKey `["models"]`), `createModel(input: ModelInput)`, `updateModel(id: string, input: ModelUpdate)`, `deleteModel(id: string)` in `apps/web/src/api/client.ts`
  - `api.patch<T>(path, data)` helper
  - `modelLabel(id: string, models: Model[]): string`
  - `OverviewView`/`TasksView`/`TaskDrawer` accept a `models: Model[]` prop

- [ ] **Step 1: Extend the API client**

In `apps/web/src/api/client.ts`:

Extend the shared type import (lines 1-7):

```ts
import type {
  ApiError,
  LoginInput,
  Model,
  ModelInput,
  ModelUpdate,
  Run,
  Task,
  TaskInput,
} from "@holonet/shared";
```

Add a `patch` method to the `api` object after `put` (line 51):

```ts
  patch: <T>(path: string, data?: unknown) =>
    json<T>(path, {
      method: "PATCH",
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
```

Append after `tasksQueryOptions` (line 58):

```ts
export const modelsQueryOptions = queryOptions({
  queryKey: ["models"] as const,
  queryFn: () => api.get<Model[]>("/api/models"),
});
```

Append at the end of the file:

```ts
export function createModel(input: ModelInput) {
  return api.post<Model>("/api/models", input);
}

export function updateModel(id: string, input: ModelUpdate) {
  return api.patch<Model>(`/api/models/${id}`, input);
}

export function deleteModel(id: string) {
  return api.delete<void>(`/api/models/${id}`);
}
```

- [ ] **Step 2: Rework `modelLabel`**

Replace the full contents of `apps/web/src/lib/modelLabel.ts` with:

```ts
import type { Model } from "@holonet/shared";

export function modelLabel(id: string, models: Model[]): string {
  return models.find((m) => m.modelId === id)?.label ?? id;
}
```

- [ ] **Step 3: Thread `models` through the two views**

`apps/web/src/views/OverviewView.tsx`:

Extend the shared type import (line 1):

```ts
import {
  countdown,
  describeCron,
  type Model,
  type Run,
  type Task,
} from "@holonet/shared";
```

Props (lines 20-26):

```ts
interface OverviewViewProps {
  tasks: Task[];
  runs: Run[];
  models: Model[];
  now: number;
}

export function OverviewView({ tasks, runs, models, now }: OverviewViewProps) {
```

Call site (line 68):

```ts
    meta: `${modelLabel(j.model, models)} · #${j.channel}`,
```

`apps/web/src/views/TasksView.tsx`:

Extend the shared type import (line 1):

```ts
import {
  countdown,
  describeCron,
  type Model,
  relTime,
  type Task,
} from "@holonet/shared";
```

Props (lines 26-46): add `models: Model[];` to `TasksViewProps` and `models,` to the destructured parameters.

Call site (line 247):

```ts
                    {modelLabel(j.model, models)}
```

- [ ] **Step 4: TaskDrawer renders the catalog from props**

In `apps/web/src/components/TaskDrawer.tsx`:

Replace the shared import block (lines 1-8) with:

```ts
import {
  describeCron,
  type Model,
  type Task,
  type TaskFormat,
  type TaskInput,
} from "@holonet/shared";
```

Replace `blankForm` (lines 76-91) with a parameterized version:

```ts
function blankForm(models: Model[]): FormState {
  return {
    name: "",
    cron: "0 9 * * *",
    prompt: "",
    model: models[0]?.modelId ?? "",
    webSearch: true,
    enabled: true,
    webhookUrl: "",
    channel: "",
    dedupe: true,
    format: "digest",
    sources: [],
    sourceInput: "",
  };
}
```

Add `models: Model[];` to `TaskDrawerProps` (after `task: Task | null;`, line 113), add `models,` to the destructured props (after `task,`), and change the state initializer (lines 131-133) to:

```ts
  const [form, setForm] = useState<FormState>(() =>
    mode === "edit" && task ? formFromTask(task) : blankForm(models),
  );
```

In `handleSave` (lines 165-171), require a model:

```ts
    const valid =
      form.name.trim() &&
      cdesc.ok &&
      form.prompt.trim().length > 3 &&
      form.model &&
      DISCORD_WEBHOOK_RE.test(form.webhookUrl);
```

Replace the model grid (lines 525-575, the `<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", ... }}>` that maps `MODELS`) with:

```tsx
          {models.length === 0 ? (
            <div
              style={{
                fontSize: "10px",
                letterSpacing: ".08em",
                color: DIM,
                border: "1px dashed rgba(140,160,190,.25)",
                padding: "12px 13px",
              }}
            >
              NO MODELS IN CATALOG — ADD ONE IN SETTINGS
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "7px",
              }}
            >
              {models.map((m) => {
                const on = form.model === m.modelId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => updForm("model", m.modelId)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      alignItems: "flex-start",
                      padding: "10px 12px",
                      cursor: "pointer",
                      border: `1px solid ${on ? "rgba(255,179,71,.55)" : "rgba(140,160,190,.18)"}`,
                      background: on
                        ? "rgba(255,179,71,.1)"
                        : "rgba(140,160,190,.04)",
                      color: on ? HI : "#9aa6ba",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "8px",
                        letterSpacing: ".2em",
                        color: on ? AMBER : DIM,
                      }}
                    >
                      {m.family}
                    </span>
                    <span
                      style={{
                        fontFamily: CHAKRA,
                        fontWeight: 600,
                        fontSize: "12px",
                        letterSpacing: ".08em",
                      }}
                    >
                      {m.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
```

Finally, disable the DEPLOY/UPDATE button when no model is selected — in the footer save button (lines 1008-1027) change:

```ts
            disabled={saving}
```

to:

```ts
            disabled={saving || !form.model}
```

and its style entries:

```ts
              cursor: saving || !form.model ? "default" : "pointer",
              opacity: saving || !form.model ? 0.6 : 1,
```

- [ ] **Step 5: Console fetches models and passes them down**

In `apps/web/src/components/Console.tsx`:

Extend the client import (lines 4-13) with `modelsQueryOptions`:

```ts
import {
  ApiRequestError,
  createTask,
  deleteTask,
  modelsQueryOptions,
  runsQueryOptions,
  runTaskNow,
  tasksQueryOptions,
  toggleTask,
  updateTask,
} from "../api/client.js";
```

After `const runsQuery = ...` (line 41) add:

```ts
  const modelsQuery = useQuery(modelsQueryOptions);
```

and after `const runs = ...` (line 43):

```ts
  const models = modelsQuery.data ?? [];
```

Pass the prop at the three render sites:

```tsx
          {view === "overview" && (
            <OverviewView tasks={tasks} runs={runs} models={models} now={now} />
          )}
```

```tsx
            <TasksView
              tasks={tasks}
              models={models}
              now={now}
              ...
```

```tsx
        <TaskDrawer
          key={drawer.mode === "edit" ? drawer.task.id : "new"}
          mode={drawer.mode}
          task={drawer.mode === "edit" ? drawer.task : null}
          models={models}
          ...
```

- [ ] **Step 6: Verify repo green**

Run: `pnpm exec biome check --write . && pnpm check && pnpm typecheck && pnpm test && pnpm build`
Expected: all pass. (Note: `MODELS` in `packages/shared/src/models.ts` is now unused by the app — it is removed in Task 6.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): model catalog loaded from /api/models"
```

---

### Task 5: Settings screen

New `settings` view: catalog list with edit/delete (PURGE-style confirm), add-model form, wired into the Rail and Console with mutations.

**Files:**
- Modify: `apps/web/src/lib/types.ts:1`
- Modify: `apps/web/src/components/Rail.tsx:19-24`
- Create: `apps/web/src/views/SettingsView.tsx`
- Modify: `apps/web/src/components/Console.tsx`

**Interfaces:**
- Consumes: `createModel` / `updateModel` / `deleteModel` / `modelsQueryOptions` (Task 4); `Model`, `ModelInput`, `ModelUpdate`, `MODEL_ID_RE` from `@holonet/shared` (Task 1); theme constants from `apps/web/src/lib/theme.ts`.
- Produces: `SettingsView` component with props `{ models: Model[]; onCreate: (input: ModelInput) => void; onUpdate: (id: string, input: ModelUpdate) => void; onDelete: (id: string) => void; isSaving: boolean }`; `ViewId` includes `"settings"`.

- [ ] **Step 1: Extend ViewId and the Rail**

`apps/web/src/lib/types.ts` line 1:

```ts
export type ViewId =
  | "overview"
  | "tasks"
  | "integrations"
  | "activity"
  | "settings";
```

`apps/web/src/components/Rail.tsx` — add to `navDefs` (after the `activity` entry, line 23):

```ts
    { id: "settings", code: "05", label: "SETTINGS", count: "" },
```

- [ ] **Step 2: Create the SettingsView**

Create `apps/web/src/views/SettingsView.tsx`:

```tsx
import {
  MODEL_ID_RE,
  type Model,
  type ModelInput,
  type ModelUpdate,
} from "@holonet/shared";
import { type CSSProperties, useRef, useState } from "react";
import {
  AMBER,
  BAD,
  CHAKRA,
  cornerAccent,
  DIM,
  HI,
  h1Style,
  sectionHeader,
  sectorLabel,
} from "../lib/theme.js";

const fieldLabel: CSSProperties = {
  display: "block",
  fontSize: "9px",
  letterSpacing: ".26em",
  color: DIM,
  marginBottom: "6px",
};

function fieldInput(error: boolean): CSSProperties {
  return {
    width: "100%",
    background: "rgba(140,160,190,.05)",
    border: `1px solid ${error ? BAD : "rgba(140,160,190,.2)"}`,
    color: HI,
    fontSize: "11px",
    letterSpacing: ".04em",
    padding: "9px 11px",
  };
}

const smallButton: CSSProperties = {
  background: "rgba(255,179,71,.08)",
  border: "1px solid rgba(255,179,71,.24)",
  color: AMBER,
  fontSize: "9px",
  letterSpacing: ".12em",
  padding: "6px 10px",
  cursor: "pointer",
  fontFamily: CHAKRA,
  fontWeight: 600,
};

const dangerButton: CSSProperties = {
  background: "none",
  border: "1px solid rgba(255,93,108,.4)",
  color: BAD,
  fontSize: "9px",
  letterSpacing: ".12em",
  padding: "6px 10px",
  cursor: "pointer",
  fontFamily: CHAKRA,
  fontWeight: 600,
};

interface SettingsViewProps {
  models: Model[];
  onCreate: (input: ModelInput) => void;
  onUpdate: (id: string, input: ModelUpdate) => void;
  onDelete: (id: string) => void;
  isSaving: boolean;
}

export function SettingsView({
  models,
  onCreate,
  onUpdate,
  onDelete,
  isSaving,
}: SettingsViewProps) {
  const [addForm, setAddForm] = useState({
    modelId: "",
    label: "",
    family: "",
  });
  const [showAddErrors, setShowAddErrors] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ label: "", family: "" });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const modelIdErr = showAddErrors && !MODEL_ID_RE.test(addForm.modelId.trim());
  const labelErr = showAddErrors && !addForm.label.trim();
  const familyErr = showAddErrors && !addForm.family.trim();

  function handleAdd() {
    const modelId = addForm.modelId.trim();
    const label = addForm.label.trim();
    const family = addForm.family.trim();
    if (!MODEL_ID_RE.test(modelId) || !label || !family) {
      setShowAddErrors(true);
      return;
    }
    onCreate({ modelId, label, family });
    setAddForm({ modelId: "", label: "", family: "" });
    setShowAddErrors(false);
  }

  function startEdit(m: Model) {
    setEditingId(m.id);
    setEditForm({ label: m.label, family: m.family });
  }

  function handleEditSave(id: string) {
    const label = editForm.label.trim();
    const family = editForm.family.trim();
    if (!label || !family) return;
    onUpdate(id, { label, family });
    setEditingId(null);
  }

  function handleDeleteClick(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
      deleteTimer.current = setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    setConfirmDeleteId(null);
    onDelete(id);
  }

  return (
    <div>
      <div style={sectionHeader}>
        <span style={sectorLabel}>{"// SECTOR 05"}</span>
        <h1 style={h1Style}>SETTINGS</h1>
      </div>

      <div
        style={{
          position: "relative",
          border: "1px solid rgba(255,179,71,.3)",
          background: "rgba(14,17,24,.75)",
          padding: "18px",
          overflow: "hidden",
          maxWidth: "820px",
        }}
      >
        <div style={cornerAccent("tr")} />
        <div
          style={{
            fontFamily: CHAKRA,
            fontWeight: 700,
            fontSize: "14px",
            letterSpacing: ".14em",
            color: AMBER,
          }}
        >
          INFERENCE MODELS
        </div>
        <div
          style={{
            fontSize: "10px",
            color: "#7a8496",
            marginTop: "8px",
            letterSpacing: ".04em",
            lineHeight: 1.6,
          }}
        >
          Catalog offered in the task compose drawer. Ids are OpenRouter model
          ids (vendor/model). A model in use by a task cannot be removed.
        </div>

        <div style={{ marginTop: "16px" }}>
          {models.length === 0 && (
            <div
              style={{
                fontSize: "10px",
                letterSpacing: ".08em",
                color: DIM,
                border: "1px dashed rgba(140,160,190,.25)",
                padding: "12px 13px",
              }}
            >
              NO MODELS CONFIGURED — ADD ONE BELOW
            </div>
          )}
          {models.map((m) => {
            const editing = editingId === m.id;
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "11px 2px",
                  borderBottom: "1px solid rgba(140,160,190,.12)",
                }}
              >
                {editing ? (
                  <>
                    <input
                      value={editForm.label}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, label: e.target.value }))
                      }
                      maxLength={40}
                      aria-label="Model label"
                      style={{ ...fieldInput(false), width: "170px" }}
                    />
                    <input
                      value={editForm.family}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, family: e.target.value }))
                      }
                      maxLength={20}
                      aria-label="Model family"
                      style={{ ...fieldInput(false), width: "120px" }}
                    />
                    <span
                      style={{
                        flex: 1,
                        fontSize: "10px",
                        color: "#ffd591",
                        letterSpacing: ".04em",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.modelId}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleEditSave(m.id)}
                      disabled={isSaving}
                      style={smallButton}
                    >
                      SAVE
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      style={{ ...dangerButton, borderColor: "rgba(140,160,190,.3)", color: "#9aa6ba" }}
                    >
                      CANCEL
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ width: "170px", flex: "none" }}>
                      <div
                        style={{
                          fontSize: "8px",
                          letterSpacing: ".2em",
                          color: DIM,
                        }}
                      >
                        {m.family}
                      </div>
                      <div
                        style={{
                          fontFamily: CHAKRA,
                          fontWeight: 600,
                          fontSize: "12px",
                          letterSpacing: ".08em",
                          color: HI,
                          marginTop: "2px",
                        }}
                      >
                        {m.label}
                      </div>
                    </div>
                    <span
                      style={{
                        flex: 1,
                        fontSize: "10px",
                        color: "#ffd591",
                        letterSpacing: ".04em",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.modelId}
                    </span>
                    <span
                      style={{
                        fontSize: "8.5px",
                        letterSpacing: ".14em",
                        color: m.inUse > 0 ? AMBER : DIM,
                        width: "84px",
                        flex: "none",
                      }}
                    >
                      {m.inUse > 0 ? `${m.inUse} TASK(S)` : "UNUSED"}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit(m)}
                      style={smallButton}
                    >
                      EDIT
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(m.id)}
                      disabled={isSaving || m.inUse > 0}
                      title={
                        m.inUse > 0
                          ? "In use by tasks — reassign them first"
                          : "Remove from catalog"
                      }
                      style={{
                        ...dangerButton,
                        opacity: m.inUse > 0 ? 0.4 : 1,
                        cursor: m.inUse > 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      {confirmDeleteId === m.id ? "CONFIRM" : "REMOVE"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: "18px",
            fontSize: "9px",
            letterSpacing: ".26em",
            color: DIM,
          }}
        >
          ADD MODEL
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 1fr 0.8fr auto",
            gap: "10px",
            alignItems: "end",
            marginTop: "10px",
          }}
        >
          <div>
            <label htmlFor="settings-model-id" style={fieldLabel}>
              OPENROUTER ID
            </label>
            <input
              id="settings-model-id"
              value={addForm.modelId}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, modelId: e.target.value }))
              }
              placeholder="vendor/model"
              maxLength={100}
              style={fieldInput(modelIdErr)}
            />
          </div>
          <div>
            <label htmlFor="settings-model-label" style={fieldLabel}>
              LABEL
            </label>
            <input
              id="settings-model-label"
              value={addForm.label}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, label: e.target.value }))
              }
              placeholder="e.g. SONNET 4.5"
              maxLength={40}
              style={fieldInput(labelErr)}
            />
          </div>
          <div>
            <label htmlFor="settings-model-family" style={fieldLabel}>
              FAMILY
            </label>
            <input
              id="settings-model-family"
              value={addForm.family}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, family: e.target.value }))
              }
              placeholder="e.g. ANTHROPIC"
              maxLength={20}
              style={fieldInput(familyErr)}
            />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={isSaving}
            style={{
              background: AMBER,
              color: "#0a0c10",
              border: "none",
              padding: "10px 18px",
              fontFamily: CHAKRA,
              fontWeight: 700,
              fontSize: "10px",
              letterSpacing: ".16em",
              cursor: isSaving ? "default" : "pointer",
              opacity: isSaving ? 0.6 : 1,
              boxShadow: "0 0 18px rgba(255,179,71,.35)",
            }}
          >
            ADD
          </button>
        </div>
        <div
          style={{
            fontSize: "9px",
            letterSpacing: ".1em",
            color: BAD,
            marginTop: "6px",
            height: modelIdErr || labelErr || familyErr ? "auto" : 0,
            overflow: "hidden",
          }}
        >
          {modelIdErr
            ? "▸ OPENROUTER ID REQUIRED (vendor/model)"
            : labelErr
              ? "▸ LABEL REQUIRED"
              : familyErr
                ? "▸ FAMILY REQUIRED"
                : ""}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire mutations and the view into Console**

In `apps/web/src/components/Console.tsx`:

Extend the shared type import (line 1):

```ts
import {
  countdown,
  type ModelInput,
  type ModelUpdate,
  type Task,
  type TaskInput,
} from "@holonet/shared";
```

Extend the client import with `createModel`, `deleteModel`, `updateModel` (keep alphabetical order per Biome), and add the view import:

```ts
import { SettingsView } from "../views/SettingsView.js";
```

Add mutations after `runMutation` (after line 97):

```ts
  function invalidateModels() {
    queryClient.invalidateQueries({ queryKey: ["models"] });
  }

  const createModelMutation = useMutation({
    mutationFn: (input: ModelInput) => createModel(input),
    onSuccess: invalidateModels,
    onError: (error) => pushToast(errorMessage(error)),
  });

  const updateModelMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ModelUpdate }) =>
      updateModel(id, input),
    onSuccess: invalidateModels,
    onError: (error) => pushToast(errorMessage(error)),
  });

  const deleteModelMutation = useMutation({
    mutationFn: (id: string) => deleteModel(id),
    onSuccess: invalidateModels,
    onError: (error) => pushToast(errorMessage(error)),
  });
```

Add the render branch after the `activity` line (line 172):

```tsx
          {view === "settings" && (
            <SettingsView
              models={models}
              onCreate={(input) => createModelMutation.mutate(input)}
              onUpdate={(id, input) =>
                updateModelMutation.mutate({ id, input })
              }
              onDelete={(id) => deleteModelMutation.mutate(id)}
              isSaving={
                createModelMutation.isPending ||
                updateModelMutation.isPending ||
                deleteModelMutation.isPending
              }
            />
          )}
```

- [ ] **Step 4: Verify repo green**

Run: `pnpm exec biome check --write . && pnpm check && pnpm typecheck && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 5: Manual smoke check (dev servers)**

Run: `pnpm dev` (needs local Postgres per docker-compose, `APP_KEY` + `OPENROUTER_API_KEY` in env). In the browser: log in → SETTINGS shows 4 seeded models → add `openai/gpt-5.2 / GPT 5.2 / OPENAI` → it appears in the task drawer grid → removing a model bound to a task shows the CONFLICT toast. If no local DB is available, note that in the report and rely on the integration tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): settings screen for the inference model catalog"
```

---

### Task 6: Remove the hardcoded catalog; update SPEC.md

**Files:**
- Delete: `packages/shared/src/models.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `docs/SPEC.md`

**Interfaces:**
- Consumes: everything above (no remaining importers of `MODELS` / `ModelId` / `MODEL_IDS`).
- Produces: final state — shared exports only `cron` + `schemas`.

- [ ] **Step 1: Verify nothing references the old exports**

Run: `grep -rn "MODELS\|ModelId\|MODEL_IDS" --include="*.ts" --include="*.tsx" apps packages | grep -v node_modules | grep -v dist | grep -v "modelsQuery\|modelId\|ModelInput\|ModelUpdate\|models\."`
Expected: hits only inside `packages/shared/src/models.ts` itself. Also check string literals, dynamic imports, and re-exports separately:
`grep -rn "models.js\|models\"" --include="*.ts" --include="*.tsx" packages/shared/src`
Expected: only `packages/shared/src/index.ts` line 2.

- [ ] **Step 2: Delete the file and its re-export**

```bash
git rm packages/shared/src/models.ts
```

In `packages/shared/src/index.ts` delete line 2 (`export * from "./models.js";`), leaving:

```ts
export * from "./cron.js";
export * from "./schemas.js";
```

- [ ] **Step 3: Update docs/SPEC.md**

Apply these edits:

1. Repository layout tree — replace the line
   `│           ├── models.ts          # model catalog (OpenRouter ids + labels)`
   with nothing (remove it), change the `schemas.ts` comment to
   `# Task, TaskInput, Model, ModelInput, Run, auth payloads`, change the
   `packages/shared` comment from `zod schemas, API types, cron utils, model catalog`
   to `zod schemas, API types, cron utils`, add under `apps/server/src/api/`:
   `│   │   │   ├── models.ts      # model catalog CRUD` and change the
   `db/schema.ts` comment to `# tables: tasks, runs, models`. Under
   `apps/web/src/`, change the `views/` comment to
   `# Overview, Tasks, Integrations, Activity, Settings`.
2. Database schema section — append after the `runs` block:

   ```
   // models (editable inference model catalog; seeded by migration)
   id          uuid pk default gen_random_uuid()
   modelId     text notnull unique   // OpenRouter id, e.g. "anthropic/claude-sonnet-4.5"
   label       text notnull          // display label, e.g. "SONNET 4.5"
   family      text notnull          // group heading, e.g. "ANTHROPIC"
   createdAt   timestamp with time zone notnull default now()
   ```

3. API contract section — add after the `/api/runs` line:

   ```
   - `GET  /api/models` → `Model[]` ordered by family/label; each entry carries
     `inUse` (count of tasks bound to it).
   - `POST /api/models` `ModelInput` → `Model` (201); duplicate modelId → 409 `CONFLICT`.
   - `PATCH /api/models/:id` `{ label, family }` → `Model` (modelId immutable).
   - `DELETE /api/models/:id` → 204; 409 `CONFLICT` while any task uses it.
   ```

   And in the `TaskInput` paragraph, replace
   `` `model` must be in the shared model catalog ``
   with
   `` `model` must match the OpenRouter id shape (`vendor/model`) and exist in the `models` table (server-checked) ``.
4. Replace the whole `## Model catalog (packages/shared/src/models.ts)` section with:

   ```markdown
   ## Model catalog (DB-backed)

   The inference model catalog lives in the `models` table and is managed from the
   Settings view (`/api/models` CRUD). The initial migration seeds: SONNET 4.5,
   OPUS 4.1 (ANTHROPIC), GROK 4, GROK 3 (xAI). A model referenced by a task cannot
   be deleted. Shared zod schemas: `ModelSchema`, `ModelInputSchema`,
   `ModelUpdateSchema`, id shape `MODEL_ID_RE`.
   ```

5. Frontend section — in the views list sentence, add:
   `Settings (inference model catalog: list with edit/remove + in-use counts, add-model form)`,
   and in the compose-drawer bullet change `model grid (from shared catalog)` to
   `model grid (from /api/models)`. Add `['models']` to the TanStack Query keys
   sentence: `(['tasks'], ['runs'], ['models'])`.

- [ ] **Step 4: Full verification**

Run: `pnpm exec biome check --write . && pnpm check && pnpm typecheck && pnpm test && pnpm build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(shared): drop hardcoded model catalog; document DB-backed catalog in SPEC"
```

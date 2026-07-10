# Model Pricing in Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each model's USD price per 1M input/output tokens on the Settings model list, editable manually and refreshable from OpenRouter with one button.

**Architecture:** Two nullable `double precision` columns on the existing `models` table flow through the shared zod schemas, the Hono REST routes, and the React `SettingsView`. A new `POST /api/models/sync-pricing` endpoint fetches OpenRouter's public model list and bulk-updates matched rows.

**Tech Stack:** Drizzle ORM (PostgreSQL, PGlite in tests), Hono, zod v4 (`@holonet/shared`), React + TanStack Query, node:test, Biome.

Spec: `docs/superpowers/specs/2026-07-10-model-pricing-design.md`

## Global Constraints

- Unit is **USD per 1,000,000 tokens**, stored as `double precision`, nullable.
- OpenRouter pricing (`pricing.prompt` / `pricing.completion`) is a string in USD **per single token** — multiply by 1,000,000 and round to 6 decimals.
- Sync never touches models that are not matched on OpenRouter or whose pricing does not parse to a finite number ≥ 0; both go in `notFound`.
- Work directly on `main` (user instruction). Commit after each task.
- Monorepo commands run from repo root: `pnpm check` (Biome), `pnpm typecheck`, `pnpm test`. Server-only tests: `pnpm --filter @holonet/server test`.
- `pnpm typecheck`/`pnpm test` build `@holonet/shared` first — required after editing `packages/shared`.

---

### Task 1: Price columns end-to-end (DB, shared schemas, serializer, CRUD)

The existing POST/PATCH handlers spread `parsed.data` into insert/update, so once the zod schemas and the Drizzle table know the new fields, CRUD works without touching `apps/server/src/api/models.ts`. Drizzle's `.set()` skips `undefined` keys, so PATCH semantics are: field absent → unchanged, `null` → cleared.

**Files:**
- Modify: `packages/shared/src/schemas.ts:12-34`
- Modify: `apps/server/src/db/schema.ts:51-59`
- Modify: `apps/server/src/api/serialize.ts:49-58`
- Create: `apps/server/drizzle/0003_*.sql` (generated, do not hand-write)
- Test: `apps/server/src/api/models.test.ts`

**Interfaces:**
- Produces: `Model` gains `inputCostPerMTok: number | null` and `outputCostPerMTok: number | null`; `ModelInput`/`ModelUpdate` gain the same as optional (`?: number | null | undefined`). `models` table gains `inputCostPerMTok` / `outputCostPerMTok` columns (`input_cost_per_mtok` / `output_cost_per_mtok`). Later tasks rely on these exact names.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/src/api/models.test.ts`:

```ts
test("models API: pricing fields", async () => {
  const { app, scheduler } = await buildApp();
  const auth = await loginHeaders(app);

  // Seeded models have no prices.
  const seeded = await app.request("/api/models", { headers: auth });
  const seededList = (await seeded.json()) as {
    inputCostPerMTok: number | null;
    outputCostPerMTok: number | null;
  }[];
  assert.ok(seededList.every((m) => m.inputCostPerMTok === null));
  assert.ok(seededList.every((m) => m.outputCostPerMTok === null));

  // Create with prices.
  const createRes = await app.request("/api/models", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId: "openai/gpt-5.2",
      label: "GPT 5.2",
      family: "OPENAI",
      inputCostPerMTok: 1.25,
      outputCostPerMTok: 10,
    }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as {
    id: string;
    inputCostPerMTok: number | null;
    outputCostPerMTok: number | null;
  };
  assert.equal(created.inputCostPerMTok, 1.25);
  assert.equal(created.outputCostPerMTok, 10);

  // Create without prices defaults to null.
  const bare = await app.request("/api/models", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ modelId: "openai/o5", label: "O5", family: "OPENAI" }),
  });
  assert.equal(bare.status, 201);
  const bareBody = (await bare.json()) as { inputCostPerMTok: number | null };
  assert.equal(bareBody.inputCostPerMTok, null);

  // Negative price rejected.
  const neg = await app.request("/api/models", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId: "openai/gpt-neg",
      label: "NEG",
      family: "OPENAI",
      inputCostPerMTok: -1,
    }),
  });
  assert.equal(neg.status, 400);

  // PATCH updates prices; omitting a field leaves it unchanged.
  const patch = await app.request(`/api/models/${created.id}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "GPT 5.2",
      family: "OPENAI",
      inputCostPerMTok: 2.5,
    }),
  });
  assert.equal(patch.status, 200);
  const patched = (await patch.json()) as {
    inputCostPerMTok: number | null;
    outputCostPerMTok: number | null;
  };
  assert.equal(patched.inputCostPerMTok, 2.5);
  assert.equal(patched.outputCostPerMTok, 10);

  // PATCH with null clears a price.
  const clear = await app.request(`/api/models/${created.id}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "GPT 5.2",
      family: "OPENAI",
      outputCostPerMTok: null,
    }),
  });
  assert.equal(clear.status, 200);
  const cleared = (await clear.json()) as {
    inputCostPerMTok: number | null;
    outputCostPerMTok: number | null;
  };
  assert.equal(cleared.inputCostPerMTok, 2.5);
  assert.equal(cleared.outputCostPerMTok, null);

  scheduler.stop();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @holonet/shared build && pnpm --filter @holonet/server test`
Expected: the new test FAILS (`inputCostPerMTok` is `undefined`, not `null`, on the seeded list; create with prices returns 400 or drops the fields). Pre-existing tests still pass.

- [ ] **Step 3: Add columns to the Drizzle schema**

In `apps/server/src/db/schema.ts`, add `doublePrecision` to the existing `drizzle-orm/pg-core` import, then:

```ts
export const models = pgTable("models", {
  id: uuid("id").primaryKey().defaultRandom(),
  modelId: text("model_id").notNull().unique(),
  label: text("label").notNull(),
  family: text("family").notNull(),
  inputCostPerMTok: doublePrecision("input_cost_per_mtok"),
  outputCostPerMTok: doublePrecision("output_cost_per_mtok"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @holonet/server db:generate`
Expected: a new file `apps/server/drizzle/0003_<name>.sql` containing exactly two statements:

```sql
ALTER TABLE "models" ADD COLUMN "input_cost_per_mtok" double precision;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "output_cost_per_mtok" double precision;
```

Plus updated `apps/server/drizzle/meta/` snapshot/journal. If drizzle-kit asks anything interactive, abort and re-check the schema edit (adding two nullable columns must not prompt).

- [ ] **Step 5: Extend the shared zod schemas**

In `packages/shared/src/schemas.ts`, replace `ModelInputSchema` and `ModelSchema` (`ModelUpdateSchema` derives via omit and needs no edit):

```ts
export const ModelInputSchema = z.object({
  modelId: z
    .string()
    .trim()
    .max(100)
    .regex(MODEL_ID_RE, "Expected an OpenRouter model id like vendor/model"),
  label: z.string().trim().min(1).max(40),
  family: z.string().trim().min(1).max(20),
  inputCostPerMTok: z.number().nonnegative().nullish(),
  outputCostPerMTok: z.number().nonnegative().nullish(),
});
```

```ts
export const ModelSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  label: z.string(),
  family: z.string(),
  inputCostPerMTok: z.number().nullable(),
  outputCostPerMTok: z.number().nullable(),
  createdAt: z.number(),
  inUse: z.number(),
});
```

- [ ] **Step 6: Extend the serializer**

In `apps/server/src/api/serialize.ts`:

```ts
export function rowToModel(row: ModelRow, inUse: number): Model {
  return {
    id: row.id,
    modelId: row.modelId,
    label: row.label,
    family: row.family,
    inputCostPerMTok: row.inputCostPerMTok,
    outputCostPerMTok: row.outputCostPerMTok,
    createdAt: row.createdAt.getTime(),
    inUse,
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @holonet/shared build && pnpm --filter @holonet/server test`
Expected: PASS, including the pre-existing `models API: CRUD...` and `migrations create and seed the model catalog` tests.

- [ ] **Step 8: Verify types and lint**

Run: `pnpm typecheck && pnpm check`
Expected: both clean. (`apps/web` still typechecks because the new `Model` fields are additive and `ModelInput` additions are optional.)

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/schemas.ts apps/server/src/db/schema.ts apps/server/src/api/serialize.ts apps/server/src/api/models.test.ts apps/server/drizzle
git commit -m "feat(server): per-1M-token pricing columns on model catalog"
```

---

### Task 2: `POST /api/models/sync-pricing` endpoint

**Files:**
- Modify: `apps/server/src/api/models.ts`
- Test: `apps/server/src/api/models.test.ts`

**Interfaces:**
- Consumes: `models.inputCostPerMTok` / `models.outputCostPerMTok` columns from Task 1.
- Produces: `POST /api/models/sync-pricing` → 200 `{ updated: string[], notFound: string[] }` (arrays of `modelId`s, both sorted alphabetically), or 502 `{ error: { code: "UPSTREAM", message: string } }` when the OpenRouter fetch fails. Task 3's client calls this exact route and shape.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/src/api/models.test.ts`. Follow the repo's fetch-mocking convention (`mock.method(globalThis, "fetch", ...)` + restore, as in `apps/server/src/services/openrouter.test.ts`) — add to the imports at the top of the file: `import { afterEach, mock, test } from "node:test";` (replacing the existing `import { test } from "node:test";`) and register `afterEach(() => mock.restoreAll());` right after the imports.

```ts
function pricingResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("models API: sync-pricing updates matched models from OpenRouter", async () => {
  const { app, scheduler } = await buildApp();
  const auth = await loginHeaders(app);

  mock.method(globalThis, "fetch", async () =>
    pricingResponse({
      data: [
        {
          id: "anthropic/claude-sonnet-4.5",
          pricing: { prompt: "0.000003", completion: "0.000015" },
        },
        {
          id: "anthropic/claude-opus-4.1",
          pricing: { prompt: "not-a-number", completion: "0.000075" },
        },
        {
          id: "some/other-model",
          pricing: { prompt: "0.000001", completion: "0.000002" },
        },
      ],
    }),
  );

  const res = await app.request("/api/models/sync-pricing", {
    method: "POST",
    headers: auth,
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { updated: string[]; notFound: string[] };
  assert.deepEqual(body.updated, ["anthropic/claude-sonnet-4.5"]);
  // Unmatched on OpenRouter, or matched with unparsable pricing.
  assert.deepEqual(body.notFound, [
    "anthropic/claude-opus-4.1",
    "x-ai/grok-3",
    "x-ai/grok-4",
  ]);

  const list = await app.request("/api/models", { headers: auth });
  const listBody = (await list.json()) as {
    modelId: string;
    inputCostPerMTok: number | null;
    outputCostPerMTok: number | null;
  }[];
  const sonnet = listBody.find(
    (m) => m.modelId === "anthropic/claude-sonnet-4.5",
  );
  assert.equal(sonnet?.inputCostPerMTok, 3);
  assert.equal(sonnet?.outputCostPerMTok, 15);
  const opus = listBody.find((m) => m.modelId === "anthropic/claude-opus-4.1");
  assert.equal(opus?.inputCostPerMTok, null);

  scheduler.stop();
});

test("models API: sync-pricing returns 502 when OpenRouter is down", async () => {
  const { app, scheduler } = await buildApp();
  const auth = await loginHeaders(app);

  mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });

  const res = await app.request("/api/models/sync-pricing", {
    method: "POST",
    headers: auth,
  });
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "UPSTREAM");

  scheduler.stop();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @holonet/server test`
Expected: both new tests FAIL with status 404 (route does not exist).

- [ ] **Step 3: Implement the endpoint**

In `apps/server/src/api/models.ts`, add near the other module-level helpers:

```ts
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

interface OpenRouterModelsResponse {
  data?: { id?: string; pricing?: { prompt?: string; completion?: string } }[];
}

// OpenRouter prices are USD per single token; catalog stores USD per 1M tokens.
function perMTok(perToken: string | undefined): number | null {
  const n = Number(perToken);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1_000_000 * 1_000_000) / 1_000_000;
}
```

Then register inside `createModelsRoutes`, before the `/:id` routes:

```ts
app.post("/sync-pricing", async (c) => {
  let byId: Map<string, { prompt?: string; completion?: string }>;
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`OpenRouter responded ${res.status}`);
    const body = (await res.json()) as OpenRouterModelsResponse;
    byId = new Map(
      (body.data ?? [])
        .filter((m) => typeof m.id === "string")
        .map((m) => [m.id as string, m.pricing ?? {}]),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "OpenRouter fetch failed";
    return c.json({ error: { code: "UPSTREAM" as const, message } }, 502);
  }

  const rows = await db.select().from(models);
  const updated: string[] = [];
  const notFound: string[] = [];
  for (const row of rows) {
    const pricing = byId.get(row.modelId);
    const input = perMTok(pricing?.prompt);
    const output = perMTok(pricing?.completion);
    if (!pricing || input === null || output === null) {
      notFound.push(row.modelId);
      continue;
    }
    await db
      .update(models)
      .set({ inputCostPerMTok: input, outputCostPerMTok: output })
      .where(eq(models.id, row.id));
    updated.push(row.modelId);
  }
  updated.sort();
  notFound.sort();
  return c.json({ updated, notFound });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @holonet/server test`
Expected: PASS (all server tests).

- [ ] **Step 5: Verify types and lint**

Run: `pnpm typecheck && pnpm check`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/api/models.ts apps/server/src/api/models.test.ts
git commit -m "feat(server): sync model pricing from OpenRouter"
```

---

### Task 3: Settings UI — price columns, form fields, sync button

`apps/web` has no test runner; verification is `pnpm typecheck` + `pnpm check` + a manual smoke check. Follow the view's existing inline-style patterns exactly (see the styles already in `SettingsView.tsx`).

**Files:**
- Modify: `apps/web/src/api/client.ts` (after `deleteModel`, ~line 147)
- Modify: `apps/web/src/components/Console.tsx` (model mutations ~line 120-137, SettingsView props ~line 218-232)
- Modify: `apps/web/src/views/SettingsView.tsx`

**Interfaces:**
- Consumes: `Model.inputCostPerMTok` / `Model.outputCostPerMTok` (Task 1); `POST /api/models/sync-pricing` → `{ updated: string[]; notFound: string[] }` (Task 2).
- Produces: `SettingsView` gains props `onSyncPricing: () => Promise<{ updated: string[]; notFound: string[] }>` and `isSyncing: boolean`.

- [ ] **Step 1: Add the API client function**

In `apps/web/src/api/client.ts` after `deleteModel`:

```ts
export interface SyncPricingResult {
  updated: string[];
  notFound: string[];
}

export function syncModelPricing() {
  return api.post<SyncPricingResult>("/api/models/sync-pricing");
}
```

(Check how `api.post` is actually shaped in this file — if model calls use a different helper form, e.g. `json<T>(path, { method: "POST" })`, mirror the neighboring `createModel` exactly.)

- [ ] **Step 2: Wire the mutation in Console**

In `apps/web/src/components/Console.tsx`, import `syncModelPricing` alongside the other model client functions, add after `deleteModelMutation`:

```ts
const syncPricingMutation = useMutation({
  mutationFn: () => syncModelPricing(),
  onSuccess: invalidateModels,
  onError: (error) => pushToast(errorMessage(error)),
});
```

and extend the `<SettingsView>` element:

```tsx
<SettingsView
  models={models}
  onCreate={(input) => createModelMutation.mutateAsync(input)}
  onUpdate={(id, input) => updateModelMutation.mutate({ id, input })}
  onDelete={(id) => deleteModelMutation.mutate(id)}
  onSyncPricing={() => syncPricingMutation.mutateAsync()}
  isSyncing={syncPricingMutation.isPending}
  isSaving={
    createModelMutation.isPending ||
    updateModelMutation.isPending ||
    deleteModelMutation.isPending
  }
/>
```

- [ ] **Step 3: Extend SettingsView**

In `apps/web/src/views/SettingsView.tsx`:

**3a. Props and helpers.** Extend the props interface and add a formatter + parser near `fieldInput`:

```ts
interface SettingsViewProps {
  models: Model[];
  onCreate: (input: ModelInput) => Promise<unknown>;
  onUpdate: (id: string, input: ModelUpdate) => void;
  onDelete: (id: string) => void;
  onSyncPricing: () => Promise<{ updated: string[]; notFound: string[] }>;
  isSaving: boolean;
  isSyncing: boolean;
}
```

```ts
// USD per 1M tokens, up to 3 decimals, trailing zeros dropped; null → em dash.
function fmtPrice(v: number | null): string {
  if (v === null) return "—";
  if (v >= 0.001) return String(Math.round(v * 1000) / 1000);
  return String(v);
}

// "" → null; invalid or negative → undefined (caller treats as form error).
function parsePrice(raw: string): number | null | undefined {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}
```

**3b. Form state.** Prices are kept as strings in form state:

```ts
const [addForm, setAddForm] = useState({
  modelId: "",
  label: "",
  family: "",
  inputCost: "",
  outputCost: "",
});
```

```ts
const [editForm, setEditForm] = useState({
  label: "",
  family: "",
  inputCost: "",
  outputCost: "",
});
```

`startEdit` seeds them: `inputCost: m.inputCostPerMTok === null ? "" : String(m.inputCostPerMTok)` (same for output). The add-form reset in `handleAdd` resets all five fields.

**3c. Submit handlers.** In `handleAdd`, parse both prices; `undefined` marks the field invalid (reuse the `showAddErrors` pattern — add `inputCostErr`/`outputCostErr` flags computed like `modelIdErr`, an error line entry "▸ PRICE MUST BE A NON-NEGATIVE NUMBER", and pass `error` into `fieldInput`). On success call:

```ts
onCreate({ modelId, label, family, inputCostPerMTok: inputCost, outputCostPerMTok: outputCost })
```

`handleEditSave` mirrors this: parse both; if either is `undefined`, return without saving; call `onUpdate(id, { label, family, inputCostPerMTok, outputCostPerMTok })` (always send both fields — null clears).

**3d. Add-form inputs.** Change the add-form grid to `gridTemplateColumns: "1.5fr 1fr 0.8fr 0.6fr 0.6fr auto"` and insert two fields between FAMILY and the ADD button, mirroring the existing label/input markup with `inputMode="decimal"`, ids `settings-model-input-cost` / `settings-model-output-cost`, labels `IN $/1M` and `OUT $/1M`, placeholder `e.g. 3`.

**3e. List row.** In the non-editing row, insert a price span between the `modelId` span and the in-use span:

```tsx
<span
  title="USD per 1M tokens (input / output)"
  style={{
    fontSize: "9.5px",
    letterSpacing: ".06em",
    color: m.inputCostPerMTok !== null || m.outputCostPerMTok !== null ? HI : DIM,
    width: "110px",
    flex: "none",
    textAlign: "right",
  }}
>
  {fmtPrice(m.inputCostPerMTok)} / {fmtPrice(m.outputCostPerMTok)} $
</span>
```

In the editing row, add two inputs (width 70px each, `inputMode="decimal"`, aria-labels "Input cost per 1M tokens" / "Output cost per 1M tokens") bound to `editForm.inputCost` / `editForm.outputCost`, placed after the family input.

**3f. Sync button and status.** Add local state `const [syncStatus, setSyncStatus] = useState<string | null>(null);` and a handler:

```ts
function handleSync() {
  setSyncStatus(null);
  onSyncPricing()
    .then((r) => {
      const notFound =
        r.notFound.length > 0 ? ` · NOT ON OPENROUTER: ${r.notFound.join(", ")}` : "";
      setSyncStatus(`UPDATED ${r.updated.length} MODEL(S)${notFound}`);
    })
    .catch(() => {
      // error toast is handled by the mutation's onError
      setSyncStatus("SYNC FAILED");
    });
}
```

Render below the section description (before the model list), styled with the existing `smallButton`:

```tsx
<div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "12px" }}>
  <button type="button" onClick={handleSync} disabled={isSyncing} style={{ ...smallButton, opacity: isSyncing ? 0.5 : 1 }}>
    {isSyncing ? "SYNCING…" : "SYNC PRICES FROM OPENROUTER"}
  </button>
  {syncStatus && (
    <span style={{ fontSize: "9px", letterSpacing: ".1em", color: DIM }}>{syncStatus}</span>
  )}
</div>
```

- [ ] **Step 4: Verify types and lint**

Run: `pnpm typecheck && pnpm check`
Expected: both clean. Fix any Biome formatting complaints with `pnpm biome check --write .` limited to the touched files.

- [ ] **Step 5: Manual smoke check**

Not automatable here; final verification task covers the full suite. If a dev server is available: settings page shows the two price values per row, add/edit forms accept and clear prices, sync button reports a status line.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/components/Console.tsx apps/web/src/views/SettingsView.tsx
git commit -m "feat(web): model pricing columns, form fields, and OpenRouter sync in settings"
```

---

### Task 4: Full verification

- [ ] **Step 1: Run the complete suite**

Run from repo root: `pnpm check && pnpm typecheck && pnpm test`
Expected: all three exit 0. Any failure is fixed before the feature is called done.

- [ ] **Step 2: Commit any stragglers**

Only if verification required fixes:

```bash
git add -A && git commit -m "fix: verification fixes for model pricing"
```

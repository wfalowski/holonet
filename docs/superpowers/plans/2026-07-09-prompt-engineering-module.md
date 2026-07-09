# Prompt Engineering Module (PROMPTS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PROMPTS module to Holonet: prompt library with folders/tags/immutable versioning, LLM-driven prompt optimizer, version × model A/B experiments, and a visual JSON-schema builder with live testing.

**Architecture:** Six new Postgres tables behind new Hono route modules; shared Zod contracts and pure utilities in `@holonet/shared`; an in-process experiment runner (concurrency 3, boot recovery); a sixth Rail view in the React SPA with three tabs (Library / Experiments / Schemas) polling via TanStack Query.

**Tech Stack:** Hono 4, Drizzle ORM (PostgreSQL / pglite in tests), Zod, React 19, TanStack Query v5, node:test, Biome.

**Spec:** `docs/superpowers/specs/2026-07-09-prompt-engineering-module-design.md` (authoritative for behavior).

## Global Constraints

- Biome defaults: 2-space indent, double quotes. Verify with `pnpm check` (root). NOT eslint.
- No `any`. String-literal unions + `as const`, never TS enums. Validate only at IO boundaries (Zod in routes); internals use inferred types.
- All relative TS imports carry a `.js` suffix (NodeNext ESM), e.g. `import { x } from "./y.js"`.
- API exposes timestamps as **epoch milliseconds** (`row.createdAt.getTime()`), DB stores `timestamptz`.
- API errors always shaped `{ error: { code, message } }` with codes from `ApiErrorCodeSchema` (`packages/shared/src/schemas.ts:112`).
- Server test glob stays quoted: `node --test "src/**/*.test.ts"` — do not touch the `test` script.
- No new dependencies. No new env vars (reuse `config.openrouterApiKey`).
- Never log or embed `APP_KEY`, the OpenRouter key, or webhook tokens in errors.
- Web: inline styles only, constants from `apps/web/src/lib/theme.ts` (AMBER/OK/BAD/DIM/HI/CHAKRA…), aesthetic per `design/Holonet.dc.html` and existing views. No Tailwind, no CSS files.
- Web plugin (`plugins: [{id:"web"}]`) is **never** sent on the playground/experiment/optimizer path — it belongs to the news pipeline only.
- Commit after every task with the message given in its final step.

---

### Task 1: Shared contracts (`prompting.ts`)

**Files:**
- Create: `packages/shared/src/prompting.ts`
- Create: `packages/shared/src/prompting.test.ts`
- Modify: `packages/shared/src/index.ts` (barrel)

**Interfaces:**
- Consumes: `MODEL_ID_RE` from `./schemas.js`.
- Produces (used by every later task): all Zod schemas + inferred types below — exact names matter: `FolderSchema/Folder`, `FolderInputSchema/FolderInput`, `PromptSchema/Prompt`, `PromptDetailSchema/PromptDetail`, `PromptInputSchema/PromptInput`, `PromptMetaUpdateSchema/PromptMetaUpdate`, `PromptVersionSchema/PromptVersion`, `PromptVersionInputSchema/PromptVersionInput`, `OptimizeInputSchema/OptimizeInput`, `OptimizeOutputSchema/OptimizeOutput`, `ExperimentStatus`, `ResultStatus`, `ExperimentInputSchema/ExperimentInput`, `ExperimentSchema/Experiment`, `ExperimentDetailSchema/ExperimentDetail`, `ExperimentResultSchema/ExperimentResult`, `SchemaFieldType`, `SchemaField`, `SchemaFieldSchema`, `SchemaDocSchema/SchemaDoc`, `SchemaDocInputSchema/SchemaDocInput`, `PlaygroundRunInputSchema/PlaygroundRunInput`, `PlaygroundRunOutputSchema/PlaygroundRunOutput`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/prompting.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ExperimentInputSchema,
  PromptInputSchema,
  SchemaFieldSchema,
} from "./prompting.js";

test("PromptInputSchema defaults folderId/schemaId to null and tags to []", () => {
  const parsed = PromptInputSchema.parse({ name: "News", content: "Say hi" });
  assert.equal(parsed.folderId, null);
  assert.equal(parsed.schemaId, null);
  assert.deepEqual(parsed.tags, []);
});

test("SchemaFieldSchema parses recursive object/array/enum fields", () => {
  const field = SchemaFieldSchema.parse({
    name: "items",
    type: "array",
    required: true,
    items: {
      name: "item",
      type: "object",
      required: true,
      children: [
        { name: "title", type: "string", required: true },
        {
          name: "severity",
          type: "enum",
          required: false,
          enumValues: ["low", "high"],
        },
      ],
    },
  });
  assert.equal(field.items?.children?.length, 2);
});

test("ExperimentInputSchema rejects empty version/model lists", () => {
  assert.equal(
    ExperimentInputSchema.safeParse({
      promptId: "0b8f4a52-1111-4222-8333-444455556666",
      versionIds: [],
      modelIds: ["a/b"],
    }).success,
    false,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @holonet/shared test`
Expected: FAIL — `Cannot find module './prompting.js'`.

- [ ] **Step 3: Write the implementation**

`packages/shared/src/prompting.ts`:

```ts
import { z } from "zod";
import { MODEL_ID_RE } from "./schemas.js";

// ---- Folders ----

export const FolderInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
});
export type FolderInput = z.infer<typeof FolderInputSchema>;

export const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  promptCount: z.number(),
  createdAt: z.number(),
});
export type Folder = z.infer<typeof FolderSchema>;

// ---- Structured-output schema fields (recursive) ----

export const SchemaFieldTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "enum",
  "object",
  "array",
]);
export type SchemaFieldType = z.infer<typeof SchemaFieldTypeSchema>;

export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  description?: string;
  required: boolean;
  /** type === "enum" */
  enumValues?: string[];
  /** type === "object" */
  children?: SchemaField[];
  /** type === "array" — item descriptor; its name is unused (builder uses "item") */
  items?: SchemaField;
}

export const SchemaFieldSchema: z.ZodType<SchemaField> = z.lazy(() =>
  z.object({
    name: z.string().trim().min(1).max(40),
    type: SchemaFieldTypeSchema,
    description: z.string().trim().max(200).optional(),
    required: z.boolean(),
    enumValues: z.array(z.string().min(1)).min(1).optional(),
    children: z.array(SchemaFieldSchema).optional(),
    items: SchemaFieldSchema.optional(),
  }),
);

export const SchemaDocInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  fields: z.array(SchemaFieldSchema).min(1).max(40),
});
export type SchemaDocInput = z.infer<typeof SchemaDocInputSchema>;

export const SchemaDocSchema = z.object({
  id: z.string(),
  name: z.string(),
  fields: z.array(SchemaFieldSchema),
  attachedTo: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SchemaDoc = z.infer<typeof SchemaDocSchema>;

// ---- Prompts & versions ----

export const PromptInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  folderId: z.string().uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(24)).max(12).default([]),
  schemaId: z.string().uuid().nullable().default(null),
  content: z.string().min(1),
});
export type PromptInput = z.infer<typeof PromptInputSchema>;

export const PromptMetaUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  folderId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
  schemaId: z.string().uuid().nullable().optional(),
});
export type PromptMetaUpdate = z.infer<typeof PromptMetaUpdateSchema>;

export const PromptSchema = z.object({
  id: z.string(),
  name: z.string(),
  folderId: z.string().nullable(),
  tags: z.array(z.string()),
  schemaId: z.string().nullable(),
  headVersion: z.number(),
  versionCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Prompt = z.infer<typeof PromptSchema>;

export const PromptVersionInputSchema = z.object({
  content: z.string().min(1),
  note: z.string().trim().max(200).optional(),
});
export type PromptVersionInput = z.infer<typeof PromptVersionInputSchema>;

export const PromptVersionSchema = z.object({
  id: z.string(),
  promptId: z.string(),
  version: z.number(),
  content: z.string(),
  note: z.string().nullable(),
  createdAt: z.number(),
});
export type PromptVersion = z.infer<typeof PromptVersionSchema>;

export const PromptDetailSchema = PromptSchema.extend({
  versions: z.array(PromptVersionSchema),
});
export type PromptDetail = z.infer<typeof PromptDetailSchema>;

// ---- Optimizer ----

export const OptimizeInputSchema = z.object({
  versionId: z.string().uuid(),
  targetModelId: z.string().regex(MODEL_ID_RE),
  optimizerModelId: z.string().regex(MODEL_ID_RE),
});
export type OptimizeInput = z.infer<typeof OptimizeInputSchema>;

export const OptimizeOutputSchema = z.object({
  improved: z.string(),
  rationale: z.string(),
});
export type OptimizeOutput = z.infer<typeof OptimizeOutputSchema>;

// ---- Experiments ----

export const ExperimentStatus = z.enum(["running", "done", "failed"]);
export type ExperimentStatus = z.infer<typeof ExperimentStatus>;

export const ResultStatus = z.enum(["pending", "ok", "fail"]);
export type ResultStatus = z.infer<typeof ResultStatus>;

export const ExperimentInputSchema = z.object({
  promptId: z.string().uuid(),
  versionIds: z.array(z.string().uuid()).min(1).max(10),
  modelIds: z.array(z.string().regex(MODEL_ID_RE)).min(1).max(10),
});
export type ExperimentInput = z.infer<typeof ExperimentInputSchema>;

export const ExperimentResultSchema = z.object({
  id: z.string(),
  experimentId: z.string(),
  versionId: z.string(),
  versionNumber: z.number(),
  modelId: z.string(),
  status: ResultStatus,
  output: z.string(),
  errorMessage: z.string().nullable(),
  durationMs: z.number(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
  costUsd: z.string().nullable(),
  winner: z.boolean(),
});
export type ExperimentResult = z.infer<typeof ExperimentResultSchema>;

export const ExperimentSchema = z.object({
  id: z.string(),
  promptId: z.string().nullable(),
  promptName: z.string(),
  status: ExperimentStatus,
  okCount: z.number(),
  failCount: z.number(),
  totalCount: z.number(),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

export const ExperimentDetailSchema = ExperimentSchema.extend({
  results: z.array(ExperimentResultSchema),
});
export type ExperimentDetail = z.infer<typeof ExperimentDetailSchema>;

// ---- Playground ----

export const PlaygroundRunInputSchema = z.object({
  content: z.string().min(1),
  modelId: z.string().regex(MODEL_ID_RE),
  schemaId: z.string().uuid().nullable().default(null),
});
export type PlaygroundRunInput = z.infer<typeof PlaygroundRunInputSchema>;

export const PlaygroundRunOutputSchema = z.object({
  output: z.string(),
  durationMs: z.number(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
  costUsd: z.string().nullable(),
  validation: z
    .object({ valid: z.boolean(), errors: z.array(z.string()) })
    .nullable(),
});
export type PlaygroundRunOutput = z.infer<typeof PlaygroundRunOutputSchema>;
```

Append to `packages/shared/src/index.ts`:

```ts
export * from "./prompting.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @holonet/shared test`
Expected: PASS (all shared tests, including pre-existing ones).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @holonet/shared build && pnpm check
git add packages/shared/src/prompting.ts packages/shared/src/prompting.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): zod contracts for the prompt-engineering module"
```

---

### Task 2: Shared pure utilities — `fieldsToJsonSchema`, `validateFields`, `lineDiff`

**Files:**
- Create: `packages/shared/src/jsonSchema.ts`
- Create: `packages/shared/src/jsonSchema.test.ts`
- Create: `packages/shared/src/diff.ts`
- Create: `packages/shared/src/diff.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `SchemaField` from `./prompting.js` (Task 1).
- Produces: `fieldsToJsonSchema(fields: SchemaField[]): JsonSchemaObject` and `validateFields(fields: SchemaField[], value: unknown, path?: string): string[]` (used by playground route, experiment runner, web schema preview); `lineDiff(before: string, after: string): DiffLine[]` with `DiffLine = { kind: "same" | "add" | "del"; text: string }` (used by web version diff and optimizer diff).

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/jsonSchema.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SchemaField } from "./prompting.js";
import { fieldsToJsonSchema, validateFields } from "./jsonSchema.js";

const FIELDS: SchemaField[] = [
  { name: "title", type: "string", required: true, description: "Headline" },
  { name: "score", type: "number", required: false },
  {
    name: "severity",
    type: "enum",
    required: true,
    enumValues: ["low", "high"],
  },
  {
    name: "meta",
    type: "object",
    required: false,
    children: [{ name: "source", type: "string", required: true }],
  },
  {
    name: "tags",
    type: "array",
    required: true,
    items: { name: "item", type: "string", required: true },
  },
];

test("fieldsToJsonSchema builds a closed object schema", () => {
  const schema = fieldsToJsonSchema(FIELDS) as {
    type: string;
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, Record<string, unknown>>;
  };
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["title", "severity", "tags"]);
  assert.deepEqual(schema.properties.title, {
    type: "string",
    description: "Headline",
  });
  assert.deepEqual(schema.properties.severity, {
    type: "string",
    enum: ["low", "high"],
  });
  assert.equal(schema.properties.meta?.type, "object");
  assert.deepEqual(schema.properties.tags, {
    type: "array",
    items: { type: "string" },
  });
});

test("validateFields accepts a conforming object", () => {
  const errors = validateFields(FIELDS, {
    title: "hi",
    severity: "low",
    tags: ["a"],
  });
  assert.deepEqual(errors, []);
});

test("validateFields reports missing/wrong/unexpected fields with paths", () => {
  const errors = validateFields(FIELDS, {
    score: "not-a-number",
    severity: "medium",
    tags: [1],
    extra: true,
  });
  assert.ok(errors.some((e) => e.includes("$.title") && e.includes("missing")));
  assert.ok(errors.some((e) => e.includes("$.score")));
  assert.ok(errors.some((e) => e.includes("$.severity")));
  assert.ok(errors.some((e) => e.includes("$.tags[0]")));
  assert.ok(errors.some((e) => e.includes("$.extra")));
});

test("validateFields rejects non-objects", () => {
  assert.deepEqual(validateFields(FIELDS, "nope"), ["$: expected object"]);
});
```

`packages/shared/src/diff.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { lineDiff } from "./diff.js";

test("identical strings produce only same lines", () => {
  assert.deepEqual(lineDiff("a\nb", "a\nb"), [
    { kind: "same", text: "a" },
    { kind: "same", text: "b" },
  ]);
});

test("added and removed lines are marked", () => {
  const diff = lineDiff("a\nb\nc", "a\nx\nc");
  assert.deepEqual(diff, [
    { kind: "same", text: "a" },
    { kind: "del", text: "b" },
    { kind: "add", text: "x" },
    { kind: "same", text: "c" },
  ]);
});

test("pure additions at the end", () => {
  assert.deepEqual(lineDiff("a", "a\nb"), [
    { kind: "same", text: "a" },
    { kind: "add", text: "b" },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @holonet/shared test`
Expected: FAIL — cannot find `./jsonSchema.js` / `./diff.js`.

- [ ] **Step 3: Write the implementations**

`packages/shared/src/jsonSchema.ts`:

```ts
import type { SchemaField } from "./prompting.js";

export type JsonSchemaObject = Record<string, unknown>;

function fieldSchema(field: SchemaField): JsonSchemaObject {
  const description = field.description
    ? { description: field.description }
    : {};
  switch (field.type) {
    case "string":
      return { type: "string", ...description };
    case "number":
      return { type: "number", ...description };
    case "boolean":
      return { type: "boolean", ...description };
    case "enum":
      return { type: "string", enum: field.enumValues ?? [], ...description };
    case "object":
      return { ...objectSchema(field.children ?? []), ...description };
    case "array":
      return {
        type: "array",
        items: field.items ? fieldSchema(field.items) : {},
        ...description,
      };
  }
}

function objectSchema(fields: SchemaField[]): JsonSchemaObject {
  const properties: Record<string, JsonSchemaObject> = {};
  for (const field of fields) properties[field.name] = fieldSchema(field);
  return {
    type: "object",
    properties,
    required: fields.filter((f) => f.required).map((f) => f.name),
    additionalProperties: false,
  };
}

/** Derive a JSON Schema document from the builder field tree. Deterministic. */
export function fieldsToJsonSchema(fields: SchemaField[]): JsonSchemaObject {
  return objectSchema(fields);
}

function validateOne(
  field: SchemaField,
  value: unknown,
  path: string,
): string[] {
  switch (field.type) {
    case "string":
      return typeof value === "string" ? [] : [`${path}: expected string`];
    case "number":
      return typeof value === "number" ? [] : [`${path}: expected number`];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${path}: expected boolean`];
    case "enum": {
      const allowed = field.enumValues ?? [];
      return typeof value === "string" && allowed.includes(value)
        ? []
        : [`${path}: expected one of ${allowed.join(", ")}`];
    }
    case "object":
      return validateFields(field.children ?? [], value, path);
    case "array": {
      if (!Array.isArray(value)) return [`${path}: expected array`];
      const items = field.items;
      if (!items) return [];
      return value.flatMap((entry, i) =>
        validateOne(items, entry, `${path}[${i}]`),
      );
    }
  }
}

/** Validate a parsed JSON value against the field tree. Returns readable errors. */
export function validateFields(
  fields: SchemaField[],
  value: unknown,
  path = "$",
): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [`${path}: expected object`];
  }
  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const field of fields) {
    const entry = record[field.name];
    if (entry === undefined) {
      if (field.required) {
        errors.push(`${path}.${field.name}: missing required field`);
      }
      continue;
    }
    errors.push(...validateOne(field, entry, `${path}.${field.name}`));
  }
  for (const key of Object.keys(record)) {
    if (!fields.some((f) => f.name === key)) {
      errors.push(`${path}.${key}: unexpected field`);
    }
  }
  return errors;
}
```

`packages/shared/src/diff.ts`:

```ts
export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Simple LCS line diff — fine for prompt-sized inputs. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    const row = dp[i] ?? [];
    const below = dp[i + 1] ?? [];
    for (let j = n - 1; j >= 0; j--) {
      row[j] =
        a[i] === b[j]
          ? (below[j + 1] ?? 0) + 1
          : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] ?? "" });
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({ kind: "del", text: a[i] ?? "" });
      i++;
    } else {
      out.push({ kind: "add", text: b[j] ?? "" });
      j++;
    }
  }
  while (i < m) out.push({ kind: "del", text: a[i++] ?? "" });
  while (j < n) out.push({ kind: "add", text: b[j++] ?? "" });
  return out;
}
```

Append to `packages/shared/src/index.ts`:

```ts
export * from "./jsonSchema.js";
export * from "./diff.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @holonet/shared test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @holonet/shared build && pnpm check
git add packages/shared/src
git commit -m "feat(shared): fieldsToJsonSchema, validateFields, lineDiff utilities"
```

---

### Task 3: DB schema + migration (6 tables)

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/drizzle/00XX_*.sql` (generated — do not hand-write)

**Interfaces:**
- Consumes: `SchemaField` type from `@holonet/shared`.
- Produces: table objects `promptFolders`, `prompts`, `promptVersions`, `experiments`, `experimentResults`, `outputSchemas` (table name `"schemas"`) and row types `PromptFolderRow`, `PromptRow`, `PromptVersionRow`, `ExperimentRow`, `ExperimentResultRow`, `OutputSchemaRow` (+ `New*Row` inserts) — used by every server task.

- [ ] **Step 1: Extend the Drizzle schema**

In `apps/server/src/db/schema.ts`, add `uniqueIndex` to the existing `drizzle-orm/pg-core` import, add `import type { SchemaField } from "@holonet/shared";` at the top, and append after the `models` table:

```ts
export const promptFolders = pgTable("prompt_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const outputSchemas = pgTable("schemas", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  fields: jsonb("fields").$type<SchemaField[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const prompts = pgTable("prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  folderId: uuid("folder_id").references(() => promptFolders.id, {
    onDelete: "set null",
  }),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  schemaId: uuid("schema_id").references(() => outputSchemas.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("prompt_versions_prompt_version_idx").on(
      table.promptId,
      table.version,
    ),
  ],
);

export const experiments = pgTable("experiments", {
  id: uuid("id").primaryKey().defaultRandom(),
  promptId: uuid("prompt_id").references(() => prompts.id, {
    onDelete: "set null",
  }),
  promptName: text("prompt_name").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const experimentResults = pgTable(
  "experiment_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    modelId: text("model_id").notNull(),
    status: text("status").notNull().default("pending"),
    output: text("output").notNull().default(""),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms").notNull().default(0),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: text("cost_usd"),
    winner: boolean("winner").notNull().default(false),
  },
  (table) => [
    index("experiment_results_experiment_id_idx").on(table.experimentId),
  ],
);
```

And extend the row-type exports at the bottom:

```ts
export type PromptFolderRow = typeof promptFolders.$inferSelect;
export type NewPromptFolderRow = typeof promptFolders.$inferInsert;
export type PromptRow = typeof prompts.$inferSelect;
export type NewPromptRow = typeof prompts.$inferInsert;
export type PromptVersionRow = typeof promptVersions.$inferSelect;
export type NewPromptVersionRow = typeof promptVersions.$inferInsert;
export type ExperimentRow = typeof experiments.$inferSelect;
export type NewExperimentRow = typeof experiments.$inferInsert;
export type ExperimentResultRow = typeof experimentResults.$inferSelect;
export type NewExperimentResultRow = typeof experimentResults.$inferInsert;
export type OutputSchemaRow = typeof outputSchemas.$inferSelect;
export type NewOutputSchemaRow = typeof outputSchemas.$inferInsert;
```

Note `experimentResults.versionId` is a plain uuid, **not** an FK — results must survive prompt/version deletion (denormalized `versionNumber` covers display).

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @holonet/server db:generate`
Expected: a new SQL file under `apps/server/drizzle/` creating `prompt_folders`, `schemas`, `prompts`, `prompt_versions`, `experiments`, `experiment_results`, plus updated `meta/_journal.json`. Inspect the SQL — it must contain the two FK `set null` clauses, the cascade FKs, and the unique index on `(prompt_id, version)`. Do not edit generated files by hand.

- [ ] **Step 3: Verify migrations apply (existing migration test exercises pglite)**

Run: `pnpm --filter @holonet/server test`
Expected: PASS — `src/db/migrations.test.ts` migrates the full folder against in-memory Postgres; failures here mean the generated SQL is broken.

- [ ] **Step 4: Commit**

```bash
pnpm typecheck && pnpm check
git add apps/server/src/db/schema.ts apps/server/drizzle
git commit -m "feat(server): DB schema + migration for prompt-engineering tables"
```

---

### Task 4: OpenRouter service — `chatCompleteDetailed` + `schemaResponseFormat`

**Files:**
- Modify: `apps/server/src/services/openrouter.ts`
- Create: `apps/server/src/services/openrouter.test.ts`

**Interfaces:**
- Consumes: `SchemaField`, `fieldsToJsonSchema` from `@holonet/shared`.
- Produces (used by playground, optimizer route, experiment runner):

```ts
export interface ResponseFormat {
  type: "json_schema";
  json_schema: { name: string; strict: true; schema: Record<string, unknown> };
}
export interface ChatCompleteDetailedOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  responseFormat?: ResponseFormat;
  signal?: AbortSignal;
}
export interface ChatCompletionDetails {
  content: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: string | null;
}
export function schemaResponseFormat(name: string, fields: SchemaField[]): ResponseFormat;
export function chatCompleteDetailed(o: ChatCompleteDetailedOptions): Promise<ChatCompletionDetails>;
```

- Existing `chatComplete(options: ChatCompleteOptions): Promise<string>` keeps its exact signature and behavior (the task executor depends on it).

- [ ] **Step 1: Write the failing test**

`apps/server/src/services/openrouter.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { chatCompleteDetailed, schemaResponseFormat } from "./openrouter.js";

afterEach(() => mock.restoreAll());

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("chatCompleteDetailed sends usage.include and response_format, maps usage", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    okResponse({
      choices: [{ message: { content: '{"a":1}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 7, cost: 0.00042 },
    }),
  );
  const format = schemaResponseFormat("My Schema!", [
    { name: "a", type: "number", required: true },
  ]);
  const result = await chatCompleteDetailed({
    apiKey: "k",
    model: "vendor/model",
    messages: [{ role: "user", content: "go" }],
    responseFormat: format,
  });
  assert.equal(result.content, '{"a":1}');
  assert.equal(result.tokensIn, 12);
  assert.equal(result.tokensOut, 7);
  assert.equal(result.costUsd, "0.00042");

  const init = fetchMock.mock.calls[0]?.arguments[1];
  const body = JSON.parse(String(init?.body));
  assert.deepEqual(body.usage, { include: true });
  assert.equal(body.response_format.json_schema.name, "My_Schema_");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.plugins, undefined);
});

test("chatCompleteDetailed tolerates missing usage", async () => {
  mock.method(globalThis, "fetch", async () =>
    okResponse({ choices: [{ message: { content: "hi" } }] }),
  );
  const result = await chatCompleteDetailed({
    apiKey: "k",
    model: "vendor/model",
    messages: [{ role: "user", content: "go" }],
  });
  assert.equal(result.tokensIn, null);
  assert.equal(result.costUsd, null);
});

test("chatCompleteDetailed throws on non-2xx without leaking the key", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () => new Response("nope", { status: 500 }),
  );
  await assert.rejects(
    chatCompleteDetailed({
      apiKey: "secret-key",
      model: "vendor/model",
      messages: [{ role: "user", content: "go" }],
    }),
    (err: Error) => !err.message.includes("secret-key"),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @holonet/server test`
Expected: FAIL — `chatCompleteDetailed` is not exported.

- [ ] **Step 3: Refactor the service**

Replace `apps/server/src/services/openrouter.ts` with (keeps `chatComplete` behavior byte-for-byte at the HTTP level for the executor path):

```ts
import { fieldsToJsonSchema, type SchemaField } from "@holonet/shared";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatCompleteOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  webSearch: boolean;
  signal?: AbortSignal;
}

export interface ResponseFormat {
  type: "json_schema";
  json_schema: {
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
}

export interface ChatCompleteDetailedOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  responseFormat?: ResponseFormat;
  signal?: AbortSignal;
}

export interface ChatCompletionDetails {
  content: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: string | null;
}

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 120_000;

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

// POST to OpenRouter chat-completions. Enforces a 120s ceiling merged with any
// caller signal and rejects on non-2xx. Never embeds the API key in thrown errors.
async function request(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ChatCompletionResponse> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/holonet",
      "X-Title": "Holonet",
    },
    body: JSON.stringify(body),
    signal: combined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter request failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as ChatCompletionResponse;
}

function requireContent(data: ChatCompletionResponse): string {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("OpenRouter returned empty content");
  }
  return content;
}

export async function chatComplete({
  apiKey,
  model,
  messages,
  webSearch,
  signal,
}: ChatCompleteOptions): Promise<string> {
  const data = await request(
    apiKey,
    { model, messages, plugins: webSearch ? [{ id: "web" }] : undefined },
    signal,
  );
  return requireContent(data);
}

// Playground/experiment/optimizer path: no web plugin ever, usage accounting on,
// optional strict json_schema response format.
export async function chatCompleteDetailed({
  apiKey,
  model,
  messages,
  responseFormat,
  signal,
}: ChatCompleteDetailedOptions): Promise<ChatCompletionDetails> {
  const data = await request(
    apiKey,
    {
      model,
      messages,
      response_format: responseFormat,
      usage: { include: true },
    },
    signal,
  );
  return {
    content: requireContent(data),
    tokensIn: data.usage?.prompt_tokens ?? null,
    tokensOut: data.usage?.completion_tokens ?? null,
    costUsd: data.usage?.cost != null ? String(data.usage.cost) : null,
  };
}

export function schemaResponseFormat(
  name: string,
  fields: SchemaField[],
): ResponseFormat {
  return {
    type: "json_schema",
    json_schema: {
      name: name.replace(/[^a-zA-Z0-9_-]/g, "_") || "output",
      strict: true,
      schema: fieldsToJsonSchema(fields),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass (including executor tests — the shared path must not regress)**

Run: `pnpm --filter @holonet/server test`
Expected: PASS, including `src/scheduler/executor.test.ts`.

- [ ] **Step 5: Commit**

```bash
pnpm check
git add apps/server/src/services/openrouter.ts apps/server/src/services/openrouter.test.ts
git commit -m "feat(server): chatCompleteDetailed with usage + json_schema response format"
```

---

### Task 5: Serializers + folders routes

**Files:**
- Create: `apps/server/src/api/promptSerialize.ts`
- Create: `apps/server/src/api/folders.ts`
- Create: `apps/server/src/api/folders.test.ts`
- Modify: `apps/server/src/app.ts` (register route)

**Interfaces:**
- Consumes: row types from Task 3, contract types from Task 1, `buildApp`/`loginHeaders` from `apps/server/src/api/test-helpers.ts`.
- Produces: `createFoldersRoutes(db: Db): Hono`; serializers used by Tasks 6–10: `rowToFolder(row, promptCount)`, `rowToPrompt(row, headVersion, versionCount)`, `rowToPromptVersion(row)`, `rowToExperiment(row, counts: { ok: number; fail: number; total: number })`, `rowToExperimentResult(row)`, `rowToSchemaDoc(row, attachedTo)`.

- [ ] **Step 1: Write the failing test**

`apps/server/src/api/folders.test.ts` (follow the style of `apps/server/src/api/models.test.ts`):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { promptFolders, prompts } from "../db/schema.js";
import { buildApp, loginHeaders } from "./test-helpers.js";

test("folders CRUD with prompt counts and set-null on delete", async () => {
  const { app, db } = await buildApp();
  const headers = await loginHeaders(app);

  // create
  const created = await app.request("/api/folders", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "News" }),
  });
  assert.equal(created.status, 201);
  const folder = (await created.json()) as { id: string; name: string };
  assert.equal(folder.name, "News");

  // duplicate name -> 409
  const dupe = await app.request("/api/folders", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "News" }),
  });
  assert.equal(dupe.status, 409);

  // a prompt in the folder shows up in promptCount
  const now = new Date();
  await db.insert(prompts).values({
    name: "p1",
    folderId: folder.id,
    createdAt: now,
    updatedAt: now,
  });
  const list = await app.request("/api/folders", { headers });
  assert.equal(list.status, 200);
  const folders = (await list.json()) as { id: string; promptCount: number }[];
  assert.equal(folders.find((f) => f.id === folder.id)?.promptCount, 1);

  // rename
  const renamed = await app.request(`/api/folders/${folder.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Research" }),
  });
  assert.equal(renamed.status, 200);

  // delete -> prompt keeps living, folderId nulled by FK
  const deleted = await app.request(`/api/folders/${folder.id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleted.status, 204);
  const orphaned = await db
    .select()
    .from(prompts)
    .where(eq(prompts.name, "p1"));
  assert.equal(orphaned[0]?.folderId, null);
  const gone = await db
    .select()
    .from(promptFolders)
    .where(eq(promptFolders.id, folder.id));
  assert.equal(gone.length, 0);
});

test("folders reject invalid payloads and unknown ids", async () => {
  const { app } = await buildApp();
  const headers = await loginHeaders(app);
  const bad = await app.request("/api/folders", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "" }),
  });
  assert.equal(bad.status, 400);
  const missing = await app.request(
    "/api/folders/00000000-0000-4000-8000-000000000000",
    { method: "DELETE", headers },
  );
  assert.equal(missing.status, 404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @holonet/server test`
Expected: FAIL — 404s (route not registered) / module not found.

- [ ] **Step 3: Write serializers and routes**

`apps/server/src/api/promptSerialize.ts`:

```ts
import type {
  Experiment,
  ExperimentResult,
  ExperimentStatus,
  Folder,
  Prompt,
  PromptVersion,
  ResultStatus,
  SchemaDoc,
} from "@holonet/shared";
import type {
  ExperimentResultRow,
  ExperimentRow,
  OutputSchemaRow,
  PromptFolderRow,
  PromptRow,
  PromptVersionRow,
} from "../db/schema.js";

export function rowToFolder(row: PromptFolderRow, promptCount: number): Folder {
  return {
    id: row.id,
    name: row.name,
    promptCount,
    createdAt: row.createdAt.getTime(),
  };
}

export function rowToPrompt(
  row: PromptRow,
  headVersion: number,
  versionCount: number,
): Prompt {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folderId,
    tags: row.tags,
    schemaId: row.schemaId,
    headVersion,
    versionCount,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function rowToPromptVersion(row: PromptVersionRow): PromptVersion {
  return {
    id: row.id,
    promptId: row.promptId,
    version: row.version,
    content: row.content,
    note: row.note,
    createdAt: row.createdAt.getTime(),
  };
}

export function rowToExperiment(
  row: ExperimentRow,
  counts: { ok: number; fail: number; total: number },
): Experiment {
  return {
    id: row.id,
    promptId: row.promptId,
    promptName: row.promptName,
    status: row.status as ExperimentStatus,
    okCount: counts.ok,
    failCount: counts.fail,
    totalCount: counts.total,
    createdAt: row.createdAt.getTime(),
    finishedAt: row.finishedAt ? row.finishedAt.getTime() : null,
  };
}

export function rowToExperimentResult(
  row: ExperimentResultRow,
): ExperimentResult {
  return {
    id: row.id,
    experimentId: row.experimentId,
    versionId: row.versionId,
    versionNumber: row.versionNumber,
    modelId: row.modelId,
    status: row.status as ResultStatus,
    output: row.output,
    errorMessage: row.errorMessage,
    durationMs: row.durationMs,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    costUsd: row.costUsd,
    winner: row.winner,
  };
}

export function rowToSchemaDoc(
  row: OutputSchemaRow,
  attachedTo: number,
): SchemaDoc {
  return {
    id: row.id,
    name: row.name,
    fields: row.fields,
    attachedTo,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}
```

`apps/server/src/api/folders.ts` (mirror the structure of `apps/server/src/api/models.ts` — local `validationError`/`notFound`/`conflict` helpers, `createXRoutes(db)` factory):

```ts
import { FolderInputSchema } from "@holonet/shared";
import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/index.js";
import type { PromptFolderRow } from "../db/schema.js";
import { promptFolders, prompts } from "../db/schema.js";
import { rowToFolder } from "./promptSerialize.js";

function validationError(message: string) {
  return { error: { code: "VALIDATION" as const, message } };
}

function notFound() {
  return { error: { code: "NOT_FOUND" as const, message: "Folder not found" } };
}

function conflict(message: string) {
  return { error: { code: "CONFLICT" as const, message } };
}

async function getFolder(
  db: Db,
  id: string,
): Promise<PromptFolderRow | undefined> {
  const rows = await db
    .select()
    .from(promptFolders)
    .where(eq(promptFolders.id, id));
  return rows[0];
}

async function promptCounts(db: Db): Promise<Map<string | null, number>> {
  const rows = await db
    .select({ folderId: prompts.folderId, count: sql<number>`count(*)::int` })
    .from(prompts)
    .groupBy(prompts.folderId);
  return new Map(rows.map((r) => [r.folderId, r.count]));
}

export function createFoldersRoutes(db: Db): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const rows = await db
      .select()
      .from(promptFolders)
      .orderBy(asc(promptFolders.name));
    const counts = await promptCounts(db);
    return c.json(rows.map((row) => rowToFolder(row, counts.get(row.id) ?? 0)));
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = FolderInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid folder"),
        400,
      );
    }
    const dupes = await db
      .select({ id: promptFolders.id })
      .from(promptFolders)
      .where(eq(promptFolders.name, parsed.data.name));
    if (dupes.length > 0) {
      return c.json(conflict("Folder name already exists"), 409);
    }
    const inserted = await db
      .insert(promptFolders)
      .values({ name: parsed.data.name, createdAt: new Date() })
      .returning();
    const row = inserted[0] as PromptFolderRow;
    return c.json(rowToFolder(row, 0), 201);
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await getFolder(db, id);
    if (!existing) return c.json(notFound(), 404);
    const body = await c.req.json().catch(() => null);
    const parsed = FolderInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid folder"),
        400,
      );
    }
    const dupes = await db
      .select({ id: promptFolders.id })
      .from(promptFolders)
      .where(eq(promptFolders.name, parsed.data.name));
    if (dupes.some((d) => d.id !== id)) {
      return c.json(conflict("Folder name already exists"), 409);
    }
    await db
      .update(promptFolders)
      .set({ name: parsed.data.name })
      .where(eq(promptFolders.id, id));
    const updated = (await getFolder(db, id)) as PromptFolderRow;
    const counts = await promptCounts(db);
    return c.json(rowToFolder(updated, counts.get(id) ?? 0));
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await getFolder(db, id);
    if (!existing) return c.json(notFound(), 404);
    await db.delete(promptFolders).where(eq(promptFolders.id, id));
    return c.body(null, 204);
  });

  return app;
}
```

In `apps/server/src/app.ts` add the import and registration (next to the existing `api.route(...)` lines at `apps/server/src/app.ts:71-73`):

```ts
import { createFoldersRoutes } from "./api/folders.js";
// ...
api.route("/folders", createFoldersRoutes(db));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @holonet/server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check && pnpm typecheck
git add apps/server/src/api/promptSerialize.ts apps/server/src/api/folders.ts apps/server/src/api/folders.test.ts apps/server/src/app.ts
git commit -m "feat(server): prompt folders CRUD + module serializers"
```

---

### Task 6: Output-schema routes (`/api/schemas`)

**Files:**
- Create: `apps/server/src/api/schemas.ts`
- Create: `apps/server/src/api/schemas.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Consumes: `SchemaDocInputSchema`, `rowToSchemaDoc`, `outputSchemas`/`prompts` tables.
- Produces: `createSchemasRoutes(db: Db): Hono` — `GET /` (list with `attachedTo` counts), `POST /`, `PATCH /:id`, `DELETE /:id` (allowed while attached; FK nulls `prompts.schemaId`).

- [ ] **Step 1: Write the failing test**

`apps/server/src/api/schemas.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SchemaDoc } from "@holonet/shared";
import { eq } from "drizzle-orm";
import { prompts } from "../db/schema.js";
import { buildApp, loginHeaders } from "./test-helpers.js";

const FIELDS = [
  { name: "title", type: "string", required: true },
  {
    name: "severity",
    type: "enum",
    required: true,
    enumValues: ["low", "high"],
  },
];

test("schemas CRUD with attachedTo count and detach-on-delete", async () => {
  const { app, db } = await buildApp();
  const headers = await loginHeaders(app);

  const created = await app.request("/api/schemas", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Digest", fields: FIELDS }),
  });
  assert.equal(created.status, 201);
  const doc = (await created.json()) as SchemaDoc;
  assert.equal(doc.fields.length, 2);

  const now = new Date();
  await db.insert(prompts).values({
    name: "p1",
    schemaId: doc.id,
    createdAt: now,
    updatedAt: now,
  });

  const list = await app.request("/api/schemas", { headers });
  const docs = (await list.json()) as SchemaDoc[];
  assert.equal(docs.find((d) => d.id === doc.id)?.attachedTo, 1);

  const patched = await app.request(`/api/schemas/${doc.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Digest v2", fields: FIELDS.slice(0, 1) }),
  });
  assert.equal(patched.status, 200);
  const updated = (await patched.json()) as SchemaDoc;
  assert.equal(updated.name, "Digest v2");
  assert.equal(updated.fields.length, 1);
  assert.ok(updated.updatedAt >= updated.createdAt);

  const deleted = await app.request(`/api/schemas/${doc.id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleted.status, 204);
  const orphan = await db.select().from(prompts).where(eq(prompts.name, "p1"));
  assert.equal(orphan[0]?.schemaId, null);
});

test("schemas reject invalid field trees", async () => {
  const { app } = await buildApp();
  const headers = await loginHeaders(app);
  const bad = await app.request("/api/schemas", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "X", fields: [{ name: "", type: "string" }] }),
  });
  assert.equal(bad.status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @holonet/server test`
Expected: FAIL — 404 (unregistered route).

- [ ] **Step 3: Write the routes**

`apps/server/src/api/schemas.ts`:

```ts
import { SchemaDocInputSchema } from "@holonet/shared";
import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/index.js";
import type { OutputSchemaRow } from "../db/schema.js";
import { outputSchemas, prompts } from "../db/schema.js";
import { rowToSchemaDoc } from "./promptSerialize.js";

function validationError(message: string) {
  return { error: { code: "VALIDATION" as const, message } };
}

function notFound() {
  return { error: { code: "NOT_FOUND" as const, message: "Schema not found" } };
}

async function getSchema(
  db: Db,
  id: string,
): Promise<OutputSchemaRow | undefined> {
  const rows = await db
    .select()
    .from(outputSchemas)
    .where(eq(outputSchemas.id, id));
  return rows[0];
}

async function attachedCounts(db: Db): Promise<Map<string | null, number>> {
  const rows = await db
    .select({ schemaId: prompts.schemaId, count: sql<number>`count(*)::int` })
    .from(prompts)
    .groupBy(prompts.schemaId);
  return new Map(rows.map((r) => [r.schemaId, r.count]));
}

export function createSchemasRoutes(db: Db): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const rows = await db
      .select()
      .from(outputSchemas)
      .orderBy(asc(outputSchemas.name));
    const counts = await attachedCounts(db);
    return c.json(
      rows.map((row) => rowToSchemaDoc(row, counts.get(row.id) ?? 0)),
    );
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SchemaDocInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid schema"),
        400,
      );
    }
    const now = new Date();
    const inserted = await db
      .insert(outputSchemas)
      .values({ ...parsed.data, createdAt: now, updatedAt: now })
      .returning();
    return c.json(rowToSchemaDoc(inserted[0] as OutputSchemaRow, 0), 201);
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await getSchema(db, id);
    if (!existing) return c.json(notFound(), 404);
    const body = await c.req.json().catch(() => null);
    const parsed = SchemaDocInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid schema"),
        400,
      );
    }
    await db
      .update(outputSchemas)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(outputSchemas.id, id));
    const updated = (await getSchema(db, id)) as OutputSchemaRow;
    const counts = await attachedCounts(db);
    return c.json(rowToSchemaDoc(updated, counts.get(id) ?? 0));
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await getSchema(db, id);
    if (!existing) return c.json(notFound(), 404);
    await db.delete(outputSchemas).where(eq(outputSchemas.id, id));
    return c.body(null, 204);
  });

  return app;
}
```

In `apps/server/src/app.ts`:

```ts
import { createSchemasRoutes } from "./api/schemas.js";
// ...
api.route("/schemas", createSchemasRoutes(db));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @holonet/server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check && pnpm typecheck
git add apps/server/src/api/schemas.ts apps/server/src/api/schemas.test.ts apps/server/src/app.ts
git commit -m "feat(server): output-schema CRUD routes"
```

---

### Task 7: Prompts routes — CRUD + immutable versions

**Files:**
- Create: `apps/server/src/api/prompts.ts`
- Create: `apps/server/src/api/prompts.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Consumes: contracts from Task 1, tables from Task 3, serializers from Task 5, `Config` (for Task 8's optimize route, added later to this same file).
- Produces: `createPromptsRoutes(db: Db, config: Config): Hono` —
  `GET /` (query `folderId` — pass `"none"` for folderless, `tag`, `q`), `POST /` (creates prompt + version 1), `GET /:id` → `PromptDetail` (versions descending), `PATCH /:id` (metadata only), `POST /:id/versions` (next version, bumps `updatedAt`), `DELETE /:id`.
- Version numbers are assigned server-side inside a transaction: `max(version) + 1`.

- [ ] **Step 1: Write the failing test**

`apps/server/src/api/prompts.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prompt, PromptDetail, PromptVersion } from "@holonet/shared";
import { eq } from "drizzle-orm";
import { promptVersions } from "../db/schema.js";
import { buildApp, loginHeaders } from "./test-helpers.js";

async function createPrompt(
  app: Awaited<ReturnType<typeof buildApp>>["app"],
  headers: { Cookie: string },
  body: Record<string, unknown>,
): Promise<Prompt> {
  const res = await app.request("/api/prompts", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 201);
  return (await res.json()) as Prompt;
}

test("create seeds v1; saves increment; metadata patch adds no version", async () => {
  const { app } = await buildApp();
  const headers = await loginHeaders(app);

  const prompt = await createPrompt(app, headers, {
    name: "Daily digest",
    tags: ["news"],
    content: "Summarize AI news.",
  });
  assert.equal(prompt.headVersion, 1);
  assert.equal(prompt.versionCount, 1);

  const v2 = await app.request(`/api/prompts/${prompt.id}/versions`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "Summarize AI news briefly.", note: "tighter" }),
  });
  assert.equal(v2.status, 201);
  assert.equal(((await v2.json()) as PromptVersion).version, 2);

  const patched = await app.request(`/api/prompts/${prompt.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Daily digest v2", tags: ["news", "ai"] }),
  });
  assert.equal(patched.status, 200);

  const detailRes = await app.request(`/api/prompts/${prompt.id}`, { headers });
  const detail = (await detailRes.json()) as PromptDetail;
  assert.equal(detail.name, "Daily digest v2");
  assert.equal(detail.versionCount, 2);
  assert.equal(detail.headVersion, 2);
  assert.deepEqual(
    detail.versions.map((v) => v.version),
    [2, 1],
  );
  assert.equal(detail.versions[0]?.note, "tighter");
});

test("list filters by folderId/none, tag and q", async () => {
  const { app } = await buildApp();
  const headers = await loginHeaders(app);
  const folderRes = await app.request("/api/folders", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "News" }),
  });
  const folder = (await folderRes.json()) as { id: string };

  await createPrompt(app, headers, {
    name: "Alpha",
    folderId: folder.id,
    tags: ["news"],
    content: "a",
  });
  await createPrompt(app, headers, { name: "Beta", tags: ["fun"], content: "b" });

  const byFolder = (await (
    await app.request(`/api/prompts?folderId=${folder.id}`, { headers })
  ).json()) as Prompt[];
  assert.deepEqual(byFolder.map((p) => p.name), ["Alpha"]);

  const folderless = (await (
    await app.request("/api/prompts?folderId=none", { headers })
  ).json()) as Prompt[];
  assert.deepEqual(folderless.map((p) => p.name), ["Beta"]);

  const byTag = (await (
    await app.request("/api/prompts?tag=fun", { headers })
  ).json()) as Prompt[];
  assert.deepEqual(byTag.map((p) => p.name), ["Beta"]);

  const byQ = (await (
    await app.request("/api/prompts?q=alph", { headers })
  ).json()) as Prompt[];
  assert.deepEqual(byQ.map((p) => p.name), ["Alpha"]);
});

test("delete cascades versions; unknown folder/schema ids -> 400", async () => {
  const { app, db } = await buildApp();
  const headers = await loginHeaders(app);
  const prompt = await createPrompt(app, headers, { name: "X", content: "c" });

  const bad = await app.request("/api/prompts", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Y",
      content: "c",
      folderId: "00000000-0000-4000-8000-000000000000",
    }),
  });
  assert.equal(bad.status, 400);

  const del = await app.request(`/api/prompts/${prompt.id}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(del.status, 204);
  const versions = await db
    .select()
    .from(promptVersions)
    .where(eq(promptVersions.promptId, prompt.id));
  assert.equal(versions.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @holonet/server test`
Expected: FAIL — 404 (unregistered route).

- [ ] **Step 3: Write the routes**

`apps/server/src/api/prompts.ts`:

```ts
import {
  PromptInputSchema,
  PromptMetaUpdateSchema,
  PromptVersionInputSchema,
} from "@holonet/shared";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import type { PromptRow, PromptVersionRow } from "../db/schema.js";
import { outputSchemas, promptFolders, prompts, promptVersions } from "../db/schema.js";
import { rowToPrompt, rowToPromptVersion } from "./promptSerialize.js";

function validationError(message: string) {
  return { error: { code: "VALIDATION" as const, message } };
}

function notFound() {
  return { error: { code: "NOT_FOUND" as const, message: "Prompt not found" } };
}

async function getPrompt(db: Db, id: string): Promise<PromptRow | undefined> {
  const rows = await db.select().from(prompts).where(eq(prompts.id, id));
  return rows[0];
}

interface VersionAgg {
  head: number;
  count: number;
}

async function versionAggregates(db: Db): Promise<Map<string, VersionAgg>> {
  const rows = await db
    .select({
      promptId: promptVersions.promptId,
      head: sql<number>`max(${promptVersions.version})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(promptVersions)
    .groupBy(promptVersions.promptId);
  return new Map(rows.map((r) => [r.promptId, { head: r.head, count: r.count }]));
}

/** null = valid; otherwise a 400 message. */
async function checkRefs(
  db: Db,
  folderId: string | null | undefined,
  schemaId: string | null | undefined,
): Promise<string | null> {
  if (folderId) {
    const rows = await db
      .select({ id: promptFolders.id })
      .from(promptFolders)
      .where(eq(promptFolders.id, folderId));
    if (rows.length === 0) return "Unknown folder";
  }
  if (schemaId) {
    const rows = await db
      .select({ id: outputSchemas.id })
      .from(outputSchemas)
      .where(eq(outputSchemas.id, schemaId));
    if (rows.length === 0) return "Unknown schema";
  }
  return null;
}

export function createPromptsRoutes(db: Db, config: Config): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const { folderId, tag, q } = c.req.query();
    const rows = await db
      .select()
      .from(prompts)
      .orderBy(desc(prompts.updatedAt));
    const aggs = await versionAggregates(db);
    // Single-user scale: filter in process rather than composing SQL.
    const filtered = rows.filter((row) => {
      if (folderId === "none" && row.folderId !== null) return false;
      if (folderId && folderId !== "none" && row.folderId !== folderId)
        return false;
      if (tag && !row.tags.includes(tag)) return false;
      if (q && !row.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    return c.json(
      filtered.map((row) => {
        const agg = aggs.get(row.id) ?? { head: 0, count: 0 };
        return rowToPrompt(row, agg.head, agg.count);
      }),
    );
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = PromptInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid prompt"),
        400,
      );
    }
    const refError = await checkRefs(
      db,
      parsed.data.folderId,
      parsed.data.schemaId,
    );
    if (refError) return c.json(validationError(refError), 400);

    const now = new Date();
    const { content, ...meta } = parsed.data;
    const row = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(prompts)
        .values({ ...meta, createdAt: now, updatedAt: now })
        .returning();
      const created = inserted[0] as PromptRow;
      await tx.insert(promptVersions).values({
        promptId: created.id,
        version: 1,
        content,
        createdAt: now,
      });
      return created;
    });
    return c.json(rowToPrompt(row, 1, 1), 201);
  });

  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const row = await getPrompt(db, id);
    if (!row) return c.json(notFound(), 404);
    const versions = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.promptId, id))
      .orderBy(desc(promptVersions.version));
    const head = versions[0]?.version ?? 0;
    return c.json({
      ...rowToPrompt(row, head, versions.length),
      versions: versions.map(rowToPromptVersion),
    });
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await getPrompt(db, id);
    if (!existing) return c.json(notFound(), 404);
    const body = await c.req.json().catch(() => null);
    const parsed = PromptMetaUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid update"),
        400,
      );
    }
    const refError = await checkRefs(
      db,
      parsed.data.folderId,
      parsed.data.schemaId,
    );
    if (refError) return c.json(validationError(refError), 400);

    await db
      .update(prompts)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(prompts.id, id));
    const updated = (await getPrompt(db, id)) as PromptRow;
    const aggs = await versionAggregates(db);
    const agg = aggs.get(id) ?? { head: 0, count: 0 };
    return c.json(rowToPrompt(updated, agg.head, agg.count));
  });

  app.post("/:id/versions", async (c) => {
    const id = c.req.param("id");
    const existing = await getPrompt(db, id);
    if (!existing) return c.json(notFound(), 404);
    const body = await c.req.json().catch(() => null);
    const parsed = PromptVersionInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid version"),
        400,
      );
    }
    const now = new Date();
    const created = await db.transaction(async (tx) => {
      const maxRows = await tx
        .select({
          max: sql<number>`coalesce(max(${promptVersions.version}), 0)::int`,
        })
        .from(promptVersions)
        .where(eq(promptVersions.promptId, id));
      const next = (maxRows[0]?.max ?? 0) + 1;
      const inserted = await tx
        .insert(promptVersions)
        .values({
          promptId: id,
          version: next,
          content: parsed.data.content,
          note: parsed.data.note ?? null,
          createdAt: now,
        })
        .returning();
      await tx
        .update(prompts)
        .set({ updatedAt: now })
        .where(eq(prompts.id, id));
      return inserted[0] as PromptVersionRow;
    });
    return c.json(rowToPromptVersion(created), 201);
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await getPrompt(db, id);
    if (!existing) return c.json(notFound(), 404);
    await db.delete(prompts).where(eq(prompts.id, id));
    return c.body(null, 204);
  });

  return app;
}
```

`config` is accepted now (unused until Task 8 adds `POST /:id/optimize` to this file) — prefix with `_config` is NOT needed: Task 8 lands in the same PR-stream; if Biome flags the unused parameter in the interim, name it `_config` here and rename in Task 8.

In `apps/server/src/app.ts`:

```ts
import { createPromptsRoutes } from "./api/prompts.js";
// ...
api.route("/prompts", createPromptsRoutes(db, config));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @holonet/server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check && pnpm typecheck
git add apps/server/src/api/prompts.ts apps/server/src/api/prompts.test.ts apps/server/src/app.ts
git commit -m "feat(server): prompt CRUD with immutable versioning"
```

---

### Task 8: Optimizer — meta-prompt service + `POST /api/prompts/:id/optimize`

**Files:**
- Create: `apps/server/src/services/optimizer.ts`
- Create: `apps/server/src/services/optimizer.test.ts`
- Modify: `apps/server/src/api/prompts.ts` (add route)
- Modify: `apps/server/src/api/prompts.test.ts` (add route test)

**Interfaces:**
- Consumes: `ChatMessage`, `chatComplete` from `./openrouter.js`; `OptimizeOutput` from shared; `models` table (family lookup).
- Produces: `buildOptimizerMessages(content: string, targetModelId: string, targetFamily: string): ChatMessage[]`; `parseOptimizerResponse(raw: string): OptimizeOutput`. Route returns `OptimizeOutput` and persists nothing.

- [ ] **Step 1: Write the failing unit tests**

`apps/server/src/services/optimizer.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOptimizerMessages,
  parseOptimizerResponse,
} from "./optimizer.js";

test("buildOptimizerMessages injects family guidance and target model", () => {
  const messages = buildOptimizerMessages(
    "Summarize the news.",
    "anthropic/claude-sonnet-4.5",
    "ANTHROPIC",
  );
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "system");
  assert.ok(messages[0]?.content.includes("XML tags"));
  assert.ok(messages[0]?.content.includes("<improved>"));
  assert.ok(messages[1]?.content.includes("anthropic/claude-sonnet-4.5"));
  assert.ok(messages[1]?.content.includes("Summarize the news."));
});

test("unknown family falls back to generic guidance", () => {
  const messages = buildOptimizerMessages("p", "acme/model-1", "ACME");
  assert.ok(messages[0]?.content.includes("Be explicit"));
});

test("parseOptimizerResponse splits delimited blocks", () => {
  const parsed = parseOptimizerResponse(
    "<improved>\nBetter prompt\n</improved>\n<rationale>\nShorter.\n</rationale>",
  );
  assert.equal(parsed.improved, "Better prompt");
  assert.equal(parsed.rationale, "Shorter.");
});

test("parseOptimizerResponse falls back to whole text when delimiters missing", () => {
  const parsed = parseOptimizerResponse("Just a better prompt");
  assert.equal(parsed.improved, "Just a better prompt");
  assert.equal(parsed.rationale, "");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @holonet/server test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

`apps/server/src/services/optimizer.ts`:

```ts
import type { OptimizeOutput } from "@holonet/shared";
import type { ChatMessage } from "./openrouter.js";

const FAMILY_GUIDANCE: Record<string, string> = {
  ANTHROPIC: [
    "- Structure complex instructions with XML tags (e.g. <context>, <task>, <rules>).",
    "- State the role explicitly up front and put critical constraints near the end.",
    "- Prefer positive instructions over prohibitions; ask for step-by-step reasoning only when needed.",
  ].join("\n"),
  XAI: [
    "- Keep instructions direct and compact; Grok responds well to terse imperative style.",
    "- Put the output-format contract in its own final paragraph.",
    "- Avoid heavy markup; use plain numbered rules.",
  ].join("\n"),
  OPENAI: [
    "- Use short markdown sections with clear headers for role, task, and output format.",
    "- Specify output format explicitly and give one compact example when ambiguous.",
    "- Avoid contradictory constraints; state priorities when rules can conflict.",
  ].join("\n"),
};

const GENERIC_GUIDANCE = [
  "- Be explicit about the role, the task, the audience, and the output format.",
  "- Remove ambiguity: quantify vague words (\"short\", \"recent\") with concrete limits.",
  "- Separate instructions from data; keep the output contract in one place.",
].join("\n");

export function buildOptimizerMessages(
  content: string,
  targetModelId: string,
  targetFamily: string,
): ChatMessage[] {
  const guidance =
    FAMILY_GUIDANCE[targetFamily.toUpperCase()] ?? GENERIC_GUIDANCE;
  const system = [
    "You are an expert prompt engineer. Rewrite the user's prompt so it performs",
    "as well as possible on the target model, preserving the original intent,",
    "language and output expectations. Do not answer the prompt itself.",
    "",
    "Guidance for the target model family:",
    guidance,
    "",
    "Return your answer in EXACTLY this format, with no other text:",
    "<improved>",
    "(the improved prompt)",
    "</improved>",
    "<rationale>",
    "(2-4 sentences on what you changed and why)",
    "</rationale>",
  ].join("\n");
  const user = [
    `Target model: ${targetModelId}`,
    "",
    "Original prompt:",
    content,
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function extractBlock(raw: string, tag: string): string | null {
  const match = raw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match?.[1]?.trim() ?? null;
}

// Defensive: a model that ignores the format still yields a usable result.
export function parseOptimizerResponse(raw: string): OptimizeOutput {
  const improved = extractBlock(raw, "improved");
  if (improved === null || improved === "") {
    return { improved: raw.trim(), rationale: "" };
  }
  return { improved, rationale: extractBlock(raw, "rationale") ?? "" };
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `pnpm --filter @holonet/server test`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

Append to `apps/server/src/api/prompts.test.ts` (add `mock`, `afterEach` to the `node:test` import and `models` to the schema import):

```ts
import { afterEach, mock } from "node:test";
import { models } from "../db/schema.js";

afterEach(() => mock.restoreAll());

test("optimize returns improved+rationale and saves nothing", async () => {
  const { app, db } = await buildApp();
  const headers = await loginHeaders(app);
  await db.insert(models).values([
    { modelId: "anthropic/claude-sonnet-4.5", label: "SONNET", family: "ANTHROPIC" },
    { modelId: "test/optimizer", label: "OPT", family: "TEST" },
  ]);
  const prompt = await createPrompt(app, headers, { name: "P", content: "old" });
  const detail = (await (
    await app.request(`/api/prompts/${prompt.id}`, { headers })
  ).json()) as PromptDetail;
  const versionId = detail.versions[0]?.id as string;

  mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                "<improved>\nnew prompt\n</improved>\n<rationale>\nbetter\n</rationale>",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

  const res = await app.request(`/api/prompts/${prompt.id}/optimize`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      versionId,
      targetModelId: "anthropic/claude-sonnet-4.5",
      optimizerModelId: "test/optimizer",
    }),
  });
  assert.equal(res.status, 200);
  const out = (await res.json()) as { improved: string; rationale: string };
  assert.equal(out.improved, "new prompt");
  assert.equal(out.rationale, "better");

  const after = (await (
    await app.request(`/api/prompts/${prompt.id}`, { headers })
  ).json()) as PromptDetail;
  assert.equal(after.versionCount, 1); // nothing saved

  const badModel = await app.request(`/api/prompts/${prompt.id}/optimize`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      versionId,
      targetModelId: "not/in-catalog",
      optimizerModelId: "test/optimizer",
    }),
  });
  assert.equal(badModel.status, 400);
});
```

Note: `models.createdAt` has `defaultNow()`, so the seed insert needs no timestamps.

- [ ] **Step 6: Run to verify the new test fails (404), then add the route**

In `apps/server/src/api/prompts.ts`, extend imports:

```ts
import { OptimizeInputSchema, /* existing */ } from "@holonet/shared";
import { inArray } from "drizzle-orm"; // alongside desc, eq, sql
import { models } from "../db/schema.js"; // alongside other tables
import { chatComplete } from "../services/openrouter.js";
import {
  buildOptimizerMessages,
  parseOptimizerResponse,
} from "../services/optimizer.js";
```

and add before `return app;`:

```ts
  app.post("/:id/optimize", async (c) => {
    const id = c.req.param("id");
    const existing = await getPrompt(db, id);
    if (!existing) return c.json(notFound(), 404);
    const body = await c.req.json().catch(() => null);
    const parsed = OptimizeInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid request"),
        400,
      );
    }
    const versionRows = await db
      .select()
      .from(promptVersions)
      .where(eq(promptVersions.id, parsed.data.versionId));
    const version = versionRows[0];
    if (!version || version.promptId !== id) {
      return c.json(validationError("Version does not belong to prompt"), 400);
    }
    const modelRows = await db
      .select()
      .from(models)
      .where(
        inArray(models.modelId, [
          parsed.data.targetModelId,
          parsed.data.optimizerModelId,
        ]),
      );
    const target = modelRows.find(
      (m) => m.modelId === parsed.data.targetModelId,
    );
    const optimizer = modelRows.find(
      (m) => m.modelId === parsed.data.optimizerModelId,
    );
    if (!target) return c.json(validationError("Unknown target model"), 400);
    if (!optimizer) {
      return c.json(validationError("Unknown optimizer model"), 400);
    }

    try {
      const raw = await chatComplete({
        apiKey: config.openrouterApiKey,
        model: optimizer.modelId,
        messages: buildOptimizerMessages(
          version.content,
          target.modelId,
          target.family,
        ),
        webSearch: false,
      });
      return c.json(parseOptimizerResponse(raw));
    } catch {
      return c.json(
        { error: { code: "INTERNAL" as const, message: "Optimizer call failed" } },
        502,
      );
    }
  });
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @holonet/server test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm check && pnpm typecheck
git add apps/server/src/services/optimizer.ts apps/server/src/services/optimizer.test.ts apps/server/src/api/prompts.ts apps/server/src/api/prompts.test.ts
git commit -m "feat(server): prompt optimizer meta-prompt service and route"
```

---

### Task 9: Playground route — single run + schema validation

**Files:**
- Create: `apps/server/src/api/playground.ts`
- Create: `apps/server/src/api/playground.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Consumes: `PlaygroundRunInputSchema`, `PlaygroundRunOutput`, `validateFields` from shared; `chatCompleteDetailed`, `schemaResponseFormat` from Task 4; `outputSchemas`, `models` tables.
- Produces: `createPlaygroundRoutes(db: Db, config: Config): Hono` — `POST /run`. Content goes out as a single `user` message, never with the web plugin. With `schemaId`: `response_format` json_schema + server-side validation; invalid output is data (`validation.valid=false`), not an error.

- [ ] **Step 1: Write the failing test**

`apps/server/src/api/playground.test.ts`:

```ts
import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { PlaygroundRunOutput, SchemaDoc } from "@holonet/shared";
import { models } from "../db/schema.js";
import { buildApp, loginHeaders } from "./test-helpers.js";

afterEach(() => mock.restoreAll());

function mockCompletion(content: string) {
  mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 3, completion_tokens: 4, cost: 0.001 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

async function setup() {
  const built = await buildApp();
  const headers = await loginHeaders(built.app);
  await built.db
    .insert(models)
    .values({ modelId: "test/model", label: "T", family: "TEST" });
  return { ...built, headers };
}

test("run without schema returns output and null validation", async () => {
  const { app, headers } = await setup();
  mockCompletion("plain answer");
  const res = await app.request("/api/playground/run", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "hi", modelId: "test/model" }),
  });
  assert.equal(res.status, 200);
  const out = (await res.json()) as PlaygroundRunOutput;
  assert.equal(out.output, "plain answer");
  assert.equal(out.validation, null);
  assert.equal(out.tokensIn, 3);
  assert.equal(out.costUsd, "0.001");
});

test("run with schema validates ok and fail paths", async () => {
  const { app, headers } = await setup();
  const schemaRes = await app.request("/api/schemas", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Out",
      fields: [{ name: "title", type: "string", required: true }],
    }),
  });
  const schema = (await schemaRes.json()) as SchemaDoc;

  mockCompletion('{"title":"ok"}');
  const good = (await (
    await app.request("/api/playground/run", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "hi",
        modelId: "test/model",
        schemaId: schema.id,
      }),
    })
  ).json()) as PlaygroundRunOutput;
  assert.deepEqual(good.validation, { valid: true, errors: [] });

  mockCompletion("not json at all");
  const bad = (await (
    await app.request("/api/playground/run", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "hi",
        modelId: "test/model",
        schemaId: schema.id,
      }),
    })
  ).json()) as PlaygroundRunOutput;
  assert.equal(bad.validation?.valid, false);
  assert.ok(bad.validation?.errors[0]?.includes("not valid JSON"));
});

test("unknown model or schema -> 400; upstream failure -> 502", async () => {
  const { app, headers } = await setup();
  const unknownModel = await app.request("/api/playground/run", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "hi", modelId: "no/model" }),
  });
  assert.equal(unknownModel.status, 400);

  mock.method(
    globalThis,
    "fetch",
    async () => new Response("boom", { status: 500 }),
  );
  const upstream = await app.request("/api/playground/run", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "hi", modelId: "test/model" }),
  });
  assert.equal(upstream.status, 502);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @holonet/server test`
Expected: FAIL — 404 (unregistered route).

- [ ] **Step 3: Write the route**

`apps/server/src/api/playground.ts`:

```ts
import {
  PlaygroundRunInputSchema,
  type PlaygroundRunOutput,
  validateFields,
} from "@holonet/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { models, outputSchemas } from "../db/schema.js";
import {
  chatCompleteDetailed,
  type ResponseFormat,
  schemaResponseFormat,
} from "../services/openrouter.js";

function validationError(message: string) {
  return { error: { code: "VALIDATION" as const, message } };
}

export function createPlaygroundRoutes(db: Db, config: Config): Hono {
  const app = new Hono();

  app.post("/run", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = PlaygroundRunInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid request"),
        400,
      );
    }

    const modelRows = await db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.modelId, parsed.data.modelId));
    if (modelRows.length === 0) {
      return c.json(validationError("Unknown model"), 400);
    }

    let responseFormat: ResponseFormat | undefined;
    let schemaFields = null;
    if (parsed.data.schemaId) {
      const schemaRows = await db
        .select()
        .from(outputSchemas)
        .where(eq(outputSchemas.id, parsed.data.schemaId));
      const schema = schemaRows[0];
      if (!schema) return c.json(validationError("Unknown schema"), 400);
      schemaFields = schema.fields;
      responseFormat = schemaResponseFormat(schema.name, schema.fields);
    }

    const started = Date.now();
    try {
      const result = await chatCompleteDetailed({
        apiKey: config.openrouterApiKey,
        model: parsed.data.modelId,
        messages: [{ role: "user", content: parsed.data.content }],
        responseFormat,
      });
      let validation: PlaygroundRunOutput["validation"] = null;
      if (schemaFields) {
        try {
          const value: unknown = JSON.parse(result.content);
          const errors = validateFields(schemaFields, value);
          validation = { valid: errors.length === 0, errors };
        } catch {
          validation = {
            valid: false,
            errors: ["response is not valid JSON"],
          };
        }
      }
      const output: PlaygroundRunOutput = {
        output: result.content,
        durationMs: Date.now() - started,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
        validation,
      };
      return c.json(output);
    } catch {
      return c.json(
        { error: { code: "INTERNAL" as const, message: "Model call failed" } },
        502,
      );
    }
  });

  return app;
}
```

In `apps/server/src/app.ts`:

```ts
import { createPlaygroundRoutes } from "./api/playground.js";
// ...
api.route("/playground", createPlaygroundRoutes(db, config));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @holonet/server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm check && pnpm typecheck
git add apps/server/src/api/playground.ts apps/server/src/api/playground.test.ts apps/server/src/app.ts
git commit -m "feat(server): playground single-run route with schema validation"
```

---

### Task 10: Experiments — routes, in-process runner, boot recovery

**Files:**
- Create: `apps/server/src/scheduler/experimentRunner.ts`
- Create: `apps/server/src/scheduler/experimentRunner.test.ts`
- Create: `apps/server/src/api/experiments.ts`
- Create: `apps/server/src/api/experiments.test.ts`
- Modify: `apps/server/src/app.ts` (new dep + route)
- Modify: `apps/server/src/api/test-helpers.ts` (wire runner, allow `complete` override)
- Modify: `apps/server/src/index.ts` (create runner, boot recovery)

**Interfaces:**
- Consumes: Tasks 1–5 artifacts; `chatCompleteDetailed`, `schemaResponseFormat` (Task 4); pino `Logger`.
- Produces:

```ts
export type CompleteFn = (
  options: ChatCompleteDetailedOptions,
) => Promise<ChatCompletionDetails>;
export interface ExperimentRunnerDeps {
  db: Db;
  config: Config;
  logger: Logger;
  complete?: CompleteFn; // defaults to chatCompleteDetailed; injectable for tests
}
export interface ExperimentRunner {
  start(experimentId: string): void; // fire-and-forget, logs errors
  run(experimentId: string): Promise<void>; // awaitable, used by start and tests
}
export function createExperimentRunner(deps: ExperimentRunnerDeps): ExperimentRunner;
export function recoverInterruptedExperiments(db: Db, logger: Logger): Promise<void>;
```

- `createApp` deps gain `experimentRunner: ExperimentRunner`; `createExperimentsRoutes(db: Db, runner: ExperimentRunner): Hono`.
- `buildApp(overrides?: { complete?: CompleteFn })` in test-helpers.

- [ ] **Step 1: Write the failing runner tests**

`apps/server/src/scheduler/experimentRunner.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { loadConfig } from "../config.js";
import * as schema from "../db/schema.js";
import {
  experimentResults,
  experiments,
  prompts,
  promptVersions,
} from "../db/schema.js";
import { logger } from "../logger.js";
import {
  createExperimentRunner,
  recoverInterruptedExperiments,
} from "./experimentRunner.js";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

async function buildDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

const config = loadConfig({ APP_KEY: "test-app-key-123456", OPENROUTER_API_KEY: "x" });

async function seedExperiment(db: Awaited<ReturnType<typeof buildDb>>) {
  const now = new Date();
  const [prompt] = await db
    .insert(prompts)
    .values({ name: "P", createdAt: now, updatedAt: now })
    .returning();
  const [version] = await db
    .insert(promptVersions)
    .values({ promptId: prompt!.id, version: 1, content: "the prompt", createdAt: now })
    .returning();
  const [experiment] = await db
    .insert(experiments)
    .values({
      promptId: prompt!.id,
      promptName: "P",
      status: "running",
      createdAt: now,
    })
    .returning();
  await db.insert(experimentResults).values(
    ["m/one", "m/two"].map((modelId) => ({
      experimentId: experiment!.id,
      versionId: version!.id,
      versionNumber: 1,
      modelId,
    })),
  );
  return { experiment: experiment!, version: version! };
}

test("runner fills cells, tolerates per-cell failure, finishes done", async () => {
  const db = await buildDb();
  const { experiment } = await seedExperiment(db);
  const runner = createExperimentRunner({
    db,
    config,
    logger,
    complete: async ({ model }) => {
      if (model === "m/two") throw new Error("model exploded");
      return { content: "answer", tokensIn: 1, tokensOut: 2, costUsd: "0.1" };
    },
  });
  await runner.run(experiment.id);

  const rows = await db
    .select()
    .from(experimentResults)
    .where(eq(experimentResults.experimentId, experiment.id));
  const ok = rows.find((r) => r.modelId === "m/one");
  const fail = rows.find((r) => r.modelId === "m/two");
  assert.equal(ok?.status, "ok");
  assert.equal(ok?.output, "answer");
  assert.equal(ok?.tokensIn, 1);
  assert.equal(fail?.status, "fail");
  assert.ok(fail?.errorMessage?.includes("model exploded"));

  const [after] = await db
    .select()
    .from(experiments)
    .where(eq(experiments.id, experiment.id));
  assert.equal(after?.status, "done");
  assert.ok(after?.finishedAt);
});

test("recoverInterruptedExperiments marks stale running as failed", async () => {
  const db = await buildDb();
  const { experiment } = await seedExperiment(db);
  await recoverInterruptedExperiments(db, logger);

  const [after] = await db
    .select()
    .from(experiments)
    .where(eq(experiments.id, experiment.id));
  assert.equal(after?.status, "failed");
  const stale = await db
    .select()
    .from(experimentResults)
    .where(
      and(
        eq(experimentResults.experimentId, experiment.id),
        eq(experimentResults.status, "fail"),
      ),
    );
  assert.equal(stale.length, 2);
  assert.equal(stale[0]?.errorMessage, "interrupted by restart");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @holonet/server test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the runner**

`apps/server/src/scheduler/experimentRunner.ts`:

```ts
import { and, eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import type { ExperimentResultRow } from "../db/schema.js";
import {
  experimentResults,
  experiments,
  outputSchemas,
  prompts,
  promptVersions,
} from "../db/schema.js";
import {
  type ChatCompleteDetailedOptions,
  type ChatCompletionDetails,
  chatCompleteDetailed,
  type ResponseFormat,
  schemaResponseFormat,
} from "../services/openrouter.js";

export type CompleteFn = (
  options: ChatCompleteDetailedOptions,
) => Promise<ChatCompletionDetails>;

export interface ExperimentRunnerDeps {
  db: Db;
  config: Config;
  logger: Logger;
  complete?: CompleteFn;
}

export interface ExperimentRunner {
  start(experimentId: string): void;
  run(experimentId: string): Promise<void>;
}

const CONCURRENCY = 3;

export function createExperimentRunner({
  db,
  config,
  logger,
  complete = chatCompleteDetailed,
}: ExperimentRunnerDeps): ExperimentRunner {
  async function runCell(
    row: ExperimentResultRow,
    content: string | undefined,
    responseFormat: ResponseFormat | undefined,
  ): Promise<void> {
    const started = Date.now();
    if (content === undefined) {
      await db
        .update(experimentResults)
        .set({ status: "fail", errorMessage: "prompt version no longer exists" })
        .where(eq(experimentResults.id, row.id));
      return;
    }
    try {
      const result = await complete({
        apiKey: config.openrouterApiKey,
        model: row.modelId,
        messages: [{ role: "user", content }],
        responseFormat,
      });
      await db
        .update(experimentResults)
        .set({
          status: "ok",
          output: result.content,
          durationMs: Date.now() - started,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: result.costUsd,
        })
        .where(eq(experimentResults.id, row.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(experimentResults)
        .set({
          status: "fail",
          errorMessage: message.slice(0, 300),
          durationMs: Date.now() - started,
        })
        .where(eq(experimentResults.id, row.id));
    }
  }

  async function run(experimentId: string): Promise<void> {
    const experimentRows = await db
      .select()
      .from(experiments)
      .where(eq(experiments.id, experimentId));
    const experiment = experimentRows[0];
    if (!experiment) return;

    const pending = await db
      .select()
      .from(experimentResults)
      .where(
        and(
          eq(experimentResults.experimentId, experimentId),
          eq(experimentResults.status, "pending"),
        ),
      );

    const versionIds = [...new Set(pending.map((r) => r.versionId))];
    const versions =
      versionIds.length > 0
        ? await db
            .select()
            .from(promptVersions)
            .where(inArray(promptVersions.id, versionIds))
        : [];
    const contentByVersion = new Map(versions.map((v) => [v.id, v.content]));

    let responseFormat: ResponseFormat | undefined;
    if (experiment.promptId) {
      const promptRows = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, experiment.promptId));
      const schemaId = promptRows[0]?.schemaId;
      if (schemaId) {
        const schemaRows = await db
          .select()
          .from(outputSchemas)
          .where(eq(outputSchemas.id, schemaId));
        const schemaRow = schemaRows[0];
        if (schemaRow) {
          responseFormat = schemaResponseFormat(schemaRow.name, schemaRow.fields);
        }
      }
    }

    const queue = [...pending];
    const worker = async (): Promise<void> => {
      for (;;) {
        const row = queue.shift();
        if (!row) return;
        await runCell(row, contentByVersion.get(row.versionId), responseFormat);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
    );

    await db
      .update(experiments)
      .set({ status: "done", finishedAt: new Date() })
      .where(eq(experiments.id, experimentId));
    logger.info({ experimentId }, "experiment finished");
  }

  return {
    run,
    start(experimentId) {
      run(experimentId).catch((err) => {
        logger.error({ err, experimentId }, "experiment run failed");
      });
    },
  };
}

// Boot recovery: a restart mid-experiment leaves status 'running' with no
// process behind it — surface that honestly instead of leaving zombies.
export async function recoverInterruptedExperiments(
  db: Db,
  logger: Logger,
): Promise<void> {
  const stale = await db
    .select({ id: experiments.id })
    .from(experiments)
    .where(eq(experiments.status, "running"));
  if (stale.length === 0) return;
  const ids = stale.map((r) => r.id);
  await db
    .update(experimentResults)
    .set({ status: "fail", errorMessage: "interrupted by restart" })
    .where(
      and(
        inArray(experimentResults.experimentId, ids),
        eq(experimentResults.status, "pending"),
      ),
    );
  await db
    .update(experiments)
    .set({ status: "failed", finishedAt: new Date() })
    .where(inArray(experiments.id, ids));
  logger.warn({ count: ids.length }, "marked interrupted experiments as failed");
}
```

- [ ] **Step 4: Run runner tests to verify they pass**

Run: `pnpm --filter @holonet/server test`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

`apps/server/src/api/experiments.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  Experiment,
  ExperimentDetail,
  Prompt,
  PromptDetail,
} from "@holonet/shared";
import { models } from "../db/schema.js";
import { buildApp, loginHeaders } from "./test-helpers.js";

async function waitForDone(
  app: Awaited<ReturnType<typeof buildApp>>["app"],
  headers: { Cookie: string },
  id: string,
): Promise<ExperimentDetail> {
  for (let i = 0; i < 40; i++) {
    const res = await app.request(`/api/experiments/${id}`, { headers });
    const detail = (await res.json()) as ExperimentDetail;
    if (detail.status !== "running") return detail;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("experiment never finished");
}

test("experiment matrix runs to done with per-cell results and winner marking", async () => {
  const { app, db } = await buildApp({
    complete: async ({ model }) => {
      if (model === "bad/model") throw new Error("nope");
      return { content: `out:${model}`, tokensIn: 1, tokensOut: 2, costUsd: "0.01" };
    },
  });
  const headers = await loginHeaders(app);
  await db.insert(models).values([
    { modelId: "good/model", label: "G", family: "TEST" },
    { modelId: "bad/model", label: "B", family: "TEST" },
  ]);

  const promptRes = await app.request("/api/prompts", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "P", content: "v1 content" }),
  });
  const prompt = (await promptRes.json()) as Prompt;
  await app.request(`/api/prompts/${prompt.id}/versions`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ content: "v2 content" }),
  });
  const detail = (await (
    await app.request(`/api/prompts/${prompt.id}`, { headers })
  ).json()) as PromptDetail;
  const versionIds = detail.versions.map((v) => v.id);

  const created = await app.request("/api/experiments", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      promptId: prompt.id,
      versionIds,
      modelIds: ["good/model", "bad/model"],
    }),
  });
  assert.equal(created.status, 201);
  const experiment = (await created.json()) as ExperimentDetail;
  assert.equal(experiment.totalCount, 4);

  const done = await waitForDone(app, headers, experiment.id);
  assert.equal(done.status, "done");
  assert.equal(done.okCount, 2);
  assert.equal(done.failCount, 2);
  const okCell = done.results.find(
    (r) => r.modelId === "good/model" && r.versionNumber === 2,
  );
  assert.equal(okCell?.output, "out:good/model");

  // winner marking
  const marked = await app.request(
    `/api/experiments/${experiment.id}/results/${okCell?.id}`,
    {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ winner: true }),
    },
  );
  assert.equal(marked.status, 200);
  const after = await waitForDone(app, headers, experiment.id);
  assert.equal(after.results.find((r) => r.id === okCell?.id)?.winner, true);

  // list endpoint carries counts
  const list = (await (
    await app.request("/api/experiments", { headers })
  ).json()) as Experiment[];
  assert.equal(list[0]?.okCount, 2);
});

test("experiment validation: foreign versions and unknown models -> 400", async () => {
  const { app, db } = await buildApp({
    complete: async () => ({
      content: "x",
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
    }),
  });
  const headers = await loginHeaders(app);
  await db
    .insert(models)
    .values({ modelId: "good/model", label: "G", family: "TEST" });
  const promptRes = await app.request("/api/prompts", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "P", content: "c" }),
  });
  const prompt = (await promptRes.json()) as Prompt;

  const badVersion = await app.request("/api/experiments", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      promptId: prompt.id,
      versionIds: ["00000000-0000-4000-8000-000000000000"],
      modelIds: ["good/model"],
    }),
  });
  assert.equal(badVersion.status, 400);

  const detail = (await (
    await app.request(`/api/prompts/${prompt.id}`, { headers })
  ).json()) as PromptDetail;
  const badModel = await app.request("/api/experiments", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      promptId: prompt.id,
      versionIds: [detail.versions[0]?.id],
      modelIds: ["not/in-catalog"],
    }),
  });
  assert.equal(badModel.status, 400);
});
```

- [ ] **Step 6: Run to verify it fails, then write routes + wiring**

`apps/server/src/api/experiments.ts`:

```ts
import { ExperimentInputSchema } from "@holonet/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/index.js";
import type { ExperimentRow } from "../db/schema.js";
import {
  experimentResults,
  experiments,
  models,
  prompts,
  promptVersions,
} from "../db/schema.js";
import type { ExperimentRunner } from "../scheduler/experimentRunner.js";
import {
  rowToExperiment,
  rowToExperimentResult,
} from "./promptSerialize.js";

function validationError(message: string) {
  return { error: { code: "VALIDATION" as const, message } };
}

function notFound(message = "Experiment not found") {
  return { error: { code: "NOT_FOUND" as const, message } };
}

type StatusCounts = { ok: number; fail: number; total: number };

async function statusCounts(db: Db): Promise<Map<string, StatusCounts>> {
  const rows = await db
    .select({
      experimentId: experimentResults.experimentId,
      status: experimentResults.status,
      count: sql<number>`count(*)::int`,
    })
    .from(experimentResults)
    .groupBy(experimentResults.experimentId, experimentResults.status);
  const map = new Map<string, StatusCounts>();
  for (const row of rows) {
    const entry = map.get(row.experimentId) ?? { ok: 0, fail: 0, total: 0 };
    entry.total += row.count;
    if (row.status === "ok") entry.ok += row.count;
    if (row.status === "fail") entry.fail += row.count;
    map.set(row.experimentId, entry);
  }
  return map;
}

const NO_COUNTS: StatusCounts = { ok: 0, fail: 0, total: 0 };

export function createExperimentsRoutes(
  db: Db,
  runner: ExperimentRunner,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const rows = await db
      .select()
      .from(experiments)
      .orderBy(desc(experiments.createdAt))
      .limit(50);
    const counts = await statusCounts(db);
    return c.json(
      rows.map((row) => rowToExperiment(row, counts.get(row.id) ?? NO_COUNTS)),
    );
  });

  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const rows = await db
      .select()
      .from(experiments)
      .where(eq(experiments.id, id));
    const experiment = rows[0];
    if (!experiment) return c.json(notFound(), 404);
    const results = await db
      .select()
      .from(experimentResults)
      .where(eq(experimentResults.experimentId, id));
    const sorted = [...results].sort(
      (a, b) =>
        a.versionNumber - b.versionNumber || a.modelId.localeCompare(b.modelId),
    );
    const counts = {
      ok: results.filter((r) => r.status === "ok").length,
      fail: results.filter((r) => r.status === "fail").length,
      total: results.length,
    };
    return c.json({
      ...rowToExperiment(experiment, counts),
      results: sorted.map(rowToExperimentResult),
    });
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ExperimentInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid request"),
        400,
      );
    }
    const promptRows = await db
      .select()
      .from(prompts)
      .where(eq(prompts.id, parsed.data.promptId));
    const prompt = promptRows[0];
    if (!prompt) return c.json(notFound("Prompt not found"), 404);

    const versions = await db
      .select()
      .from(promptVersions)
      .where(
        and(
          eq(promptVersions.promptId, prompt.id),
          inArray(promptVersions.id, parsed.data.versionIds),
        ),
      );
    if (versions.length !== parsed.data.versionIds.length) {
      return c.json(
        validationError("Some versions do not belong to this prompt"),
        400,
      );
    }
    const catalog = await db
      .select({ modelId: models.modelId })
      .from(models)
      .where(inArray(models.modelId, parsed.data.modelIds));
    if (catalog.length !== new Set(parsed.data.modelIds).size) {
      return c.json(validationError("Some models are not in the catalog"), 400);
    }

    const now = new Date();
    const experiment = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(experiments)
        .values({
          promptId: prompt.id,
          promptName: prompt.name,
          status: "running",
          createdAt: now,
        })
        .returning();
      const created = inserted[0] as ExperimentRow;
      await tx.insert(experimentResults).values(
        versions.flatMap((version) =>
          parsed.data.modelIds.map((modelId) => ({
            experimentId: created.id,
            versionId: version.id,
            versionNumber: version.version,
            modelId,
          })),
        ),
      );
      return created;
    });

    runner.start(experiment.id);

    const total = versions.length * parsed.data.modelIds.length;
    return c.json(
      {
        ...rowToExperiment(experiment, { ok: 0, fail: 0, total }),
        results: [],
      },
      201,
    );
  });

  app.patch("/:id/results/:rid", async (c) => {
    const id = c.req.param("id");
    const rid = c.req.param("rid");
    const body = await c.req.json().catch(() => null);
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as { winner?: unknown }).winner !== "boolean"
    ) {
      return c.json(validationError("Expected { winner: boolean }"), 400);
    }
    const rows = await db
      .select()
      .from(experimentResults)
      .where(
        and(
          eq(experimentResults.id, rid),
          eq(experimentResults.experimentId, id),
        ),
      );
    if (rows.length === 0) return c.json(notFound("Result not found"), 404);
    await db
      .update(experimentResults)
      .set({ winner: (body as { winner: boolean }).winner })
      .where(eq(experimentResults.id, rid));
    const updated = await db
      .select()
      .from(experimentResults)
      .where(eq(experimentResults.id, rid));
    return c.json(rowToExperimentResult(updated[0]!));
  });

  return app;
}
```

(If Biome flags the `updated[0]!` non-null assertion, replace with a fetch-and-guard: `const row = updated[0]; if (!row) return c.json(notFound("Result not found"), 404); return c.json(rowToExperimentResult(row));`.)

In `apps/server/src/app.ts` — extend `AppDeps` and register:

```ts
import { createExperimentsRoutes } from "./api/experiments.js";
import type { ExperimentRunner } from "./scheduler/experimentRunner.js";

export interface AppDeps {
  db: Db;
  config: Config;
  scheduler: Scheduler;
  executor: Executor;
  experimentRunner: ExperimentRunner;
}
// destructure experimentRunner in createApp and:
api.route("/experiments", createExperimentsRoutes(db, experimentRunner));
```

In `apps/server/src/api/test-helpers.ts` — build the runner with an injectable `complete`:

```ts
import {
  type CompleteFn,
  createExperimentRunner,
} from "../scheduler/experimentRunner.js";

export async function buildApp(overrides?: { complete?: CompleteFn }) {
  // ...existing body unchanged until createApp...
  const experimentRunner = createExperimentRunner({
    db,
    config,
    logger,
    complete: overrides?.complete,
  });
  const app = createApp({ db, config, scheduler, executor, experimentRunner });
  return { app, db, scheduler, experimentRunner };
}
```

In `apps/server/src/index.ts` — after `logger.info("database migrated")` (line 42) and before `createExecutor`:

```ts
import {
  createExperimentRunner,
  recoverInterruptedExperiments,
} from "./scheduler/experimentRunner.js";
// ...
await recoverInterruptedExperiments(db, logger);
const experimentRunner = createExperimentRunner({ db, config, logger });
```

and pass it: `createApp({ db, config, scheduler, executor, experimentRunner })`.

- [ ] **Step 7: Run all server tests**

Run: `pnpm --filter @holonet/server test`
Expected: PASS — including all earlier route tests (buildApp change is backward compatible).

- [ ] **Step 8: Commit**

```bash
pnpm check && pnpm typecheck
git add apps/server/src/scheduler/experimentRunner.ts apps/server/src/scheduler/experimentRunner.test.ts apps/server/src/api/experiments.ts apps/server/src/api/experiments.test.ts apps/server/src/app.ts apps/server/src/api/test-helpers.ts apps/server/src/index.ts
git commit -m "feat(server): A/B experiments with in-process runner and boot recovery"
```

---

### Task 11: Web foundation — API client, ViewId, Rail entry, PromptsView shell

Web tasks have no test runner (repo convention) — the cycle is implement → `pnpm --filter @holonet/web typecheck` → `pnpm check` → visual smoke via `pnpm dev` when needed.

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/lib/types.ts`
- Modify: `apps/web/src/components/Rail.tsx`
- Modify: `apps/web/src/components/Console.tsx`
- Create: `apps/web/src/views/prompts/PromptsView.tsx`
- Create: `apps/web/src/views/prompts/LibraryTab.tsx` (minimal, replaced in Task 12)
- Create: `apps/web/src/views/prompts/ExperimentsTab.tsx` (minimal, replaced in Task 15)
- Create: `apps/web/src/views/prompts/SchemasTab.tsx` (minimal, replaced in Task 16)

**Interfaces:**
- Produces (consumed by Tasks 12–16): everything appended to `client.ts` below; `PromptsTabProps = { models: Model[]; pushToast: (message: string) => void }` — the props type each tab component accepts (exported from `PromptsView.tsx`).

- [ ] **Step 1: Extend the API client**

Append to `apps/web/src/api/client.ts` (extend the existing type-import from `@holonet/shared` with the new types):

```ts
import type {
  Experiment,
  ExperimentDetail,
  ExperimentInput,
  Folder,
  FolderInput,
  OptimizeInput,
  OptimizeOutput,
  PlaygroundRunInput,
  PlaygroundRunOutput,
  Prompt,
  PromptDetail,
  PromptInput,
  PromptMetaUpdate,
  PromptVersion,
  PromptVersionInput,
  SchemaDoc,
  SchemaDocInput,
} from "@holonet/shared";

export const foldersQueryOptions = queryOptions({
  queryKey: ["folders"] as const,
  queryFn: () => api.get<Folder[]>("/api/folders"),
});

export const promptsQueryOptions = queryOptions({
  queryKey: ["prompts"] as const,
  queryFn: () => api.get<Prompt[]>("/api/prompts"),
});

export function promptQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["prompt", id] as const,
    queryFn: () => api.get<PromptDetail>(`/api/prompts/${id}`),
  });
}

export const experimentsQueryOptions = queryOptions({
  queryKey: ["experiments"] as const,
  queryFn: () => api.get<Experiment[]>("/api/experiments"),
});

export function experimentQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["experiment", id] as const,
    queryFn: () => api.get<ExperimentDetail>(`/api/experiments/${id}`),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 5000 : false,
  });
}

export const schemasQueryOptions = queryOptions({
  queryKey: ["schemas"] as const,
  queryFn: () => api.get<SchemaDoc[]>("/api/schemas"),
});

export function createFolder(input: FolderInput) {
  return api.post<Folder>("/api/folders", input);
}

export function renameFolder(id: string, input: FolderInput) {
  return api.patch<Folder>(`/api/folders/${id}`, input);
}

export function deleteFolder(id: string) {
  return api.delete<void>(`/api/folders/${id}`);
}

export function createPrompt(input: PromptInput) {
  return api.post<Prompt>("/api/prompts", input);
}

export function updatePromptMeta(id: string, input: PromptMetaUpdate) {
  return api.patch<Prompt>(`/api/prompts/${id}`, input);
}

export function createPromptVersion(id: string, input: PromptVersionInput) {
  return api.post<PromptVersion>(`/api/prompts/${id}/versions`, input);
}

export function deletePrompt(id: string) {
  return api.delete<void>(`/api/prompts/${id}`);
}

export function optimizePrompt(id: string, input: OptimizeInput) {
  return api.post<OptimizeOutput>(`/api/prompts/${id}/optimize`, input);
}

export function createExperiment(input: ExperimentInput) {
  return api.post<ExperimentDetail>("/api/experiments", input);
}

export function setResultWinner(
  experimentId: string,
  resultId: string,
  winner: boolean,
) {
  return api.patch(`/api/experiments/${experimentId}/results/${resultId}`, {
    winner,
  });
}

export function createSchema(input: SchemaDocInput) {
  return api.post<SchemaDoc>("/api/schemas", input);
}

export function updateSchema(id: string, input: SchemaDocInput) {
  return api.patch<SchemaDoc>(`/api/schemas/${id}`, input);
}

export function deleteSchema(id: string) {
  return api.delete<void>(`/api/schemas/${id}`);
}

export function playgroundRun(input: PlaygroundRunInput) {
  return api.post<PlaygroundRunOutput>("/api/playground/run", input);
}
```

- [ ] **Step 2: Add the view id and Rail entry**

`apps/web/src/lib/types.ts` — add `"prompts"` to `ViewId`:

```ts
export type ViewId =
  | "overview"
  | "tasks"
  | "integrations"
  | "activity"
  | "prompts"
  | "settings";
```

`apps/web/src/components/Rail.tsx` — add `promptsCount: number` to `RailProps`, destructure it, and change `navDefs` to (PROMPTS becomes 05, SETTINGS becomes 06):

```ts
const navDefs: NavDef[] = [
  { id: "overview", code: "01", label: "OVERVIEW", count: "" },
  { id: "tasks", code: "02", label: "CRON TASKS", count: String(tasksCount) },
  { id: "integrations", code: "03", label: "INTEGRATIONS", count: "1" },
  { id: "activity", code: "04", label: "ACTIVITY", count: String(runsCount) },
  { id: "prompts", code: "05", label: "PROMPTS", count: String(promptsCount) },
  { id: "settings", code: "06", label: "SETTINGS", count: "" },
];
```

- [ ] **Step 3: Create the PromptsView shell + minimal tabs**

`apps/web/src/views/prompts/PromptsView.tsx`:

```tsx
import type { Model } from "@holonet/shared";
import { useState } from "react";
import {
  AMBER,
  CHAKRA,
  DIM,
  h1Style,
  HI,
  sectionHeader,
  sectorLabel,
} from "../../lib/theme.js";
import { ExperimentsTab } from "./ExperimentsTab.js";
import { LibraryTab } from "./LibraryTab.js";
import { SchemasTab } from "./SchemasTab.js";

export interface PromptsTabProps {
  models: Model[];
  pushToast: (message: string) => void;
}

type PromptsTab = "library" | "experiments" | "schemas";

const TABS: { id: PromptsTab; label: string }[] = [
  { id: "library", label: "LIBRARY" },
  { id: "experiments", label: "EXPERIMENTS" },
  { id: "schemas", label: "SCHEMAS" },
];

export function PromptsView({ models, pushToast }: PromptsTabProps) {
  const [tab, setTab] = useState<PromptsTab>("library");

  return (
    <section>
      <header style={sectionHeader}>
        <span style={sectorLabel}>SECTOR · 05</span>
        <h1 style={h1Style}>PROMPT ENGINEERING</h1>
      </header>

      <div style={{ display: "flex", gap: "6px", marginBottom: "18px" }}>
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                fontFamily: CHAKRA,
                fontWeight: 600,
                fontSize: "11px",
                letterSpacing: ".16em",
                padding: "7px 14px",
                cursor: "pointer",
                border: `1px solid ${on ? "rgba(255,179,71,.5)" : "rgba(140,160,190,.22)"}`,
                background: on ? "rgba(255,179,71,.12)" : "transparent",
                color: on ? AMBER : DIM,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ color: HI }}>
        {tab === "library" && (
          <LibraryTab models={models} pushToast={pushToast} />
        )}
        {tab === "experiments" && (
          <ExperimentsTab models={models} pushToast={pushToast} />
        )}
        {tab === "schemas" && (
          <SchemasTab models={models} pushToast={pushToast} />
        )}
      </div>
    </section>
  );
}
```

Minimal tab files so the shell compiles and ships (each is fully replaced by its own later task). `apps/web/src/views/prompts/LibraryTab.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { promptsQueryOptions } from "../../api/client.js";
import { DIM } from "../../lib/theme.js";
import type { PromptsTabProps } from "./PromptsView.js";

export function LibraryTab(_props: PromptsTabProps) {
  const promptsQuery = useQuery(promptsQueryOptions);
  return (
    <div style={{ color: DIM, fontSize: "12px", letterSpacing: ".08em" }}>
      {promptsQuery.data?.length ?? 0} PROMPTS IN LIBRARY
    </div>
  );
}
```

`ExperimentsTab.tsx` and `SchemasTab.tsx`: same shape — `useQuery(experimentsQueryOptions)` / `useQuery(schemasQueryOptions)` and a one-line count (`… EXPERIMENTS` / `… SCHEMAS`), identical imports otherwise.

- [ ] **Step 4: Wire Console**

`apps/web/src/components/Console.tsx`:
- add imports: `promptsQueryOptions` (from `../api/client.js`), `PromptsView` (from `../views/prompts/PromptsView.js`);
- next to the other queries: `const promptsQuery = useQuery(promptsQueryOptions);`
- pass `promptsCount={promptsQuery.data?.length ?? 0}` to `<Rail …>`;
- in `<main>`, after the activity view line:

```tsx
{view === "prompts" && (
  <PromptsView models={models} pushToast={pushToast} />
)}
```

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm check && pnpm --filter @holonet/web build
git add apps/web/src
git commit -m "feat(web): PROMPTS rail view with library/experiments/schemas shell"
```

---

### Task 12: Library tab — folders strip, filters, prompt list, create form

**Files:**
- Rewrite: `apps/web/src/views/prompts/LibraryTab.tsx`
- Create: `apps/web/src/views/prompts/NewPromptForm.tsx`

**Interfaces:**
- Consumes: client fns from Task 11; `PromptsTabProps` from `PromptsView.tsx`; `PromptDrawer` from Task 13 — until Task 13 lands, LibraryTab renders nothing for the open prompt (`{openId && <PromptDrawer …>}` line is added in Task 13; this task keeps a `setOpenId` state that is passed to rows already).
- Produces: `LibraryTab` (full), `NewPromptForm` with props `{ folders: Folder[]; schemas: SchemaDoc[]; onCancel: () => void; onCreate: (input: PromptInput) => void; isSaving: boolean }`.

- [ ] **Step 1: Implement `NewPromptForm`**

`apps/web/src/views/prompts/NewPromptForm.tsx`:

```tsx
import type { Folder, PromptInput, SchemaDoc } from "@holonet/shared";
import { useState } from "react";
import { AMBER, BAD, CHAKRA, DIM, HI } from "../../lib/theme.js";

const MONO = "'JetBrains Mono', monospace";

export const fieldLabel = {
  fontSize: "9px",
  letterSpacing: ".24em",
  color: DIM,
  marginBottom: "6px",
} as const;

export const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  fontFamily: MONO,
  fontSize: "12px",
  color: HI,
  background: "rgba(140,160,190,.07)",
  border: "1px solid rgba(140,160,190,.25)",
  outline: "none",
} as const;

export const primaryButton = {
  fontFamily: CHAKRA,
  fontWeight: 700,
  fontSize: "11px",
  letterSpacing: ".18em",
  padding: "9px 16px",
  cursor: "pointer",
  border: "1px solid rgba(255,179,71,.55)",
  background: "rgba(255,179,71,.16)",
  color: AMBER,
} as const;

export const ghostButton = {
  ...primaryButton,
  border: "1px solid rgba(140,160,190,.28)",
  background: "transparent",
  color: DIM,
} as const;

interface NewPromptFormProps {
  folders: Folder[];
  schemas: SchemaDoc[];
  onCancel: () => void;
  onCreate: (input: PromptInput) => void;
  isSaving: boolean;
}

export function NewPromptForm({
  folders,
  schemas,
  onCancel,
  onCreate,
  isSaving,
}: NewPromptFormProps) {
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState<string>("");
  const [schemaId, setSchemaId] = useState<string>("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (name.trim() === "" || content.trim() === "") {
      setError("NAME AND CONTENT ARE REQUIRED");
      return;
    }
    onCreate({
      name: name.trim(),
      folderId: folderId === "" ? null : folderId,
      schemaId: schemaId === "" ? null : schemaId,
      tags: tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t !== "")
        .slice(0, 12),
      content,
    });
  }

  return (
    <div
      style={{
        border: "1px solid rgba(255,179,71,.3)",
        background: "rgba(9,11,16,.72)",
        padding: "16px",
        marginBottom: "16px",
        display: "grid",
        gap: "12px",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
        <div>
          <div style={fieldLabel}>NAME</div>
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <div style={fieldLabel}>FOLDER</div>
          <select
            style={inputStyle}
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
          >
            <option value="">— NONE —</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={fieldLabel}>OUTPUT SCHEMA</div>
          <select
            style={inputStyle}
            value={schemaId}
            onChange={(e) => setSchemaId(e.target.value)}
          >
            <option value="">— NONE —</option>
            {schemas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <div style={fieldLabel}>TAGS (COMMA-SEPARATED)</div>
        <input
          style={inputStyle}
          value={tagsRaw}
          onChange={(e) => setTagsRaw(e.target.value)}
        />
      </div>
      <div>
        <div style={fieldLabel}>CONTENT · V1</div>
        <textarea
          style={{ ...inputStyle, minHeight: "140px", resize: "vertical" }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
      {error && (
        <div style={{ color: BAD, fontSize: "10px", letterSpacing: ".14em" }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          style={primaryButton}
          disabled={isSaving}
          onClick={submit}
        >
          {isSaving ? "SAVING…" : "CREATE PROMPT"}
        </button>
        <button type="button" style={ghostButton} onClick={onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `LibraryTab`**

`apps/web/src/views/prompts/LibraryTab.tsx`:

```tsx
import type { Prompt, PromptInput } from "@holonet/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  createFolder,
  createPrompt,
  deleteFolder,
  foldersQueryOptions,
  promptsQueryOptions,
  renameFolder,
  schemasQueryOptions,
} from "../../api/client.js";
import { errorMessage } from "../../lib/errors.js";
import { AMBER, CHAKRA, DIM, HI } from "../../lib/theme.js";
import {
  ghostButton,
  inputStyle,
  NewPromptForm,
  primaryButton,
} from "./NewPromptForm.js";
import type { PromptsTabProps } from "./PromptsView.js";

type FolderFilter = "all" | "none" | string;

export function LibraryTab({ models, pushToast }: PromptsTabProps) {
  const queryClient = useQueryClient();
  const foldersQuery = useQuery(foldersQueryOptions);
  const promptsQuery = useQuery(promptsQueryOptions);
  const schemasQuery = useQuery(schemasQueryOptions);
  const folders = foldersQuery.data ?? [];
  const prompts = promptsQuery.data ?? [];
  const schemas = schemasQuery.data ?? [];

  const [folderFilter, setFolderFilter] = useState<FolderFilter>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function invalidateLibrary() {
    queryClient.invalidateQueries({ queryKey: ["folders"] });
    queryClient.invalidateQueries({ queryKey: ["prompts"] });
  }

  const createPromptMutation = useMutation({
    mutationFn: (input: PromptInput) => createPrompt(input),
    onSuccess: (created) => {
      invalidateLibrary();
      setCreating(false);
      setOpenId(created.id);
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => createFolder({ name }),
    onSuccess: () => {
      invalidateLibrary();
      setNewFolderName("");
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const renameFolderMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameFolder(id, { name }),
    onSuccess: () => {
      invalidateLibrary();
      setRenamingId(null);
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => deleteFolder(id),
    onSuccess: () => {
      invalidateLibrary();
      setFolderFilter("all");
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const allTags = useMemo(
    () => [...new Set(prompts.flatMap((p) => p.tags))].sort(),
    [prompts],
  );

  const visible = prompts.filter((p) => {
    if (folderFilter === "none" && p.folderId !== null) return false;
    if (folderFilter !== "all" && folderFilter !== "none" && p.folderId !== folderFilter)
      return false;
    if (tagFilter && !p.tags.includes(tagFilter)) return false;
    if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const folderRow = (
    id: FolderFilter,
    label: string,
    count: number,
    deletable?: string,
  ) => {
    const on = folderFilter === id;
    return (
      <div key={String(id)} style={{ display: "flex", alignItems: "center" }}>
        <button
          type="button"
          onClick={() => setFolderFilter(on ? "all" : id)}
          onDoubleClick={() => {
            if (deletable) {
              setRenamingId(deletable);
              setRenameValue(label);
            }
          }}
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "space-between",
            padding: "7px 10px",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            fontFamily: CHAKRA,
            fontSize: "11px",
            letterSpacing: ".12em",
            background: on ? "rgba(255,179,71,.1)" : "transparent",
            color: on ? AMBER : "#9aa6ba",
          }}
        >
          <span>{label}</span>
          <span style={{ color: DIM }}>{count}</span>
        </button>
        {deletable && (
          <button
            type="button"
            title="Delete folder"
            onClick={() => deleteFolderMutation.mutate(deletable)}
            style={{
              border: "none",
              background: "transparent",
              color: DIM,
              cursor: "pointer",
              fontSize: "12px",
              padding: "0 6px",
            }}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "210px 1fr", gap: "20px" }}>
      {/* Folder strip */}
      <aside
        style={{
          border: "1px solid rgba(140,160,190,.18)",
          background: "rgba(9,11,16,.6)",
          padding: "10px 6px",
          alignSelf: "start",
        }}
      >
        <div style={{ fontSize: "8.5px", letterSpacing: ".3em", color: DIM, padding: "4px 10px 10px" }}>
          FOLDERS
        </div>
        {folderRow("all", "ALL", prompts.length)}
        {folderRow("none", "UNFILED", prompts.filter((p) => p.folderId === null).length)}
        {folders.map((f) =>
          renamingId === f.id ? (
            <div key={f.id} style={{ padding: "4px 6px" }}>
              <input
                style={inputStyle}
                value={renameValue}
                autoFocus
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && renameValue.trim() !== "") {
                    renameFolderMutation.mutate({ id: f.id, name: renameValue.trim() });
                  }
                  if (e.key === "Escape") setRenamingId(null);
                }}
              />
            </div>
          ) : (
            folderRow(f.id, f.name, f.promptCount, f.id)
          ),
        )}
        <div style={{ padding: "10px 6px 2px", display: "flex", gap: "4px" }}>
          <input
            style={{ ...inputStyle, fontSize: "10px" }}
            placeholder="NEW FOLDER"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newFolderName.trim() !== "") {
                createFolderMutation.mutate(newFolderName.trim());
              }
            }}
          />
        </div>
      </aside>

      {/* List */}
      <div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "14px", alignItems: "center" }}>
          <input
            style={{ ...inputStyle, maxWidth: "260px" }}
            placeholder="SEARCH…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", flex: 1 }}>
            {allTags.map((t) => {
              const on = tagFilter === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter(on ? null : t)}
                  style={{
                    fontSize: "9px",
                    letterSpacing: ".12em",
                    padding: "3px 8px",
                    cursor: "pointer",
                    border: `1px solid ${on ? "rgba(255,179,71,.5)" : "rgba(140,160,190,.25)"}`,
                    background: on ? "rgba(255,179,71,.12)" : "transparent",
                    color: on ? AMBER : DIM,
                  }}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <button type="button" style={primaryButton} onClick={() => setCreating(true)}>
            + NEW PROMPT
          </button>
        </div>

        {creating && (
          <NewPromptForm
            folders={folders}
            schemas={schemas}
            isSaving={createPromptMutation.isPending}
            onCancel={() => setCreating(false)}
            onCreate={(input) => createPromptMutation.mutate(input)}
          />
        )}

        {visible.length === 0 ? (
          <div style={{ color: DIM, fontSize: "12px", letterSpacing: ".1em", padding: "30px 0" }}>
            NO PROMPTS MATCH.
          </div>
        ) : (
          visible.map((p: Prompt) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setOpenId(p.id)}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto",
                gap: "14px",
                alignItems: "center",
                textAlign: "left",
                padding: "12px 14px",
                marginBottom: "6px",
                cursor: "pointer",
                border: "1px solid rgba(140,160,190,.16)",
                background: "rgba(9,11,16,.55)",
                color: HI,
              }}
            >
              <span style={{ fontFamily: CHAKRA, fontWeight: 600, fontSize: "13px", letterSpacing: ".08em" }}>
                {p.name}
              </span>
              <span style={{ display: "flex", gap: "4px" }}>
                {p.tags.map((t) => (
                  <span key={t} style={{ fontSize: "8.5px", letterSpacing: ".1em", padding: "1px 6px", border: "1px solid rgba(140,160,190,.3)", color: DIM }}>
                    {t}
                  </span>
                ))}
              </span>
              <span style={{ fontSize: "10px", color: DIM, letterSpacing: ".1em" }}>
                {folders.find((f) => f.id === p.folderId)?.name ?? "UNFILED"}
              </span>
              <span style={{ fontSize: "10px", color: AMBER, letterSpacing: ".1em" }}>
                v{p.headVersion}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
```

The `openId` state is set but unused until Task 13 mounts `PromptDrawer` — add a `void openId;` line OR (preferred) leave a temporary render `{openId && null}` out entirely and suppress the unused warning by using it in the row's `aria-expanded={openId === p.id}` attribute. Use the aria attribute — it is real, harmless, and removed by nothing later. `models` is unused in this task — keep the destructuring as `{ models: _models, pushToast }` until Task 13 uses it, then restore.

- [ ] **Step 3: Verify and commit**

```bash
pnpm typecheck && pnpm check && pnpm --filter @holonet/web build
git add apps/web/src/views/prompts
git commit -m "feat(web): prompt library tab — folders, tags, search, create"
```

---

### Task 13: Prompt drawer — editor, versions, diff, restore, delete

**Files:**
- Create: `apps/web/src/views/prompts/PromptDrawer.tsx`
- Modify: `apps/web/src/views/prompts/LibraryTab.tsx` (mount drawer)

**Interfaces:**
- Consumes: `promptQueryOptions`, `createPromptVersion`, `updatePromptMeta`, `deletePrompt` (Task 11); `lineDiff` from `@holonet/shared` (Task 2); style constants from `NewPromptForm.tsx` (Task 12). Buttons call `onOptimize`/`onTestRun` callbacks — wired to real modals in Task 14; in this task LibraryTab passes no-op handlers `() => {}`.
- Produces: `PromptDrawer` with props:

```ts
interface PromptDrawerProps {
  promptId: string;
  folders: Folder[];
  schemas: SchemaDoc[];
  onClose: () => void;
  pushToast: (message: string) => void;
  onOptimize: (detail: PromptDetail) => void;
  onTestRun: (content: string, schemaId: string | null) => void;
}
```

- [ ] **Step 1: Implement the drawer**

`apps/web/src/views/prompts/PromptDrawer.tsx` (overlay + right panel like `apps/web/src/components/TaskDrawer.tsx` — match its overlay opacity, slide-in animation name `slidein`, and panel width if they differ from below):

```tsx
import type { Folder, PromptDetail, SchemaDoc } from "@holonet/shared";
import { lineDiff } from "@holonet/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  createPromptVersion,
  deletePrompt,
  promptQueryOptions,
  updatePromptMeta,
} from "../../api/client.js";
import { errorMessage } from "../../lib/errors.js";
import { AMBER, BAD, CHAKRA, DIM, HI, OK } from "../../lib/theme.js";
import {
  fieldLabel,
  ghostButton,
  inputStyle,
  primaryButton,
} from "./NewPromptForm.js";

const MONO = "'JetBrains Mono', monospace";

interface PromptDrawerProps {
  promptId: string;
  folders: Folder[];
  schemas: SchemaDoc[];
  onClose: () => void;
  pushToast: (message: string) => void;
  onOptimize: (detail: PromptDetail) => void;
  onTestRun: (content: string, schemaId: string | null) => void;
}

export function PromptDrawer({
  promptId,
  folders,
  schemas,
  onClose,
  pushToast,
  onOptimize,
  onTestRun,
}: PromptDrawerProps) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery(promptQueryOptions(promptId));
  const detail = detailQuery.data;
  const head = detail?.versions[0];

  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  const [diffVersionId, setDiffVersionId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Seed the editor once per loaded head version; user edits are not clobbered
  // by background refetches because the key includes the version id.
  const headId = head?.id;
  useEffect(() => {
    if (headId && head) setContent(head.content);
    // eslint-style note: head.content is derived from headId — intentional.
  }, [headId]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["prompts"] });
    queryClient.invalidateQueries({ queryKey: ["prompt", promptId] });
    queryClient.invalidateQueries({ queryKey: ["folders"] });
  }

  const saveVersionMutation = useMutation({
    mutationFn: (input: { content: string; note?: string }) =>
      createPromptVersion(promptId, input),
    onSuccess: () => {
      invalidate();
      setNote("");
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const metaMutation = useMutation({
    mutationFn: (input: Parameters<typeof updatePromptMeta>[1]) =>
      updatePromptMeta(promptId, input),
    onSuccess: invalidate,
    onError: (error) => pushToast(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePrompt(promptId),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  if (!detail || !head) return null;

  const dirty = content !== head.content;
  const diffVersion = detail.versions.find((v) => v.id === diffVersionId);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 40 }}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          cursor: "pointer",
          background: "rgba(4,5,8,.66)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(680px, 92vw)",
          overflow: "auto",
          background: "#0a0c11",
          borderLeft: "1px solid rgba(255,179,71,.3)",
          padding: "22px 24px 40px",
          animation: "slidein .18s ease-out",
        }}
      >
        {/* Header / metadata */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <span style={{ fontSize: "9px", letterSpacing: ".3em", color: DIM }}>
            PROMPT · v{detail.headVersion} · {detail.versionCount} VERSIONS
          </span>
          <button type="button" style={ghostButton} onClick={onClose}>
            CLOSE
          </button>
        </div>

        <div style={{ display: "grid", gap: "12px", marginBottom: "18px" }}>
          <div>
            <div style={fieldLabel}>NAME</div>
            <input
              style={{ ...inputStyle, fontFamily: CHAKRA, fontSize: "15px" }}
              defaultValue={detail.name}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== "" && value !== detail.name) {
                  metaMutation.mutate({ name: value });
                }
              }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
            <div>
              <div style={fieldLabel}>FOLDER</div>
              <select
                style={inputStyle}
                value={detail.folderId ?? ""}
                onChange={(e) =>
                  metaMutation.mutate({
                    folderId: e.target.value === "" ? null : e.target.value,
                  })
                }
              >
                <option value="">— NONE —</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={fieldLabel}>OUTPUT SCHEMA</div>
              <select
                style={inputStyle}
                value={detail.schemaId ?? ""}
                onChange={(e) =>
                  metaMutation.mutate({
                    schemaId: e.target.value === "" ? null : e.target.value,
                  })
                }
              >
                <option value="">— NONE —</option>
                {schemas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={fieldLabel}>TAGS</div>
              <input
                style={inputStyle}
                defaultValue={detail.tags.join(", ")}
                onBlur={(e) =>
                  metaMutation.mutate({
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter((t) => t !== "")
                      .slice(0, 12),
                  })
                }
              />
            </div>
          </div>
        </div>

        {/* Editor */}
        <div style={fieldLabel}>CONTENT {dirty ? "· UNSAVED" : ""}</div>
        <textarea
          style={{
            ...inputStyle,
            fontFamily: MONO,
            minHeight: "220px",
            resize: "vertical",
            lineHeight: 1.55,
          }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div style={{ display: "flex", gap: "8px", margin: "10px 0 22px", alignItems: "center" }}>
          <input
            style={{ ...inputStyle, maxWidth: "260px" }}
            placeholder="VERSION NOTE (OPTIONAL)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            style={{ ...primaryButton, opacity: dirty ? 1 : 0.45 }}
            disabled={!dirty || saveVersionMutation.isPending}
            onClick={() =>
              saveVersionMutation.mutate({
                content,
                note: note.trim() === "" ? undefined : note.trim(),
              })
            }
          >
            {saveVersionMutation.isPending ? "SAVING…" : `SAVE AS v${detail.headVersion + 1}`}
          </button>
          <button type="button" style={ghostButton} onClick={() => onOptimize(detail)}>
            OPTIMIZE
          </button>
          <button
            type="button"
            style={ghostButton}
            onClick={() => onTestRun(content, detail.schemaId)}
          >
            TEST RUN
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            style={{ ...ghostButton, color: BAD, borderColor: "rgba(255,93,108,.4)" }}
            onClick={() => {
              if (confirmDelete) deleteMutation.mutate();
              else {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 2500);
              }
            }}
          >
            {confirmDelete ? "SURE?" : "DELETE"}
          </button>
        </div>

        {/* Version history */}
        <div style={fieldLabel}>VERSION HISTORY</div>
        {detail.versions.map((v) => (
          <div
            key={v.id}
            style={{
              display: "flex",
              gap: "12px",
              alignItems: "center",
              padding: "8px 10px",
              borderBottom: "1px solid rgba(140,160,190,.12)",
              fontSize: "11px",
            }}
          >
            <span style={{ color: AMBER, fontFamily: MONO, width: "34px" }}>v{v.version}</span>
            <span style={{ color: DIM, flex: 1 }}>{v.note ?? ""}</span>
            <span style={{ color: DIM }}>
              {new Date(v.createdAt).toLocaleString()}
            </span>
            {v.id !== head.id && (
              <>
                <button
                  type="button"
                  style={{ ...ghostButton, padding: "3px 8px", fontSize: "9px" }}
                  onClick={() => setDiffVersionId(diffVersionId === v.id ? null : v.id)}
                >
                  {diffVersionId === v.id ? "HIDE DIFF" : "DIFF"}
                </button>
                <button
                  type="button"
                  style={{ ...ghostButton, padding: "3px 8px", fontSize: "9px" }}
                  onClick={() =>
                    saveVersionMutation.mutate({
                      content: v.content,
                      note: `restored from v${v.version}`,
                    })
                  }
                >
                  RESTORE
                </button>
              </>
            )}
          </div>
        ))}

        {/* Diff vs head */}
        {diffVersion && (
          <div style={{ marginTop: "14px" }}>
            <div style={fieldLabel}>
              DIFF · v{diffVersion.version} → v{head.version}
            </div>
            <pre
              style={{
                fontFamily: MONO,
                fontSize: "11px",
                lineHeight: 1.6,
                padding: "12px",
                overflow: "auto",
                border: "1px solid rgba(140,160,190,.18)",
                background: "rgba(9,11,16,.6)",
                margin: 0,
              }}
            >
              {lineDiff(diffVersion.content, head.content).map((line, i) => (
                <div
                  key={`${i}-${line.text}`}
                  style={{
                    color:
                      line.kind === "add" ? OK : line.kind === "del" ? BAD : HI,
                  }}
                >
                  {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
                  {line.text}
                </div>
              ))}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `LibraryTab`**

In `apps/web/src/views/prompts/LibraryTab.tsx`: import `PromptDrawer`, restore the `models`/`pushToast` destructuring, and render at the end of the component (inside the outer `div`):

```tsx
{openId && (
  <PromptDrawer
    key={openId}
    promptId={openId}
    folders={folders}
    schemas={schemas}
    onClose={() => setOpenId(null)}
    pushToast={pushToast}
    onOptimize={() => {}}
    onTestRun={() => {}}
  />
)}
```

- [ ] **Step 3: Verify and commit**

```bash
pnpm typecheck && pnpm check && pnpm --filter @holonet/web build
git add apps/web/src/views/prompts
git commit -m "feat(web): prompt drawer with versioning, diff and restore"
```

---

### Task 14: Optimize modal + Test-run modal

**Files:**
- Create: `apps/web/src/views/prompts/OptimizeModal.tsx`
- Create: `apps/web/src/views/prompts/TestRunModal.tsx`
- Create: `apps/web/src/views/prompts/Modal.tsx` (shared shell)
- Modify: `apps/web/src/views/prompts/LibraryTab.tsx` (wire real handlers)

**Interfaces:**
- Consumes: `optimizePrompt`, `playgroundRun`, `createPromptVersion` (Task 11); `lineDiff` (Task 2); style constants (Task 12).
- Produces:

```ts
// Modal.tsx
export function Modal(props: { title: string; onClose: () => void; children: ReactNode }): JSX.Element;
// OptimizeModal.tsx
interface OptimizeModalProps {
  detail: PromptDetail; // optimizes the head version
  models: Model[];
  onClose: () => void;
  pushToast: (message: string) => void;
}
// TestRunModal.tsx
interface TestRunModalProps {
  content: string;
  schemaId: string | null;
  models: Model[];
  onClose: () => void;
  pushToast: (message: string) => void;
}
```

- [ ] **Step 1: Shared modal shell**

`apps/web/src/views/prompts/Modal.tsx`:

```tsx
import type { ReactNode } from "react";
import { CHAKRA, DIM } from "../../lib/theme.js";
import { ghostButton } from "./NewPromptForm.js";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50 }}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          cursor: "pointer",
          background: "rgba(4,5,8,.72)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: "min(860px, 94vw)",
          maxHeight: "88vh",
          overflow: "auto",
          background: "#0a0c11",
          border: "1px solid rgba(255,179,71,.35)",
          padding: "20px 22px 26px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <span
            style={{
              fontFamily: CHAKRA,
              fontWeight: 700,
              fontSize: "13px",
              letterSpacing: ".22em",
              color: DIM,
            }}
          >
            {title}
          </span>
          <button type="button" style={ghostButton} onClick={onClose}>
            CLOSE
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Optimize modal**

`apps/web/src/views/prompts/OptimizeModal.tsx`:

```tsx
import type { Model, OptimizeOutput, PromptDetail } from "@holonet/shared";
import { lineDiff } from "@holonet/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createPromptVersion, optimizePrompt } from "../../api/client.js";
import { errorMessage } from "../../lib/errors.js";
import { BAD, DIM, HI, OK } from "../../lib/theme.js";
import { Modal } from "./Modal.js";
import {
  fieldLabel,
  ghostButton,
  inputStyle,
  primaryButton,
} from "./NewPromptForm.js";

const MONO = "'JetBrains Mono', monospace";

interface OptimizeModalProps {
  detail: PromptDetail;
  models: Model[];
  onClose: () => void;
  pushToast: (message: string) => void;
}

export function OptimizeModal({
  detail,
  models,
  onClose,
  pushToast,
}: OptimizeModalProps) {
  const queryClient = useQueryClient();
  const head = detail.versions[0];
  const [targetModelId, setTargetModelId] = useState(models[0]?.modelId ?? "");
  const [optimizerModelId, setOptimizerModelId] = useState(
    models[0]?.modelId ?? "",
  );
  const [result, setResult] = useState<OptimizeOutput | null>(null);

  const optimizeMutation = useMutation({
    mutationFn: () =>
      optimizePrompt(detail.id, {
        versionId: head?.id ?? "",
        targetModelId,
        optimizerModelId,
      }),
    onSuccess: setResult,
    onError: (error) => pushToast(errorMessage(error)),
  });

  const acceptMutation = useMutation({
    mutationFn: () =>
      createPromptVersion(detail.id, {
        content: result?.improved ?? "",
        note: `optimized for ${targetModelId}`,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
      queryClient.invalidateQueries({ queryKey: ["prompt", detail.id] });
      onClose();
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  if (!head) return null;

  return (
    <Modal title={`OPTIMIZE · ${detail.name} · v${head.version}`} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "12px", alignItems: "end", marginBottom: "16px" }}>
        <div>
          <div style={fieldLabel}>TARGET MODEL</div>
          <select style={inputStyle} value={targetModelId} onChange={(e) => setTargetModelId(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.modelId}>
                {m.label} — {m.modelId}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={fieldLabel}>OPTIMIZER MODEL</div>
          <select style={inputStyle} value={optimizerModelId} onChange={(e) => setOptimizerModelId(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.modelId}>
                {m.label} — {m.modelId}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          style={primaryButton}
          disabled={optimizeMutation.isPending || models.length === 0}
          onClick={() => optimizeMutation.mutate()}
        >
          {optimizeMutation.isPending ? "OPTIMIZING…" : "RUN OPTIMIZER"}
        </button>
      </div>

      {result && (
        <>
          <div style={fieldLabel}>DIFF · CURRENT → IMPROVED</div>
          <pre
            style={{
              fontFamily: MONO,
              fontSize: "11px",
              lineHeight: 1.6,
              padding: "12px",
              overflow: "auto",
              maxHeight: "40vh",
              border: "1px solid rgba(140,160,190,.18)",
              background: "rgba(9,11,16,.6)",
              margin: "0 0 12px",
            }}
          >
            {lineDiff(head.content, result.improved).map((line, i) => (
              <div
                key={`${i}-${line.text}`}
                style={{ color: line.kind === "add" ? OK : line.kind === "del" ? BAD : HI }}
              >
                {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
                {line.text}
              </div>
            ))}
          </pre>
          {result.rationale !== "" && (
            <>
              <div style={fieldLabel}>RATIONALE</div>
              <div style={{ color: DIM, fontSize: "12px", lineHeight: 1.6, marginBottom: "14px" }}>
                {result.rationale}
              </div>
            </>
          )}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              style={primaryButton}
              disabled={acceptMutation.isPending}
              onClick={() => acceptMutation.mutate()}
            >
              {acceptMutation.isPending ? "SAVING…" : `ACCEPT AS v${detail.headVersion + 1}`}
            </button>
            <button type="button" style={ghostButton} onClick={() => setResult(null)}>
              DISCARD
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
```

- [ ] **Step 3: Test-run modal**

`apps/web/src/views/prompts/TestRunModal.tsx`:

```tsx
import type { Model, PlaygroundRunOutput } from "@holonet/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { playgroundRun } from "../../api/client.js";
import { errorMessage } from "../../lib/errors.js";
import { BAD, DIM, HI, OK } from "../../lib/theme.js";
import { Modal } from "./Modal.js";
import { fieldLabel, inputStyle, primaryButton } from "./NewPromptForm.js";

const MONO = "'JetBrains Mono', monospace";

interface TestRunModalProps {
  content: string;
  schemaId: string | null;
  models: Model[];
  onClose: () => void;
  pushToast: (message: string) => void;
}

export function TestRunModal({
  content,
  schemaId,
  models,
  onClose,
  pushToast,
}: TestRunModalProps) {
  const [modelId, setModelId] = useState(models[0]?.modelId ?? "");
  const [result, setResult] = useState<PlaygroundRunOutput | null>(null);

  const runMutation = useMutation({
    mutationFn: () => playgroundRun({ content, modelId, schemaId }),
    onSuccess: setResult,
    onError: (error) => pushToast(errorMessage(error)),
  });

  return (
    <Modal title="TEST RUN" onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", alignItems: "end", marginBottom: "16px" }}>
        <div>
          <div style={fieldLabel}>MODEL</div>
          <select style={inputStyle} value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.modelId}>
                {m.label} — {m.modelId}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          style={primaryButton}
          disabled={runMutation.isPending || models.length === 0}
          onClick={() => runMutation.mutate()}
        >
          {runMutation.isPending ? "RUNNING…" : "RUN"}
        </button>
      </div>

      {result && (
        <>
          <div style={{ display: "flex", gap: "16px", fontSize: "10px", letterSpacing: ".12em", color: DIM, marginBottom: "10px" }}>
            <span>{result.durationMs} MS</span>
            {result.tokensIn != null && <span>IN {result.tokensIn}</span>}
            {result.tokensOut != null && <span>OUT {result.tokensOut}</span>}
            {result.costUsd != null && <span>${result.costUsd}</span>}
            {result.validation && (
              <span style={{ color: result.validation.valid ? OK : BAD }}>
                SCHEMA {result.validation.valid ? "VALID" : "INVALID"}
              </span>
            )}
          </div>
          {result.validation && !result.validation.valid && (
            <ul style={{ color: BAD, fontSize: "11px", lineHeight: 1.7, margin: "0 0 10px", paddingLeft: "18px" }}>
              {result.validation.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <pre
            style={{
              fontFamily: MONO,
              fontSize: "11.5px",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              padding: "12px",
              maxHeight: "50vh",
              overflow: "auto",
              border: "1px solid rgba(140,160,190,.18)",
              background: "rgba(9,11,16,.6)",
              color: HI,
              margin: 0,
            }}
          >
            {result.output}
          </pre>
        </>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: Wire into LibraryTab**

In `apps/web/src/views/prompts/LibraryTab.tsx` add state and swap the no-op handlers:

```tsx
import type { PromptDetail } from "@holonet/shared";
import { OptimizeModal } from "./OptimizeModal.js";
import { TestRunModal } from "./TestRunModal.js";
// ...
const [optimizing, setOptimizing] = useState<PromptDetail | null>(null);
const [testRun, setTestRun] = useState<{ content: string; schemaId: string | null } | null>(null);
// PromptDrawer props:
onOptimize={(detail) => setOptimizing(detail)}
onTestRun={(content, schemaId) => setTestRun({ content, schemaId })}
// and after the drawer:
{optimizing && (
  <OptimizeModal
    detail={optimizing}
    models={models}
    onClose={() => setOptimizing(null)}
    pushToast={pushToast}
  />
)}
{testRun && (
  <TestRunModal
    content={testRun.content}
    schemaId={testRun.schemaId}
    models={models}
    onClose={() => setTestRun(null)}
    pushToast={pushToast}
  />
)}
```

- [ ] **Step 5: Verify and commit**

```bash
pnpm typecheck && pnpm check && pnpm --filter @holonet/web build
git add apps/web/src/views/prompts
git commit -m "feat(web): optimizer diff modal and playground test-run modal"
```

---

### Task 15: Experiments tab — list, new-experiment flow, live grid, winner marking

**Files:**
- Rewrite: `apps/web/src/views/prompts/ExperimentsTab.tsx`

**Interfaces:**
- Consumes: `experimentsQueryOptions`, `experimentQueryOptions` (polls every 5 s while `running`), `createExperiment`, `setResultWinner`, `promptsQueryOptions`, `promptQueryOptions`; `Modal` (Task 14); style constants (Task 12).
- Produces: `ExperimentsTab` accepting `PromptsTabProps`.

- [ ] **Step 1: Implement the tab**

`apps/web/src/views/prompts/ExperimentsTab.tsx`:

```tsx
import type { ExperimentResult } from "@holonet/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createExperiment,
  experimentQueryOptions,
  experimentsQueryOptions,
  promptQueryOptions,
  promptsQueryOptions,
  setResultWinner,
} from "../../api/client.js";
import { errorMessage } from "../../lib/errors.js";
import { AMBER, BAD, CHAKRA, DIM, HI, OK } from "../../lib/theme.js";
import { Modal } from "./Modal.js";
import {
  fieldLabel,
  ghostButton,
  inputStyle,
  primaryButton,
} from "./NewPromptForm.js";
import type { PromptsTabProps } from "./PromptsView.js";

const MONO = "'JetBrains Mono', monospace";

function statusColor(status: string): string {
  if (status === "ok" || status === "done") return OK;
  if (status === "fail" || status === "failed") return BAD;
  return AMBER;
}

export function ExperimentsTab({ models, pushToast }: PromptsTabProps) {
  const queryClient = useQueryClient();
  const experimentsQuery = useQuery(experimentsQueryOptions);
  const experiments = experimentsQuery.data ?? [];

  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "14px" }}>
        <button type="button" style={primaryButton} onClick={() => setComposing(true)}>
          + NEW EXPERIMENT
        </button>
      </div>

      {experiments.length === 0 ? (
        <div style={{ color: DIM, fontSize: "12px", letterSpacing: ".1em", padding: "30px 0" }}>
          NO EXPERIMENTS YET.
        </div>
      ) : (
        experiments.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setOpenId(e.id)}
            style={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              gap: "14px",
              alignItems: "center",
              textAlign: "left",
              padding: "12px 14px",
              marginBottom: "6px",
              cursor: "pointer",
              border: "1px solid rgba(140,160,190,.16)",
              background: "rgba(9,11,16,.55)",
              color: HI,
            }}
          >
            <span style={{ fontFamily: CHAKRA, fontWeight: 600, fontSize: "13px", letterSpacing: ".08em" }}>
              {e.promptName}
            </span>
            <span style={{ fontSize: "10px", letterSpacing: ".14em", color: statusColor(e.status) }}>
              {e.status.toUpperCase()}
            </span>
            <span style={{ fontSize: "10px", color: DIM }}>
              {e.okCount}/{e.totalCount} OK
            </span>
            <span style={{ fontSize: "10px", color: DIM }}>
              {new Date(e.createdAt).toLocaleString()}
            </span>
          </button>
        ))
      )}

      {composing && (
        <NewExperimentModal
          models={models}
          pushToast={pushToast}
          onClose={() => setComposing(false)}
          onCreated={(id) => {
            setComposing(false);
            setOpenId(id);
            queryClient.invalidateQueries({ queryKey: ["experiments"] });
          }}
        />
      )}
      {openId && (
        <ExperimentDetailModal
          experimentId={openId}
          pushToast={pushToast}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function NewExperimentModal({
  models,
  pushToast,
  onClose,
  onCreated,
}: {
  models: PromptsTabProps["models"];
  pushToast: (message: string) => void;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const promptsQuery = useQuery(promptsQueryOptions);
  const prompts = promptsQuery.data ?? [];
  const [promptId, setPromptId] = useState<string>("");
  const detailQuery = useQuery({
    ...promptQueryOptions(promptId),
    enabled: promptId !== "",
  });
  const versions = detailQuery.data?.versions ?? [];
  const [versionIds, setVersionIds] = useState<string[]>([]);
  const [modelIds, setModelIds] = useState<string[]>([]);

  const createMutation = useMutation({
    mutationFn: () => createExperiment({ promptId, versionIds, modelIds }),
    onSuccess: (created) => onCreated(created.id),
    onError: (error) => pushToast(errorMessage(error)),
  });

  function toggle(list: string[], set: (v: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  const checkboxRow = (
    checked: boolean,
    onToggle: () => void,
    label: string,
    hint: string,
  ) => (
    <button
      key={label + hint}
      type="button"
      onClick={onToggle}
      style={{
        display: "flex",
        gap: "10px",
        alignItems: "baseline",
        width: "100%",
        textAlign: "left",
        padding: "7px 10px",
        cursor: "pointer",
        border: `1px solid ${checked ? "rgba(255,179,71,.45)" : "rgba(140,160,190,.18)"}`,
        background: checked ? "rgba(255,179,71,.09)" : "transparent",
        color: checked ? HI : DIM,
        marginBottom: "4px",
      }}
    >
      <span style={{ color: checked ? AMBER : DIM, fontFamily: MONO, fontSize: "11px" }}>
        {checked ? "[x]" : "[ ]"}
      </span>
      <span style={{ fontSize: "12px", letterSpacing: ".06em" }}>{label}</span>
      <span style={{ fontSize: "10px", color: DIM, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {hint}
      </span>
    </button>
  );

  const canStart =
    promptId !== "" && versionIds.length > 0 && modelIds.length > 0;

  return (
    <Modal title="NEW EXPERIMENT" onClose={onClose}>
      <div style={{ display: "grid", gap: "16px" }}>
        <div>
          <div style={fieldLabel}>PROMPT</div>
          <select
            style={inputStyle}
            value={promptId}
            onChange={(e) => {
              setPromptId(e.target.value);
              setVersionIds([]);
            }}
          >
            <option value="">— SELECT —</option>
            {prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {promptId !== "" && (
          <div>
            <div style={fieldLabel}>VERSIONS (MAX 10)</div>
            {versions.map((v) =>
              checkboxRow(
                versionIds.includes(v.id),
                () => toggle(versionIds, setVersionIds, v.id),
                `v${v.version}${v.note ? ` · ${v.note}` : ""}`,
                v.content.slice(0, 80),
              ),
            )}
          </div>
        )}

        <div>
          <div style={fieldLabel}>MODELS (MAX 10)</div>
          {models.map((m) =>
            checkboxRow(
              modelIds.includes(m.modelId),
              () => toggle(modelIds, setModelIds, m.modelId),
              m.label,
              m.modelId,
            ),
          )}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            style={{ ...primaryButton, opacity: canStart ? 1 : 0.45 }}
            disabled={!canStart || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending
              ? "STARTING…"
              : `START · ${versionIds.length}×${modelIds.length} CELLS`}
          </button>
          <button type="button" style={ghostButton} onClick={onClose}>
            CANCEL
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ExperimentDetailModal({
  experimentId,
  pushToast,
  onClose,
}: {
  experimentId: string;
  pushToast: (message: string) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery(experimentQueryOptions(experimentId));
  const detail = detailQuery.data;
  const [cell, setCell] = useState<ExperimentResult | null>(null);

  const winnerMutation = useMutation({
    mutationFn: ({ id, winner }: { id: string; winner: boolean }) =>
      setResultWinner(experimentId, id, winner),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experiment", experimentId] });
      queryClient.invalidateQueries({ queryKey: ["experiments"] });
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  if (!detail) return null;

  const versionNumbers = [...new Set(detail.results.map((r) => r.versionNumber))].sort(
    (a, b) => a - b,
  );
  const modelIds = [...new Set(detail.results.map((r) => r.modelId))].sort();
  const byKey = new Map(
    detail.results.map((r) => [`${r.versionNumber}|${r.modelId}`, r]),
  );

  return (
    <Modal
      title={`EXPERIMENT · ${detail.promptName} · ${detail.status.toUpperCase()}`}
      onClose={onClose}
    >
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...fieldLabel, textAlign: "left", padding: "6px" }}> </th>
              {modelIds.map((m) => (
                <th key={m} style={{ ...fieldLabel, textAlign: "left", padding: "6px" }}>
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {versionNumbers.map((v) => (
              <tr key={v}>
                <td style={{ color: AMBER, fontFamily: MONO, fontSize: "11px", padding: "6px", verticalAlign: "top" }}>
                  v{v}
                </td>
                {modelIds.map((m) => {
                  const r = byKey.get(`${v}|${m}`);
                  if (!r) return <td key={m} />;
                  return (
                    <td key={m} style={{ padding: "4px", verticalAlign: "top" }}>
                      <div
                        style={{
                          border: `1px solid ${r.winner ? "rgba(255,179,71,.6)" : "rgba(140,160,190,.18)"}`,
                          background: "rgba(9,11,16,.55)",
                          padding: "8px",
                          minWidth: "150px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                          <span
                            style={{
                              fontSize: "9px",
                              letterSpacing: ".14em",
                              color: statusColor(r.status),
                              animation: r.status === "pending" ? "pulse 1.6s ease-in-out infinite" : undefined,
                            }}
                          >
                            {r.status.toUpperCase()}
                          </span>
                          {r.status === "ok" && (
                            <button
                              type="button"
                              title="Mark winner"
                              onClick={() =>
                                winnerMutation.mutate({ id: r.id, winner: !r.winner })
                              }
                              style={{
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                color: r.winner ? AMBER : DIM,
                                fontSize: "12px",
                                padding: 0,
                              }}
                            >
                              ★
                            </button>
                          )}
                        </div>
                        {r.status === "ok" && (
                          <button
                            type="button"
                            onClick={() => setCell(r)}
                            style={{
                              display: "block",
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              cursor: "pointer",
                              color: HI,
                              fontFamily: MONO,
                              fontSize: "10px",
                              lineHeight: 1.5,
                              padding: 0,
                            }}
                          >
                            {r.output.slice(0, 120)}…
                          </button>
                        )}
                        {r.status === "fail" && (
                          <div style={{ color: BAD, fontSize: "10px", lineHeight: 1.5 }}>
                            {r.errorMessage}
                          </div>
                        )}
                        <div style={{ marginTop: "6px", fontSize: "8.5px", letterSpacing: ".08em", color: DIM }}>
                          {r.durationMs > 0 && `${r.durationMs}ms`}
                          {r.tokensIn != null && ` · ${r.tokensIn}/${r.tokensOut ?? 0} tok`}
                          {r.costUsd != null && ` · $${r.costUsd}`}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cell && (
        <div style={{ marginTop: "14px" }}>
          <div style={fieldLabel}>
            OUTPUT · v{cell.versionNumber} · {cell.modelId}
          </div>
          <pre
            style={{
              fontFamily: MONO,
              fontSize: "11.5px",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              padding: "12px",
              maxHeight: "40vh",
              overflow: "auto",
              border: "1px solid rgba(140,160,190,.18)",
              background: "rgba(9,11,16,.6)",
              color: HI,
              margin: 0,
            }}
          >
            {cell.output}
          </pre>
        </div>
      )}
    </Modal>
  );
}
```

Note the polling comes from `experimentQueryOptions` (Task 11): 5 s while `status === "running"`, off afterwards. No extra code needed here.

- [ ] **Step 2: Verify and commit**

```bash
pnpm typecheck && pnpm check && pnpm --filter @holonet/web build
git add apps/web/src/views/prompts/ExperimentsTab.tsx
git commit -m "feat(web): experiments tab with live version-by-model grid"
```

---

### Task 16: Schemas tab — list, recursive field editor, live preview, test panel

**Files:**
- Rewrite: `apps/web/src/views/prompts/SchemasTab.tsx`
- Create: `apps/web/src/views/prompts/FieldEditor.tsx`

**Interfaces:**
- Consumes: `schemasQueryOptions`, `createSchema`, `updateSchema`, `deleteSchema`, `playgroundRun` (Task 11); `fieldsToJsonSchema`, `SchemaField`, `SchemaFieldType` from shared (Tasks 1–2); `Modal`, style constants.
- Produces: `SchemasTab` accepting `PromptsTabProps`; `FieldEditor` with props `{ field: SchemaField; onChange: (f: SchemaField) => void; onRemove: () => void; depth: number }`.

- [ ] **Step 1: Recursive field editor**

`apps/web/src/views/prompts/FieldEditor.tsx`:

```tsx
import type { SchemaField, SchemaFieldType } from "@holonet/shared";
import { BAD, DIM } from "../../lib/theme.js";
import { ghostButton, inputStyle } from "./NewPromptForm.js";

const TYPES: SchemaFieldType[] = [
  "string",
  "number",
  "boolean",
  "enum",
  "object",
  "array",
];

export function newField(name = ""): SchemaField {
  return { name, type: "string", required: true };
}

interface FieldEditorProps {
  field: SchemaField;
  onChange: (field: SchemaField) => void;
  onRemove: () => void;
  depth: number;
}

export function FieldEditor({ field, onChange, onRemove, depth }: FieldEditorProps) {
  const isItem = field.name === "item" && depth > 0 && onRemoveIsNoop(onRemove);
  return (
    <div
      style={{
        borderLeft: depth > 0 ? "1px solid rgba(140,160,190,.2)" : "none",
        paddingLeft: depth > 0 ? "14px" : 0,
        marginBottom: "8px",
      }}
    >
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        {!isItem && (
          <input
            style={{ ...inputStyle, width: "150px" }}
            placeholder="field_name"
            value={field.name}
            onChange={(e) => onChange({ ...field, name: e.target.value })}
          />
        )}
        <select
          style={{ ...inputStyle, width: "100px" }}
          value={field.type}
          onChange={(e) => {
            const type = e.target.value as SchemaFieldType;
            const next: SchemaField = { ...field, type };
            if (type === "object" && !next.children) next.children = [];
            if (type === "array" && !next.items) next.items = { ...newField("item") };
            onChange(next);
          }}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {!isItem && (
          <button
            type="button"
            title="Toggle required"
            style={{
              ...ghostButton,
              padding: "6px 10px",
              fontSize: "9px",
              color: field.required ? undefined : DIM,
              opacity: field.required ? 1 : 0.6,
            }}
            onClick={() => onChange({ ...field, required: !field.required })}
          >
            {field.required ? "REQ" : "OPT"}
          </button>
        )}
        <input
          style={{ ...inputStyle, flex: 1 }}
          placeholder="description (optional)"
          value={field.description ?? ""}
          onChange={(e) =>
            onChange({
              ...field,
              description: e.target.value === "" ? undefined : e.target.value,
            })
          }
        />
        {!isItem && (
          <button
            type="button"
            title="Remove field"
            style={{ ...ghostButton, padding: "6px 10px", color: BAD, borderColor: "rgba(255,93,108,.35)" }}
            onClick={onRemove}
          >
            ×
          </button>
        )}
      </div>

      {field.type === "enum" && (
        <input
          style={{ ...inputStyle, marginTop: "6px" }}
          placeholder="enum values, comma-separated"
          value={(field.enumValues ?? []).join(", ")}
          onChange={(e) =>
            onChange({
              ...field,
              enumValues: e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter((v) => v !== ""),
            })
          }
        />
      )}

      {field.type === "object" && (
        <div style={{ marginTop: "8px" }}>
          {(field.children ?? []).map((child, i) => (
            <FieldEditor
              key={`${i}-${child.name}`}
              field={child}
              depth={depth + 1}
              onChange={(next) => {
                const children = [...(field.children ?? [])];
                children[i] = next;
                onChange({ ...field, children });
              }}
              onRemove={() =>
                onChange({
                  ...field,
                  children: (field.children ?? []).filter((_, j) => j !== i),
                })
              }
            />
          ))}
          <button
            type="button"
            style={{ ...ghostButton, padding: "4px 10px", fontSize: "9px" }}
            onClick={() =>
              onChange({ ...field, children: [...(field.children ?? []), newField()] })
            }
          >
            + FIELD
          </button>
        </div>
      )}

      {field.type === "array" && field.items && (
        <div style={{ marginTop: "8px" }}>
          <div style={{ fontSize: "8.5px", letterSpacing: ".2em", color: DIM, marginBottom: "4px" }}>
            ITEM TYPE
          </div>
          <FieldEditor
            field={field.items}
            depth={depth + 1}
            onChange={(items) => onChange({ ...field, items })}
            onRemove={() => {}}
          />
        </div>
      )}
    </div>
  );
}

// Array item editors get a no-op remove; detect it to hide name/req/remove
// controls for the synthetic "item" field.
function onRemoveIsNoop(fn: () => void): boolean {
  return fn.toString().replace(/\s/g, "") === "()=>{}";
}
```

**Simplification note for the implementer:** `onRemoveIsNoop` is fragile — replace it with an explicit `isArrayItem?: boolean` prop on `FieldEditor` (pass `true` from the array branch, hide name/REQ/remove controls when set). The prop version is the required implementation; the function above shows intent only.

- [ ] **Step 2: Schemas tab**

`apps/web/src/views/prompts/SchemasTab.tsx`:

```tsx
import type { SchemaDoc, SchemaField } from "@holonet/shared";
import { fieldsToJsonSchema } from "@holonet/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createSchema,
  deleteSchema,
  schemasQueryOptions,
  updateSchema,
} from "../../api/client.js";
import { errorMessage } from "../../lib/errors.js";
import { AMBER, BAD, CHAKRA, DIM, HI } from "../../lib/theme.js";
import { FieldEditor, newField } from "./FieldEditor.js";
import {
  fieldLabel,
  ghostButton,
  inputStyle,
  primaryButton,
} from "./NewPromptForm.js";
import type { PromptsTabProps } from "./PromptsView.js";
import { TestRunModal } from "./TestRunModal.js";

const MONO = "'JetBrains Mono', monospace";

type EditorState =
  | { mode: "new"; name: string; fields: SchemaField[] }
  | { mode: "edit"; id: string; name: string; fields: SchemaField[]; saved: SchemaDoc };

export function SchemasTab({ models, pushToast }: PromptsTabProps) {
  const queryClient = useQueryClient();
  const schemasQuery = useQuery(schemasQueryOptions);
  const schemas = schemasQuery.data ?? [];

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [testPrompt, setTestPrompt] = useState("");
  const [testing, setTesting] = useState<{ content: string; schemaId: string } | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["schemas"] });
    queryClient.invalidateQueries({ queryKey: ["prompts"] });
  }

  const saveMutation = useMutation({
    mutationFn: (state: EditorState) =>
      state.mode === "new"
        ? createSchema({ name: state.name, fields: state.fields })
        : updateSchema(state.id, { name: state.name, fields: state.fields }),
    onSuccess: (doc) => {
      invalidate();
      setEditor({
        mode: "edit",
        id: doc.id,
        name: doc.name,
        fields: doc.fields,
        saved: doc,
      });
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSchema(id),
    onSuccess: () => {
      invalidate();
      setEditor(null);
    },
    onError: (error) => pushToast(errorMessage(error)),
  });

  const dirty =
    editor?.mode === "edit" &&
    (editor.name !== editor.saved.name ||
      JSON.stringify(editor.fields) !== JSON.stringify(editor.saved.fields));

  if (editor) {
    const canSave = editor.name.trim() !== "" && editor.fields.length > 0;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "20px" }}>
        <div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "14px", alignItems: "end" }}>
            <div style={{ flex: 1 }}>
              <div style={fieldLabel}>SCHEMA NAME</div>
              <input
                style={{ ...inputStyle, fontFamily: CHAKRA, fontSize: "14px" }}
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              />
            </div>
            <button
              type="button"
              style={{ ...primaryButton, opacity: canSave ? 1 : 0.45 }}
              disabled={!canSave || saveMutation.isPending}
              onClick={() => saveMutation.mutate(editor)}
            >
              {saveMutation.isPending ? "SAVING…" : "SAVE"}
            </button>
            <button type="button" style={ghostButton} onClick={() => setEditor(null)}>
              BACK
            </button>
          </div>

          <div style={fieldLabel}>FIELDS</div>
          {editor.fields.map((field, i) => (
            <FieldEditor
              key={`${i}-${field.name}`}
              field={field}
              depth={0}
              onChange={(next) => {
                const fields = [...editor.fields];
                fields[i] = next;
                setEditor({ ...editor, fields });
              }}
              onRemove={() =>
                setEditor({
                  ...editor,
                  fields: editor.fields.filter((_, j) => j !== i),
                })
              }
            />
          ))}
          <button
            type="button"
            style={{ ...ghostButton, marginTop: "4px" }}
            onClick={() => setEditor({ ...editor, fields: [...editor.fields, newField()] })}
          >
            + ADD FIELD
          </button>

          {editor.mode === "edit" && (
            <div style={{ marginTop: "26px" }}>
              <div style={fieldLabel}>
                TEST AGAINST A MODEL {dirty ? "· SAVE FIRST" : ""}
              </div>
              <textarea
                style={{ ...inputStyle, fontFamily: MONO, minHeight: "90px", resize: "vertical" }}
                placeholder="Prompt to run with this schema enforced…"
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
              />
              <button
                type="button"
                style={{
                  ...primaryButton,
                  marginTop: "8px",
                  opacity: !dirty && testPrompt.trim() !== "" ? 1 : 0.45,
                }}
                disabled={Boolean(dirty) || testPrompt.trim() === ""}
                onClick={() =>
                  setTesting({ content: testPrompt, schemaId: editor.id })
                }
              >
                TEST RUN
              </button>
            </div>
          )}
        </div>

        {/* Live preview */}
        <div>
          <div style={fieldLabel}>JSON SCHEMA · LIVE</div>
          <pre
            style={{
              fontFamily: MONO,
              fontSize: "10.5px",
              lineHeight: 1.55,
              padding: "12px",
              overflow: "auto",
              maxHeight: "70vh",
              border: "1px solid rgba(140,160,190,.18)",
              background: "rgba(9,11,16,.6)",
              color: HI,
              margin: 0,
            }}
          >
            {JSON.stringify(fieldsToJsonSchema(editor.fields), null, 2)}
          </pre>
          <button
            type="button"
            style={{ ...ghostButton, marginTop: "8px" }}
            onClick={() => {
              navigator.clipboard
                .writeText(JSON.stringify(fieldsToJsonSchema(editor.fields), null, 2))
                .then(() => pushToast("SCHEMA COPIED"))
                .catch(() => pushToast("COPY FAILED"));
            }}
          >
            COPY
          </button>
        </div>

        {testing && (
          <TestRunModal
            content={testing.content}
            schemaId={testing.schemaId}
            models={models}
            onClose={() => setTesting(null)}
            pushToast={pushToast}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "14px" }}>
        <button
          type="button"
          style={primaryButton}
          onClick={() => setEditor({ mode: "new", name: "", fields: [newField()] })}
        >
          + NEW SCHEMA
        </button>
      </div>
      {schemas.length === 0 ? (
        <div style={{ color: DIM, fontSize: "12px", letterSpacing: ".1em", padding: "30px 0" }}>
          NO SCHEMAS YET.
        </div>
      ) : (
        schemas.map((s) => (
          <div
            key={s.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              gap: "14px",
              alignItems: "center",
              padding: "12px 14px",
              marginBottom: "6px",
              border: "1px solid rgba(140,160,190,.16)",
              background: "rgba(9,11,16,.55)",
            }}
          >
            <button
              type="button"
              onClick={() =>
                setEditor({
                  mode: "edit",
                  id: s.id,
                  name: s.name,
                  fields: s.fields,
                  saved: s,
                })
              }
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
                color: HI,
                fontFamily: CHAKRA,
                fontWeight: 600,
                fontSize: "13px",
                letterSpacing: ".08em",
                padding: 0,
              }}
            >
              {s.name}
            </button>
            <span style={{ fontSize: "10px", color: DIM }}>{s.fields.length} FIELDS</span>
            <span style={{ fontSize: "10px", color: s.attachedTo > 0 ? AMBER : DIM }}>
              {s.attachedTo} ATTACHED
            </span>
            <button
              type="button"
              style={{ ...ghostButton, padding: "4px 10px", color: BAD, borderColor: "rgba(255,93,108,.35)" }}
              onClick={() => deleteMutation.mutate(s.id)}
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

```bash
pnpm typecheck && pnpm check && pnpm --filter @holonet/web build
git add apps/web/src/views/prompts
git commit -m "feat(web): schema builder with live JSON-schema preview and test panel"
```

---

### Task 17: SPEC.md update + full verification

**Files:**
- Modify: `docs/SPEC.md`

- [ ] **Step 1: Document the module in the architecture contract**

Add a `## Prompt engineering module` section to `docs/SPEC.md` (place it after the existing feature sections, matching the document's heading style) covering exactly:

- Tables: `prompt_folders`, `prompts` (FK `set null` to folders/schemas), `prompt_versions` (immutable, unique `(prompt_id, version)`, cascade), `experiments` (+ denormalized `prompt_name`), `experiment_results` (plain-uuid `version_id`, denormalized `version_number`), `schemas` (Drizzle export `outputSchemas`; `fields` jsonb is the source of truth — JSON Schema is always derived via `fieldsToJsonSchema`).
- Routes: `/api/folders`, `/api/prompts` (+ `/:id/versions`, `/:id/optimize`), `/api/schemas`, `/api/playground/run`, `/api/experiments` (+ `PATCH /:id/results/:rid`), all behind `authMiddleware`.
- Runner semantics: in-process, concurrency 3, per-cell failures don't fail the experiment (`done` with partial `fail` cells), `failed` status is reserved for boot recovery (`recoverInterruptedExperiments` at startup).
- OpenRouter path: `chatCompleteDetailed` (usage accounting + optional strict `json_schema` response format); single `user` message; the web plugin is never used on this path.
- Shared contract: `fieldsToJsonSchema` / `validateFields` / `lineDiff` in `@holonet/shared`.
- UI: sixth Rail view `PROMPTS` with Library / Experiments / Schemas tabs; experiment detail polls every 5 s while running.

- [ ] **Step 2: Run the full verification suite**

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm build
```

Expected: all four green. If anything fails, fix before committing — do not claim done otherwise.

- [ ] **Step 3: Commit**

```bash
git add docs/SPEC.md
git commit -m "docs: SPEC section for the prompt-engineering module"
```

---

## Plan self-review notes (already applied)

- **Spec coverage:** folders/tags/versioning → Tasks 1/3/5/7/12/13; optimizer → 8/14; A/B → 10/15; schema builder → 1/2/6/9/16; boot recovery → 10; SPEC.md → 17. Restore-as-new-version is client-side (Task 13 RESTORE button) per spec.
- **Known intentional choices:** prompt list filtering happens in-process on the server (single-user scale, still satisfies the query-param contract and is tested); `FieldEditor` must use the `isArrayItem` prop variant, not the `fn.toString()` sketch; the experiment POST response returns `results: []` (grid populates on first poll).
- **Type consistency spot-checks:** `CompleteFn` return `ChatCompletionDetails { content, tokensIn, tokensOut, costUsd }` used identically in Tasks 4/10 and test fakes; `PromptsTabProps` shared by all three tabs; `costUsd` is a string everywhere (numeric string from OpenRouter `usage.cost`).


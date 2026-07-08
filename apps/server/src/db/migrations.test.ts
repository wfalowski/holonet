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
  assert.deepEqual(rows.map((r) => r.modelId).sort(), [
    "anthropic/claude-opus-4.1",
    "anthropic/claude-sonnet-4.5",
    "x-ai/grok-3",
    "x-ai/grok-4",
  ]);
  for (const row of rows) {
    assert.ok(row.id);
    assert.ok(row.label.length > 0);
    assert.ok(row.family.length > 0);
    assert.ok(row.createdAt instanceof Date);
  }
});

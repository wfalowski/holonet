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

const config = loadConfig({
  APP_KEY: "test-app-key-123456",
  OPENROUTER_API_KEY: "x",
});

async function seedExperiment(db: Awaited<ReturnType<typeof buildDb>>) {
  const now = new Date();
  const [prompt] = await db
    .insert(prompts)
    .values({ name: "P", createdAt: now, updatedAt: now })
    .returning();
  const [version] = await db
    .insert(promptVersions)
    .values({
      promptId: prompt!.id,
      version: 1,
      content: "the prompt",
      createdAt: now,
    })
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

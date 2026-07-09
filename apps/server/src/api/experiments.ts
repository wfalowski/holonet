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
import { rowToExperiment, rowToExperimentResult } from "./promptSerialize.js";

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
    const modelIds = [...new Set(parsed.data.modelIds)];
    const catalog = await db
      .select({ modelId: models.modelId })
      .from(models)
      .where(inArray(models.modelId, modelIds));
    if (catalog.length !== modelIds.length) {
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
          modelIds.map((modelId) => ({
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

    const total = versions.length * modelIds.length;
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
    const row = updated[0];
    if (!row) return c.json(notFound("Result not found"), 404);
    return c.json(rowToExperimentResult(row));
  });

  return app;
}

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
      const message =
        err instanceof Error ? err.message : "OpenRouter fetch failed";
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

import {
  OptimizeInputSchema,
  PromptInputSchema,
  PromptMetaUpdateSchema,
  PromptVersionInputSchema,
} from "@holonet/shared";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import type { PromptRow, PromptVersionRow } from "../db/schema.js";
import {
  models,
  outputSchemas,
  promptFolders,
  prompts,
  promptVersions,
} from "../db/schema.js";
import { chatComplete } from "../services/openrouter.js";
import {
  buildOptimizerMessages,
  parseOptimizerResponse,
} from "../services/optimizer.js";
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
  return new Map(
    rows.map((r) => [r.promptId, { head: r.head, count: r.count }]),
  );
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
        {
          error: {
            code: "INTERNAL" as const,
            message: "Optimizer call failed",
          },
        },
        502,
      );
    }
  });

  return app;
}

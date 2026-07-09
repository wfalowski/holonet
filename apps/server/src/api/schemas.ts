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

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

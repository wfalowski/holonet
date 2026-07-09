import { randomUUID } from "node:crypto";
import { type RunStatus, TaskInputSchema } from "@holonet/shared";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/index.js";
import type { NewTaskRow, TaskRow } from "../db/schema.js";
import { models, runs, tasks } from "../db/schema.js";
import { ConflictError, type Executor } from "../scheduler/executor.js";
import type { Scheduler } from "../scheduler/scheduler.js";
import { type LastRun, rowToRun, rowToTask } from "./serialize.js";

function validationError(message: string) {
  return { error: { code: "VALIDATION" as const, message } };
}

function notFound() {
  return { error: { code: "NOT_FOUND" as const, message: "Task not found" } };
}

async function latestRunFor(db: Db, taskId: string): Promise<LastRun> {
  const rows = await db
    .select({ status: runs.status, at: runs.createdAt })
    .from(runs)
    .where(eq(runs.taskId, taskId))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  const row = rows[0];
  return row ? { at: row.at.getTime(), status: row.status as RunStatus } : null;
}

async function getTask(db: Db, id: string): Promise<TaskRow | undefined> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, id));
  return rows[0];
}

async function modelInCatalog(db: Db, modelId: string): Promise<boolean> {
  const rows = await db
    .select({ id: models.id })
    .from(models)
    .where(eq(models.modelId, modelId));
  return rows.length > 0;
}

export function createTasksRoutes(
  db: Db,
  scheduler: Scheduler,
  executor: Executor,
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const rows = await db.select().from(tasks);

    // Latest run per task in a single grouped query (no N+1). Aliases are
    // quoted so Postgres preserves the camelCase keys used below. The generic
    // Db type erases the concrete driver's result shape, so the raw result is
    // cast to the row shape this query is known to produce.
    //
    // created_at is selected as epoch millis (float8 → JS number): raw
    // db.execute bypasses Drizzle's column mapping, and Drizzle disables the
    // driver's own timestamptz parsing, so selecting the column directly
    // yields a string, not a Date.
    const result =
      (await db.execute(sql`SELECT task_id AS "taskId", status, (EXTRACT(EPOCH FROM created_at) * 1000)::float8 AS "at" FROM (
        SELECT task_id, status, created_at,
          ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY created_at DESC, id DESC) AS rn
        FROM runs WHERE task_id IS NOT NULL
      ) latest WHERE rn = 1`)) as {
        rows: Array<{ taskId: string; status: string; at: number }>;
      };
    const latest = result.rows;

    const lastRunByTask = new Map<string, LastRun>();
    for (const r of latest) {
      lastRunByTask.set(r.taskId, {
        at: r.at,
        status: r.status as RunStatus,
      });
    }

    return c.json(
      rows.map((row) => rowToTask(row, lastRunByTask.get(row.id) ?? null)),
    );
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = TaskInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid task"),
        400,
      );
    }

    if (!(await modelInCatalog(db, parsed.data.model))) {
      return c.json(
        validationError("Unknown model — add it in Settings first"),
        400,
      );
    }

    const id = randomUUID();
    const now = new Date();
    const row: NewTaskRow = {
      id,
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(tasks).values(row);

    const created = (await getTask(db, id)) as TaskRow;
    scheduler.sync(created);
    return c.json(rowToTask(created, null), 201);
  });

  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await getTask(db, id);
    if (!existing) return c.json(notFound(), 404);

    const body = await c.req.json().catch(() => null);
    const parsed = TaskInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid task"),
        400,
      );
    }

    if (!(await modelInCatalog(db, parsed.data.model))) {
      return c.json(
        validationError("Unknown model — add it in Settings first"),
        400,
      );
    }

    await db
      .update(tasks)
      .set({
        ...parsed.data,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id));

    const updated = (await getTask(db, id)) as TaskRow;
    scheduler.sync(updated);
    return c.json(rowToTask(updated, await latestRunFor(db, id)));
  });

  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await getTask(db, id);
    if (!existing) return c.json(notFound(), 404);

    await db.delete(tasks).where(eq(tasks.id, id));
    scheduler.remove(id);
    return c.body(null, 204);
  });

  app.post("/:id/toggle", async (c) => {
    const id = c.req.param("id");
    const existing = await getTask(db, id);
    if (!existing) return c.json(notFound(), 404);

    await db
      .update(tasks)
      .set({ enabled: !existing.enabled, updatedAt: new Date() })
      .where(eq(tasks.id, id));

    const updated = (await getTask(db, id)) as TaskRow;
    scheduler.sync(updated);
    return c.json(rowToTask(updated, await latestRunFor(db, id)));
  });

  app.post("/:id/run", async (c) => {
    const id = c.req.param("id");
    const existing = await getTask(db, id);
    if (!existing) return c.json(notFound(), 404);

    try {
      const run = await executor.execute(existing);
      return c.json(rowToRun(run));
    } catch (err) {
      if (err instanceof ConflictError) {
        return c.json(
          {
            error: { code: "CONFLICT", message: "Task is already running" },
          },
          409,
        );
      }
      throw err;
    }
  });

  return app;
}

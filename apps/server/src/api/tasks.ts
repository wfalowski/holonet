import { randomUUID } from "node:crypto";
import { type RunStatus, TaskInputSchema } from "@holonet/shared";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Db } from "../db/index.js";
import type { NewTaskRow, TaskRow } from "../db/schema.js";
import { runs, tasks } from "../db/schema.js";
import { ConflictError, type Executor } from "../scheduler/executor.js";
import type { Scheduler } from "../scheduler/scheduler.js";
import { type LastRun, rowToRun, rowToTask } from "./serialize.js";

function validationError(message: string) {
  return { error: { code: "VALIDATION" as const, message } };
}

function notFound() {
  return { error: { code: "NOT_FOUND" as const, message: "Task not found" } };
}

function latestRunFor(db: Db, taskId: string): LastRun {
  const row = db
    .select({ status: runs.status, at: runs.createdAt })
    .from(runs)
    .where(eq(runs.taskId, taskId))
    .orderBy(desc(runs.createdAt))
    .limit(1)
    .get();
  return row ? { at: row.at.getTime(), status: row.status as RunStatus } : null;
}

function getTask(db: Db, id: string): TaskRow | undefined {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

export function createTasksRoutes(
  db: Db,
  scheduler: Scheduler,
  executor: Executor,
): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const rows = db.select().from(tasks).all();

    // Latest run per task in a single grouped query (no N+1).
    const latest = db.all(
      sql`SELECT task_id AS taskId, status, created_at AS at FROM (
        SELECT task_id, status, created_at,
          ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY created_at DESC, id DESC) AS rn
        FROM runs WHERE task_id IS NOT NULL
      ) WHERE rn = 1`,
    ) as Array<{ taskId: string; status: string; at: number }>;

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

    const now = new Date();
    const row: NewTaskRow = {
      id: randomUUID(),
      ...parsed.data,
      sources: JSON.stringify(parsed.data.sources),
      createdAt: now,
      updatedAt: now,
    };
    db.insert(tasks).values(row).run();

    const created = getTask(db, row.id) as TaskRow;
    scheduler.sync(created);
    return c.json(rowToTask(created, null), 201);
  });

  app.put("/:id", async (c) => {
    const id = c.req.param("id");
    const existing = getTask(db, id);
    if (!existing) return c.json(notFound(), 404);

    const body = await c.req.json().catch(() => null);
    const parsed = TaskInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid task"),
        400,
      );
    }

    db.update(tasks)
      .set({
        ...parsed.data,
        sources: JSON.stringify(parsed.data.sources),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .run();

    const updated = getTask(db, id) as TaskRow;
    scheduler.sync(updated);
    return c.json(rowToTask(updated, latestRunFor(db, id)));
  });

  app.delete("/:id", (c) => {
    const id = c.req.param("id");
    const existing = getTask(db, id);
    if (!existing) return c.json(notFound(), 404);

    db.delete(tasks).where(eq(tasks.id, id)).run();
    scheduler.remove(id);
    return c.body(null, 204);
  });

  app.post("/:id/toggle", (c) => {
    const id = c.req.param("id");
    const existing = getTask(db, id);
    if (!existing) return c.json(notFound(), 404);

    db.update(tasks)
      .set({ enabled: !existing.enabled, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .run();

    const updated = getTask(db, id) as TaskRow;
    scheduler.sync(updated);
    return c.json(rowToTask(updated, latestRunFor(db, id)));
  });

  app.post("/:id/run", async (c) => {
    const id = c.req.param("id");
    const existing = getTask(db, id);
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

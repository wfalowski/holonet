import { Cron } from "croner";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db } from "../db/index.js";
import type { TaskRow } from "../db/schema.js";
import { tasks } from "../db/schema.js";
import { ConflictError, type Executor } from "./executor.js";

export interface Scheduler {
  start(): Promise<void>;
  sync(task: TaskRow): void;
  remove(taskId: string): void;
  stop(): void;
}

export interface SchedulerDeps {
  db: Db;
  executor: Executor;
  logger: Logger;
}

// In-process croner registry. `protect: true` prevents overlapping runs of the
// same job; `catch: false` lets us handle callback errors ourselves. Missed-run
// catch-up is intentionally disabled — schedules restart from now on boot.
export function createScheduler({
  db,
  executor,
  logger,
}: SchedulerDeps): Scheduler {
  const jobs = new Map<string, Cron>();

  function remove(taskId: string): void {
    const job = jobs.get(taskId);
    if (job) {
      job.stop();
      jobs.delete(taskId);
    }
  }

  function schedule(task: TaskRow): void {
    remove(task.id);
    const job = new Cron(task.cron, { protect: true, catch: false }, () => {
      return executor
        .execute(task)
        .catch((err) => {
          if (err instanceof ConflictError) {
            logger.debug({ taskId: task.id }, "run skipped, already in flight");
            return;
          }
          logger.error({ taskId: task.id, err }, "scheduled run failed");
        })
        .then(() => {});
    });
    jobs.set(task.id, job);
  }

  return {
    async start(): Promise<void> {
      const rows = db.select().from(tasks).where(eq(tasks.enabled, true)).all();
      for (const task of rows) schedule(task);
      logger.info({ count: rows.length }, "scheduler started");
    },

    sync(task: TaskRow): void {
      if (task.enabled) schedule(task);
      else remove(task.id);
    },

    remove,

    stop(): void {
      for (const job of jobs.values()) job.stop();
      jobs.clear();
    },
  };
}

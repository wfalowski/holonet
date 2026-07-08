import {
  type ModelId,
  nextRun,
  type Run,
  type RunStatus,
  type Task,
  type TaskFormat,
} from "@holonet/shared";
import type { RunRow, TaskRow } from "../db/schema.js";

export type LastRun = { at: number; status: RunStatus } | null;

// Map a task DB row to the API Task shape: expose timestamps as epoch ms and
// attach the computed nextRunAt / lastRun.
export function rowToTask(row: TaskRow, lastRun: LastRun): Task {
  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    prompt: row.prompt,
    model: row.model as ModelId,
    webSearch: row.webSearch,
    enabled: row.enabled,
    webhookUrl: row.webhookUrl,
    channel: row.channel,
    dedupe: row.dedupe,
    format: row.format as TaskFormat,
    sources: row.sources,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    nextRunAt: row.enabled ? nextRun(row.cron) : null,
    lastRun,
  };
}

export function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    taskId: row.taskId,
    taskName: row.taskName,
    channel: row.channel,
    status: row.status as RunStatus,
    message: row.message,
    durationMs: row.durationMs,
    createdAt: row.createdAt.getTime(),
  };
}

import {
  type Model,
  nextRun,
  type Run,
  type RunStatus,
  type Task,
  type TaskFormat,
} from "@holonet/shared";
import type { ModelRow, RunRow, TaskRow } from "../db/schema.js";

export type LastRun = { at: number; status: RunStatus } | null;

// Map a task DB row to the API Task shape: expose timestamps as epoch ms and
// attach the computed nextRunAt / lastRun.
export function rowToTask(row: TaskRow, lastRun: LastRun): Task {
  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    prompt: row.prompt,
    model: row.model,
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

export function rowToModel(row: ModelRow, inUse: number): Model {
  return {
    id: row.id,
    modelId: row.modelId,
    label: row.label,
    family: row.family,
    inputCostPerMTok: row.inputCostPerMTok,
    outputCostPerMTok: row.outputCostPerMTok,
    createdAt: row.createdAt.getTime(),
    inUse,
  };
}

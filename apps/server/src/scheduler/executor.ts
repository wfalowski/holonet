import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import type { RunRow, TaskRow } from "../db/schema.js";
import { runs } from "../db/schema.js";
import { postWebhook } from "../services/discord.js";
import { chatComplete } from "../services/openrouter.js";

// Raised when a run for the same task is already in flight. The API maps this to
// 409 CONFLICT; the scheduler catches and logs it.
export class ConflictError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} is already running`);
    this.name = "ConflictError";
  }
}

export interface Executor {
  execute(task: TaskRow): Promise<RunRow>;
}

export interface ExecutorDeps {
  db: Db;
  config: Config;
  logger: Logger;
}

const FORMAT_GUIDANCE: Record<string, string> = {
  digest:
    "Write ONE tight digest paragraph that synthesizes the findings, then a short list of the key items, each on its own line with its linked source.",
  bullets:
    "Write a concise bullet list. One item per line, each starting with a dash, each with its cited source link.",
  headlines:
    "Write plain headline lines only. One headline per line, each followed by its source link. No intro, no commentary.",
};

// System prompt encoding the task's output contract. Exported for unit testing.
export function buildSystemPrompt(task: TaskRow): string {
  const lines: string[] = [
    "You are Holonet, an automated news-dispatch agent relaying briefings to a Discord channel.",
    FORMAT_GUIDANCE[task.format] ?? FORMAT_GUIDANCE.digest ?? "",
    "Always cite source links inline so the reader can verify each item.",
    "Format for Discord markdown: use plain links, short lines, and no heading syntax that Discord will not render.",
    "Keep the whole message under about 1800 characters — be selective and drop the weakest items rather than truncating mid-thought.",
  ];

  if (task.dedupe) {
    lines.push(
      "Deduplicate aggressively: collapse stories that cover the same event and never repeat an item you have listed.",
    );
  }

  const sources = task.sources;
  if (sources.length > 0) {
    lines.push(
      `Prioritize these sources when relevant: ${sources.join(", ")}.`,
    );
  }

  return lines.filter((l) => l.length > 0).join("\n");
}

function sanitizeFailure(err: unknown, config: Config): string {
  let msg = err instanceof Error ? err.message : String(err);
  if (config.openrouterApiKey) {
    msg = msg.split(config.openrouterApiKey).join("***");
  }
  // Strip the secret webhook token, keeping only .../webhooks/<id>/***
  msg = msg.replace(
    /(discord(?:app)?\.com\/api\/webhooks\/\d+)\/[^\s/"']+/gi,
    "$1/***",
  );
  return msg.slice(0, 300);
}

export function createExecutor({ db, config, logger }: ExecutorDeps): Executor {
  const inFlight = new Set<string>();

  return {
    async execute(task: TaskRow): Promise<RunRow> {
      if (inFlight.has(task.id)) {
        throw new ConflictError(task.id);
      }
      inFlight.add(task.id);
      const started = Date.now();

      try {
        let status: "ok" | "fail";
        let message: string;
        try {
          const content = await chatComplete({
            apiKey: config.openrouterApiKey,
            model: task.model,
            messages: [
              { role: "system", content: buildSystemPrompt(task) },
              { role: "user", content: task.prompt },
            ],
            webSearch: task.webSearch,
          });
          await postWebhook({
            url: task.webhookUrl,
            title: task.name,
            content,
          });
          status = "ok";
          message = `${task.format} compiled · relayed to #${task.channel}`;
        } catch (err) {
          status = "fail";
          message = sanitizeFailure(err, config);
          logger.error({ taskId: task.id, err }, "task run failed");
        }

        const run: RunRow = {
          id: randomUUID(),
          taskId: task.id,
          taskName: task.name,
          channel: task.channel,
          status,
          message,
          durationMs: Date.now() - started,
          createdAt: new Date(),
        };
        await db.insert(runs).values(run);
        return run;
      } finally {
        inFlight.delete(task.id);
      }
    },
  };
}

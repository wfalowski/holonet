import { and, eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import type { ExperimentResultRow } from "../db/schema.js";
import {
  experimentResults,
  experiments,
  outputSchemas,
  prompts,
  promptVersions,
} from "../db/schema.js";
import {
  type ChatCompleteDetailedOptions,
  type ChatCompletionDetails,
  chatCompleteDetailed,
  type ResponseFormat,
  schemaResponseFormat,
} from "../services/openrouter.js";

export type CompleteFn = (
  options: ChatCompleteDetailedOptions,
) => Promise<ChatCompletionDetails>;

export interface ExperimentRunnerDeps {
  db: Db;
  config: Config;
  logger: Logger;
  complete?: CompleteFn;
}

export interface ExperimentRunner {
  start(experimentId: string): void;
  run(experimentId: string): Promise<void>;
}

const CONCURRENCY = 3;

export function createExperimentRunner({
  db,
  config,
  logger,
  complete = chatCompleteDetailed,
}: ExperimentRunnerDeps): ExperimentRunner {
  async function runCell(
    row: ExperimentResultRow,
    content: string | undefined,
    responseFormat: ResponseFormat | undefined,
  ): Promise<void> {
    const started = Date.now();
    if (content === undefined) {
      await db
        .update(experimentResults)
        .set({
          status: "fail",
          errorMessage: "prompt version no longer exists",
        })
        .where(eq(experimentResults.id, row.id));
      return;
    }
    try {
      const result = await complete({
        apiKey: config.openrouterApiKey,
        model: row.modelId,
        messages: [{ role: "user", content }],
        responseFormat,
      });
      await db
        .update(experimentResults)
        .set({
          status: "ok",
          output: result.content,
          durationMs: Date.now() - started,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: result.costUsd,
        })
        .where(eq(experimentResults.id, row.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(experimentResults)
        .set({
          status: "fail",
          errorMessage: message.slice(0, 300),
          durationMs: Date.now() - started,
        })
        .where(eq(experimentResults.id, row.id));
    }
  }

  async function run(experimentId: string): Promise<void> {
    const experimentRows = await db
      .select()
      .from(experiments)
      .where(eq(experiments.id, experimentId));
    const experiment = experimentRows[0];
    if (!experiment) return;

    const pending = await db
      .select()
      .from(experimentResults)
      .where(
        and(
          eq(experimentResults.experimentId, experimentId),
          eq(experimentResults.status, "pending"),
        ),
      );

    const versionIds = [...new Set(pending.map((r) => r.versionId))];
    const versions =
      versionIds.length > 0
        ? await db
            .select()
            .from(promptVersions)
            .where(inArray(promptVersions.id, versionIds))
        : [];
    const contentByVersion = new Map(versions.map((v) => [v.id, v.content]));

    let responseFormat: ResponseFormat | undefined;
    if (experiment.promptId) {
      const promptRows = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, experiment.promptId));
      const schemaId = promptRows[0]?.schemaId;
      if (schemaId) {
        const schemaRows = await db
          .select()
          .from(outputSchemas)
          .where(eq(outputSchemas.id, schemaId));
        const schemaRow = schemaRows[0];
        if (schemaRow) {
          responseFormat = schemaResponseFormat(
            schemaRow.name,
            schemaRow.fields,
          );
        }
      }
    }

    const queue = [...pending];
    const worker = async (): Promise<void> => {
      for (;;) {
        const row = queue.shift();
        if (!row) return;
        await runCell(row, contentByVersion.get(row.versionId), responseFormat);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
    );

    await db
      .update(experiments)
      .set({ status: "done", finishedAt: new Date() })
      .where(eq(experiments.id, experimentId));
    logger.info({ experimentId }, "experiment finished");
  }

  return {
    run,
    start(experimentId) {
      run(experimentId).catch((err) => {
        logger.error({ err, experimentId }, "experiment run failed");
      });
    },
  };
}

// Boot recovery: a restart mid-experiment leaves status 'running' with no
// process behind it — surface that honestly instead of leaving zombies.
export async function recoverInterruptedExperiments(
  db: Db,
  logger: Logger,
): Promise<void> {
  const stale = await db
    .select({ id: experiments.id })
    .from(experiments)
    .where(eq(experiments.status, "running"));
  if (stale.length === 0) return;
  const ids = stale.map((r) => r.id);
  await db
    .update(experimentResults)
    .set({ status: "fail", errorMessage: "interrupted by restart" })
    .where(
      and(
        inArray(experimentResults.experimentId, ids),
        eq(experimentResults.status, "pending"),
      ),
    );
  await db
    .update(experiments)
    .set({ status: "failed", finishedAt: new Date() })
    .where(inArray(experiments.id, ids));
  logger.warn(
    { count: ids.length },
    "marked interrupted experiments as failed",
  );
}

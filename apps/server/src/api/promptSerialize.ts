import type {
  Experiment,
  ExperimentResult,
  ExperimentStatus,
  Folder,
  Prompt,
  PromptVersion,
  ResultStatus,
  SchemaDoc,
} from "@holonet/shared";
import type {
  ExperimentResultRow,
  ExperimentRow,
  OutputSchemaRow,
  PromptFolderRow,
  PromptRow,
  PromptVersionRow,
} from "../db/schema.js";

export function rowToFolder(row: PromptFolderRow, promptCount: number): Folder {
  return {
    id: row.id,
    name: row.name,
    promptCount,
    createdAt: row.createdAt.getTime(),
  };
}

export function rowToPrompt(
  row: PromptRow,
  headVersion: number,
  versionCount: number,
): Prompt {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folderId,
    tags: row.tags,
    schemaId: row.schemaId,
    headVersion,
    versionCount,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function rowToPromptVersion(row: PromptVersionRow): PromptVersion {
  return {
    id: row.id,
    promptId: row.promptId,
    version: row.version,
    content: row.content,
    note: row.note,
    createdAt: row.createdAt.getTime(),
  };
}

export function rowToExperiment(
  row: ExperimentRow,
  counts: { ok: number; fail: number; total: number },
): Experiment {
  return {
    id: row.id,
    promptId: row.promptId,
    promptName: row.promptName,
    status: row.status as ExperimentStatus,
    okCount: counts.ok,
    failCount: counts.fail,
    totalCount: counts.total,
    createdAt: row.createdAt.getTime(),
    finishedAt: row.finishedAt ? row.finishedAt.getTime() : null,
  };
}

export function rowToExperimentResult(
  row: ExperimentResultRow,
): ExperimentResult {
  return {
    id: row.id,
    experimentId: row.experimentId,
    versionId: row.versionId,
    versionNumber: row.versionNumber,
    modelId: row.modelId,
    status: row.status as ResultStatus,
    output: row.output,
    errorMessage: row.errorMessage,
    durationMs: row.durationMs,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    costUsd: row.costUsd,
    winner: row.winner,
  };
}

export function rowToSchemaDoc(
  row: OutputSchemaRow,
  attachedTo: number,
): SchemaDoc {
  return {
    id: row.id,
    name: row.name,
    fields: row.fields,
    attachedTo,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

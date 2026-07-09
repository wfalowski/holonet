import { z } from "zod";
import { MODEL_ID_RE } from "./schemas.js";

// ---- Folders ----

export const FolderInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
});
export type FolderInput = z.infer<typeof FolderInputSchema>;

export const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  promptCount: z.number(),
  createdAt: z.number(),
});
export type Folder = z.infer<typeof FolderSchema>;

// ---- Structured-output schema fields (recursive) ----

export const SchemaFieldTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "enum",
  "object",
  "array",
]);
export type SchemaFieldType = z.infer<typeof SchemaFieldTypeSchema>;

export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  description?: string;
  required: boolean;
  /** type === "enum" */
  enumValues?: string[];
  /** type === "object" */
  children?: SchemaField[];
  /** type === "array" — item descriptor; its name is unused (builder uses "item") */
  items?: SchemaField;
}

export const SchemaFieldSchema: z.ZodType<SchemaField> = z.lazy(() =>
  z.object({
    name: z.string().trim().min(1).max(40),
    type: SchemaFieldTypeSchema,
    description: z.string().trim().max(200).optional(),
    required: z.boolean(),
    enumValues: z.array(z.string().min(1)).min(1).optional(),
    children: z.array(SchemaFieldSchema).optional(),
    items: SchemaFieldSchema.optional(),
  }),
);

export const SchemaDocInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  fields: z.array(SchemaFieldSchema).min(1).max(40),
});
export type SchemaDocInput = z.infer<typeof SchemaDocInputSchema>;

export const SchemaDocSchema = z.object({
  id: z.string(),
  name: z.string(),
  fields: z.array(SchemaFieldSchema),
  attachedTo: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SchemaDoc = z.infer<typeof SchemaDocSchema>;

// ---- Prompts & versions ----

export const PromptInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  folderId: z.string().uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(24)).max(12).default([]),
  schemaId: z.string().uuid().nullable().default(null),
  content: z.string().min(1),
});
export type PromptInput = z.infer<typeof PromptInputSchema>;

export const PromptMetaUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  folderId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
  schemaId: z.string().uuid().nullable().optional(),
});
export type PromptMetaUpdate = z.infer<typeof PromptMetaUpdateSchema>;

export const PromptSchema = z.object({
  id: z.string(),
  name: z.string(),
  folderId: z.string().nullable(),
  tags: z.array(z.string()),
  schemaId: z.string().nullable(),
  headVersion: z.number(),
  versionCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Prompt = z.infer<typeof PromptSchema>;

export const PromptVersionInputSchema = z.object({
  content: z.string().min(1),
  note: z.string().trim().max(200).optional(),
});
export type PromptVersionInput = z.infer<typeof PromptVersionInputSchema>;

export const PromptVersionSchema = z.object({
  id: z.string(),
  promptId: z.string(),
  version: z.number(),
  content: z.string(),
  note: z.string().nullable(),
  createdAt: z.number(),
});
export type PromptVersion = z.infer<typeof PromptVersionSchema>;

export const PromptDetailSchema = PromptSchema.extend({
  versions: z.array(PromptVersionSchema),
});
export type PromptDetail = z.infer<typeof PromptDetailSchema>;

// ---- Optimizer ----

export const OptimizeInputSchema = z.object({
  versionId: z.string().uuid(),
  targetModelId: z.string().regex(MODEL_ID_RE),
  optimizerModelId: z.string().regex(MODEL_ID_RE),
});
export type OptimizeInput = z.infer<typeof OptimizeInputSchema>;

export const OptimizeOutputSchema = z.object({
  improved: z.string(),
  rationale: z.string(),
});
export type OptimizeOutput = z.infer<typeof OptimizeOutputSchema>;

// ---- Experiments ----

export const ExperimentStatus = z.enum(["running", "done", "failed"]);
export type ExperimentStatus = z.infer<typeof ExperimentStatus>;

export const ResultStatus = z.enum(["pending", "ok", "fail"]);
export type ResultStatus = z.infer<typeof ResultStatus>;

export const ExperimentInputSchema = z.object({
  promptId: z.string().uuid(),
  versionIds: z.array(z.string().uuid()).min(1).max(10),
  modelIds: z.array(z.string().regex(MODEL_ID_RE)).min(1).max(10),
});
export type ExperimentInput = z.infer<typeof ExperimentInputSchema>;

export const ExperimentResultSchema = z.object({
  id: z.string(),
  experimentId: z.string(),
  versionId: z.string(),
  versionNumber: z.number(),
  modelId: z.string(),
  status: ResultStatus,
  output: z.string(),
  errorMessage: z.string().nullable(),
  durationMs: z.number(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
  costUsd: z.string().nullable(),
  winner: z.boolean(),
});
export type ExperimentResult = z.infer<typeof ExperimentResultSchema>;

export const ExperimentSchema = z.object({
  id: z.string(),
  promptId: z.string().nullable(),
  promptName: z.string(),
  status: ExperimentStatus,
  okCount: z.number(),
  failCount: z.number(),
  totalCount: z.number(),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

export const ExperimentDetailSchema = ExperimentSchema.extend({
  results: z.array(ExperimentResultSchema),
});
export type ExperimentDetail = z.infer<typeof ExperimentDetailSchema>;

// ---- Playground ----

export const PlaygroundRunInputSchema = z.object({
  content: z.string().min(1),
  modelId: z.string().regex(MODEL_ID_RE),
  schemaId: z.string().uuid().nullable().default(null),
});
export type PlaygroundRunInput = z.infer<typeof PlaygroundRunInputSchema>;

export const PlaygroundRunOutputSchema = z.object({
  output: z.string(),
  durationMs: z.number(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
  costUsd: z.string().nullable(),
  validation: z
    .object({ valid: z.boolean(), errors: z.array(z.string()) })
    .nullable(),
});
export type PlaygroundRunOutput = z.infer<typeof PlaygroundRunOutputSchema>;

import { z } from "zod";
import { isValidCron } from "./cron.js";

export const TaskFormat = z.enum(["digest", "bullets", "headlines"]);
export type TaskFormat = z.infer<typeof TaskFormat>;

// OpenRouter model id shape, e.g. "anthropic/claude-sonnet-4.5" or
// "meta-llama/llama-4-maverick:free". Catalog membership is enforced
// server-side against the models table.
export const MODEL_ID_RE = /^[\w.-]+\/[\w.:-]+$/;

export const ModelInputSchema = z.object({
  modelId: z
    .string()
    .trim()
    .max(100)
    .regex(MODEL_ID_RE, "Expected an OpenRouter model id like vendor/model"),
  label: z.string().trim().min(1).max(40),
  family: z.string().trim().min(1).max(20),
});
export type ModelInput = z.infer<typeof ModelInputSchema>;

export const ModelUpdateSchema = ModelInputSchema.omit({ modelId: true });
export type ModelUpdate = z.infer<typeof ModelUpdateSchema>;

export const ModelSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  label: z.string(),
  family: z.string(),
  createdAt: z.number(),
  inUse: z.number(),
});
export type Model = z.infer<typeof ModelSchema>;

export const TaskInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  cron: z.string().refine(isValidCron, {
    message:
      "Invalid cron expression (expected 5 fields: min hour dom mon dow)",
  }),
  prompt: z.string().min(4),
  model: z
    .string()
    .trim()
    .max(100)
    .regex(MODEL_ID_RE, "Invalid model id (expected vendor/model)"),
  webSearch: z.boolean(),
  enabled: z.boolean(),
  webhookUrl: z
    .string()
    .regex(
      /^https:\/\/discord(app)?\.com\/api\/webhooks\/.+/,
      "Must be a Discord webhook URL",
    ),
  channel: z
    .string()
    .trim()
    .transform((v) => v.replace(/^#/, ""))
    .default("general"),
  dedupe: z.boolean(),
  format: TaskFormat.default("digest"),
  sources: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});
export type TaskInput = z.infer<typeof TaskInputSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  cron: z.string(),
  prompt: z.string(),
  model: z.string(),
  webSearch: z.boolean(),
  enabled: z.boolean(),
  webhookUrl: z.string(),
  channel: z.string(),
  dedupe: z.boolean(),
  format: TaskFormat,
  sources: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
  nextRunAt: z.number().nullable(),
  lastRun: z
    .object({
      at: z.number(),
      status: z.enum(["ok", "fail"]),
    })
    .nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

export const RunStatus = z.enum(["ok", "fail"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  taskName: z.string(),
  channel: z.string(),
  status: RunStatus,
  message: z.string(),
  durationMs: z.number(),
  createdAt: z.number(),
});
export type Run = z.infer<typeof RunSchema>;

export const LoginInputSchema = z.object({
  key: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const ApiErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "NOT_FOUND",
  "VALIDATION",
  "RATE_LIMITED",
  "INTERNAL",
  "CONFLICT",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

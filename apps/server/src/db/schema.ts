import type { SchemaField } from "@holonet/shared";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  cron: text("cron").notNull(),
  prompt: text("prompt").notNull(),
  model: text("model").notNull(),
  webSearch: boolean("web_search").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  webhookUrl: text("webhook_url").notNull(),
  channel: text("channel").notNull(),
  dedupe: boolean("dedupe").notNull().default(true),
  format: text("format").notNull().default("digest"),
  sources: jsonb("sources").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    taskName: text("task_name").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    message: text("message").notNull(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("runs_created_at_idx").on(table.createdAt),
    index("runs_task_id_idx").on(table.taskId),
  ],
);

export const models = pgTable("models", {
  id: uuid("id").primaryKey().defaultRandom(),
  modelId: text("model_id").notNull().unique(),
  label: text("label").notNull(),
  family: text("family").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const promptFolders = pgTable("prompt_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const outputSchemas = pgTable("schemas", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  fields: jsonb("fields").$type<SchemaField[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const prompts = pgTable("prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  folderId: uuid("folder_id").references(() => promptFolders.id, {
    onDelete: "set null",
  }),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  schemaId: uuid("schema_id").references(() => outputSchemas.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("prompt_versions_prompt_version_idx").on(
      table.promptId,
      table.version,
    ),
  ],
);

export const experiments = pgTable("experiments", {
  id: uuid("id").primaryKey().defaultRandom(),
  promptId: uuid("prompt_id").references(() => prompts.id, {
    onDelete: "set null",
  }),
  promptName: text("prompt_name").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const experimentResults = pgTable(
  "experiment_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    modelId: text("model_id").notNull(),
    status: text("status").notNull().default("pending"),
    output: text("output").notNull().default(""),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms").notNull().default(0),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: text("cost_usd"),
    winner: boolean("winner").notNull().default(false),
  },
  (table) => [
    index("experiment_results_experiment_id_idx").on(table.experimentId),
  ],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type RunRow = typeof runs.$inferSelect;
export type NewRunRow = typeof runs.$inferInsert;
export type ModelRow = typeof models.$inferSelect;
export type NewModelRow = typeof models.$inferInsert;
export type PromptFolderRow = typeof promptFolders.$inferSelect;
export type NewPromptFolderRow = typeof promptFolders.$inferInsert;
export type PromptRow = typeof prompts.$inferSelect;
export type NewPromptRow = typeof prompts.$inferInsert;
export type PromptVersionRow = typeof promptVersions.$inferSelect;
export type NewPromptVersionRow = typeof promptVersions.$inferInsert;
export type ExperimentRow = typeof experiments.$inferSelect;
export type NewExperimentRow = typeof experiments.$inferInsert;
export type ExperimentResultRow = typeof experimentResults.$inferSelect;
export type NewExperimentResultRow = typeof experimentResults.$inferInsert;
export type OutputSchemaRow = typeof outputSchemas.$inferSelect;
export type NewOutputSchemaRow = typeof outputSchemas.$inferInsert;

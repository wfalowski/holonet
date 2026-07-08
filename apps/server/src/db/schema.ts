import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  cron: text("cron").notNull(),
  prompt: text("prompt").notNull(),
  model: text("model").notNull(),
  webSearch: integer("web_search", { mode: "boolean" }).notNull().default(true),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  webhookUrl: text("webhook_url").notNull(),
  channel: text("channel").notNull(),
  dedupe: integer("dedupe", { mode: "boolean" }).notNull().default(true),
  format: text("format").notNull().default("digest"),
  sources: text("sources").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    taskName: text("task_name").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    message: text("message").notNull(),
    durationMs: integer("duration_ms").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("runs_created_at_idx").on(table.createdAt),
    index("runs_task_id_idx").on(table.taskId),
  ],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type RunRow = typeof runs.$inferSelect;
export type NewRunRow = typeof runs.$inferInsert;

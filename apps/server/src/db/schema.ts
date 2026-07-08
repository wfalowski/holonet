import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
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

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type RunRow = typeof runs.$inferSelect;
export type NewRunRow = typeof runs.$inferInsert;

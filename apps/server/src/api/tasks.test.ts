import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import * as schema from "../db/schema.js";
import { logger } from "../logger.js";
import { createExecutor } from "../scheduler/executor.js";
import { createScheduler } from "../scheduler/scheduler.js";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

async function buildApp() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  const config = loadConfig({
    APP_KEY: "test-app-key-123456",
    OPENROUTER_API_KEY: "x",
  });
  const executor = createExecutor({ db, config, logger });
  const scheduler = createScheduler({ db, executor, logger });
  const app = createApp({ db, config, scheduler, executor });
  return { app, scheduler };
}

const validTask = {
  name: "Test Task",
  cron: "30 9 * * *",
  prompt: "Summarize today's headlines",
  model: "anthropic/claude-sonnet-4.5",
  webSearch: true,
  enabled: true,
  dedupe: true,
  webhookUrl: "https://discord.com/api/webhooks/123/abc",
  channel: "general",
  format: "digest",
  sources: [],
};

test("tasks API: create -> list -> toggle -> delete, guarded by auth", async () => {
  const { app, scheduler } = await buildApp();

  // Unauthenticated requests are rejected.
  const noAuth = await app.request("/api/tasks");
  assert.equal(noAuth.status, 401);

  // Log in and capture the session cookie (x-forwarded-for avoids conninfo).
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "1.2.3.4",
    },
    body: JSON.stringify({ key: "test-app-key-123456" }),
  });
  assert.equal(login.status, 204);
  const setCookie = login.headers.get("set-cookie");
  assert.ok(setCookie);
  const auth = { Cookie: (setCookie as string).split(";")[0] as string };

  // Create.
  const createRes = await app.request("/api/tasks", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(validTask),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as {
    id: string;
    nextRunAt: number | null;
    lastRun: unknown;
  };
  assert.ok(created.id);
  assert.equal(typeof created.nextRunAt, "number");
  assert.equal(created.lastRun, null);

  // List — nextRunAt present for the enabled task.
  const listRes = await app.request("/api/tasks", { headers: auth });
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as { nextRunAt: number | null }[];
  assert.equal(list.length, 1);
  assert.equal(typeof list[0]?.nextRunAt, "number");

  // Toggle — disabling clears nextRunAt.
  const toggleRes = await app.request(`/api/tasks/${created.id}/toggle`, {
    method: "POST",
    headers: auth,
  });
  assert.equal(toggleRes.status, 200);
  const toggled = (await toggleRes.json()) as {
    enabled: boolean;
    nextRunAt: number | null;
  };
  assert.equal(toggled.enabled, false);
  assert.equal(toggled.nextRunAt, null);

  // Delete.
  const delRes = await app.request(`/api/tasks/${created.id}`, {
    method: "DELETE",
    headers: auth,
  });
  assert.equal(delRes.status, 204);

  const emptyRes = await app.request("/api/tasks", { headers: auth });
  const empty = (await emptyRes.json()) as unknown[];
  assert.equal(empty.length, 0);

  scheduler.stop();
});

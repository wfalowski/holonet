import assert from "node:assert/strict";
import { test } from "node:test";
import { runs } from "../db/schema.js";
import { buildApp, loginHeaders } from "./test-helpers.js";

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
  const auth = await loginHeaders(app);

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

test("tasks list includes lastRun once a run row exists", async () => {
  const { app, db, scheduler } = await buildApp();
  const auth = await loginHeaders(app);

  const createRes = await app.request("/api/tasks", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(validTask),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as { id: string };

  const runAt = new Date("2026-07-08T10:00:00.000Z");
  await db.insert(runs).values({
    taskId: created.id,
    taskName: validTask.name,
    channel: validTask.channel,
    status: "ok",
    message: "done",
    durationMs: 1234,
    createdAt: runAt,
  });

  const listRes = await app.request("/api/tasks", { headers: auth });
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as {
    lastRun: { at: number; status: string } | null;
  }[];
  assert.equal(list.length, 1);
  assert.equal(list[0]?.lastRun?.status, "ok");
  assert.equal(list[0]?.lastRun?.at, runAt.getTime());

  scheduler.stop();
});

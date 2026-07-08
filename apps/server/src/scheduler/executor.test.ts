import assert from "node:assert/strict";
import { test } from "node:test";
import type { TaskRow } from "../db/schema.js";
import { buildSystemPrompt } from "./executor.js";

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "t1",
    name: "Morning Brief",
    cron: "0 8 * * *",
    prompt: "Summarize the news",
    model: "anthropic/claude-sonnet-4.5",
    webSearch: true,
    enabled: true,
    webhookUrl: "https://discord.com/api/webhooks/1/token",
    channel: "general",
    dedupe: true,
    format: "digest",
    sources: ["Reuters", "AP"],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test("buildSystemPrompt: encodes format, dedupe, and priority sources", () => {
  const prompt = buildSystemPrompt(makeTask());
  assert.match(prompt, /digest/i);
  assert.match(prompt, /[Dd]eduplicate/);
  assert.match(prompt, /Reuters/);
  assert.match(prompt, /cite source links/i);
});

test("buildSystemPrompt: bullets format omits dedupe when disabled", () => {
  const prompt = buildSystemPrompt(
    makeTask({ format: "bullets", dedupe: false, sources: [] }),
  );
  assert.match(prompt, /bullet/i);
  assert.ok(!/Deduplicate/.test(prompt));
});

test("buildSystemPrompt: headlines format", () => {
  const prompt = buildSystemPrompt(makeTask({ format: "headlines" }));
  assert.match(prompt, /headline/i);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelInputSchema, TaskInputSchema } from "./schemas.js";

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

test("ModelInputSchema accepts a valid OpenRouter model entry", () => {
  const parsed = ModelInputSchema.safeParse({
    modelId: "meta-llama/llama-4-maverick:free",
    label: "LLAMA 4 MAVERICK",
    family: "META",
  });
  assert.equal(parsed.success, true);
});

test("ModelInputSchema trims fields", () => {
  const parsed = ModelInputSchema.parse({
    modelId: "  openai/gpt-5.2  ",
    label: " GPT 5.2 ",
    family: " OPENAI ",
  });
  assert.equal(parsed.modelId, "openai/gpt-5.2");
  assert.equal(parsed.label, "GPT 5.2");
  assert.equal(parsed.family, "OPENAI");
});

test("ModelInputSchema rejects ids without a vendor prefix", () => {
  assert.equal(
    ModelInputSchema.safeParse({
      modelId: "gpt-5.2",
      label: "GPT 5.2",
      family: "OPENAI",
    }).success,
    false,
  );
});

test("ModelInputSchema rejects empty label and overlong family", () => {
  assert.equal(
    ModelInputSchema.safeParse({
      modelId: "openai/gpt-5.2",
      label: "",
      family: "OPENAI",
    }).success,
    false,
  );
  assert.equal(
    ModelInputSchema.safeParse({
      modelId: "openai/gpt-5.2",
      label: "GPT 5.2",
      family: "X".repeat(21),
    }).success,
    false,
  );
});

test("TaskInputSchema accepts any well-shaped OpenRouter model id", () => {
  const parsed = TaskInputSchema.safeParse({
    ...validTask,
    model: "mistralai/mistral-large-2",
  });
  assert.equal(parsed.success, true);
});

test("TaskInputSchema rejects malformed model ids", () => {
  assert.equal(
    TaskInputSchema.safeParse({ ...validTask, model: "not a model id!" })
      .success,
    false,
  );
  assert.equal(
    TaskInputSchema.safeParse({ ...validTask, model: "" }).success,
    false,
  );
});

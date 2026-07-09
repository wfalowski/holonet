import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOptimizerMessages, parseOptimizerResponse } from "./optimizer.js";

test("buildOptimizerMessages injects family guidance and target model", () => {
  const messages = buildOptimizerMessages(
    "Summarize the news.",
    "anthropic/claude-sonnet-4.5",
    "ANTHROPIC",
  );
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "system");
  assert.ok(messages[0]?.content.includes("XML tags"));
  assert.ok(messages[0]?.content.includes("<improved>"));
  assert.ok(messages[1]?.content.includes("anthropic/claude-sonnet-4.5"));
  assert.ok(messages[1]?.content.includes("Summarize the news."));
});

test("unknown family falls back to generic guidance", () => {
  const messages = buildOptimizerMessages("p", "acme/model-1", "ACME");
  assert.ok(messages[0]?.content.includes("Be explicit"));
});

test("parseOptimizerResponse splits delimited blocks", () => {
  const parsed = parseOptimizerResponse(
    "<improved>\nBetter prompt\n</improved>\n<rationale>\nShorter.\n</rationale>",
  );
  assert.equal(parsed.improved, "Better prompt");
  assert.equal(parsed.rationale, "Shorter.");
});

test("parseOptimizerResponse falls back to whole text when delimiters missing", () => {
  const parsed = parseOptimizerResponse("Just a better prompt");
  assert.equal(parsed.improved, "Just a better prompt");
  assert.equal(parsed.rationale, "");
});

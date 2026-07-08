import assert from "node:assert/strict";
import { test } from "node:test";
import { splitDiscordChunks } from "./discord.js";

test("splitDiscordChunks: short content stays a single chunk", () => {
  assert.deepEqual(splitDiscordChunks("hello\nworld", 4000), ["hello\nworld"]);
});

test("splitDiscordChunks: breaks on newline boundaries under the limit", () => {
  assert.deepEqual(splitDiscordChunks("aaa\nbbb\nccc", 7), ["aaa\nbbb", "ccc"]);
});

test("splitDiscordChunks: hard-splits a single over-long line", () => {
  const chunks = splitDiscordChunks("x".repeat(25), 10);
  assert.deepEqual(chunks, ["xxxxxxxxxx", "xxxxxxxxxx", "xxxxx"]);
  for (const chunk of chunks) assert.ok(chunk.length <= 10);
});

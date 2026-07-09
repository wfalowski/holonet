import assert from "node:assert/strict";
import { test } from "node:test";
import { lineDiff } from "./diff.js";

test("identical strings produce only same lines", () => {
  assert.deepEqual(lineDiff("a\nb", "a\nb"), [
    { kind: "same", text: "a" },
    { kind: "same", text: "b" },
  ]);
});

test("added and removed lines are marked", () => {
  const diff = lineDiff("a\nb\nc", "a\nx\nc");
  assert.deepEqual(diff, [
    { kind: "same", text: "a" },
    { kind: "del", text: "b" },
    { kind: "add", text: "x" },
    { kind: "same", text: "c" },
  ]);
});

test("pure additions at the end", () => {
  assert.deepEqual(lineDiff("a", "a\nb"), [
    { kind: "same", text: "a" },
    { kind: "add", text: "b" },
  ]);
});

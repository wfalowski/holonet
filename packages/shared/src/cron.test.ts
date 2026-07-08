import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCron, isValidCron, nextRun } from "./cron.js";

test("describeCron: daily schedule", () => {
  const d = describeCron("30 9 * * *");
  assert.equal(d.ok, true);
  assert.equal(d.tag, "DAILY");
  assert.equal(d.text, "Every day at 09:30");
});

test("describeCron: weekdays schedule", () => {
  const d = describeCron("0 8 * * 1-5");
  assert.equal(d.ok, true);
  assert.equal(d.tag, "WEEKDAYS");
  assert.equal(d.text, "Weekdays at 08:00");
});

test("describeCron: every 15 minutes", () => {
  const d = describeCron("*/15 * * * *");
  assert.equal(d.ok, true);
  assert.equal(d.tag, "EVERY 15M");
  assert.equal(d.text, "Every 15 minutes");
});

test("describeCron: invalid expression", () => {
  const d = describeCron("not a cron");
  assert.equal(d.ok, false);
  assert.equal(d.tag, "INVALID");
});

test("describeCron: wrong field count is invalid", () => {
  const d = describeCron("* * * *");
  assert.equal(d.ok, false);
  assert.equal(d.tag, "INVALID");
});

test("isValidCron rejects out-of-range values", () => {
  assert.equal(isValidCron("60 * * * *"), false);
  assert.equal(isValidCron("0 0 * * *"), true);
});

test("nextRun: computes the next daily occurrence", () => {
  const from = new Date("2026-07-08T09:00:00").getTime();
  const ts = nextRun("30 9 * * *", from);
  assert.ok(ts !== null);
  const d = new Date(ts);
  assert.equal(d.getHours(), 9);
  assert.equal(d.getMinutes(), 30);
  assert.ok(ts > from);
});

test("nextRun: invalid cron returns null", () => {
  assert.equal(nextRun("bogus"), null);
});

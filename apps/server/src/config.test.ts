import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { loadConfig } from "./config.js";

test("loadConfig: applies defaults and derives SESSION_SECRET", () => {
  const config = loadConfig({
    APP_KEY: "a".repeat(16),
    OPENROUTER_API_KEY: "sk-or-test",
  });
  assert.equal(config.port, 3000);
  assert.equal(
    config.databaseUrl,
    "postgres://holonet:holonet@localhost:5432/holonet",
  );
  assert.equal(config.cookieSecure, false);
  assert.equal(
    config.sessionSecret,
    createHash("sha256")
      .update(`${"a".repeat(16)}:holonet-session`)
      .digest("hex"),
  );
});

test("loadConfig: throws a readable error when required vars are missing", () => {
  assert.throws(() => loadConfig({}), /Invalid environment configuration/);
});

test("loadConfig: rejects an APP_KEY shorter than 16 characters", () => {
  assert.throws(
    () => loadConfig({ APP_KEY: "short", OPENROUTER_API_KEY: "x" }),
    /APP_KEY/,
  );
});

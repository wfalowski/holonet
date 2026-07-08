import assert from "node:assert/strict";
import { test } from "node:test";
import { isSessionValid, SESSION_MAX_AGE_MS } from "./middleware.js";

test("isSessionValid: accepts a fresh session", () => {
  assert.equal(isSessionValid(JSON.stringify({ iat: Date.now() })), true);
});

test("isSessionValid: rejects an expired iat", () => {
  const old = Date.now() - SESSION_MAX_AGE_MS - 1000;
  assert.equal(isSessionValid(JSON.stringify({ iat: old })), false);
});

test("isSessionValid: rejects malformed payloads", () => {
  assert.equal(isSessionValid("not json"), false);
  assert.equal(isSessionValid(JSON.stringify({})), false);
  assert.equal(isSessionValid(JSON.stringify({ iat: "nope" })), false);
});

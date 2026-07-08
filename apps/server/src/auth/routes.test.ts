import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { createAuthRoutes } from "./routes.js";

test("login rate limit: ignores X-Forwarded-For when trustProxy is disabled (default)", async () => {
  const config = loadConfig({
    APP_KEY: "test-app-key-123456",
    OPENROUTER_API_KEY: "x",
  });
  assert.equal(config.trustProxy, false);
  const app = createAuthRoutes(config);

  for (let i = 0; i < 5; i++) {
    const res = await app.request("/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": `10.0.0.${i}`,
      },
      body: JSON.stringify({ key: "wrong-key" }),
    });
    assert.equal(res.status, 401);
  }

  // A 6th attempt, even under a brand-new spoofed X-Forwarded-For, still hits
  // the same rate bucket because trustProxy is off.
  const sixth = await app.request("/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "10.0.0.99",
    },
    body: JSON.stringify({ key: "wrong-key" }),
  });
  assert.equal(sixth.status, 429);
});

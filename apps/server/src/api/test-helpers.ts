import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import * as schema from "../db/schema.js";
import { logger } from "../logger.js";
import { createExecutor } from "../scheduler/executor.js";
import { createScheduler } from "../scheduler/scheduler.js";

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

export const TEST_APP_KEY = "test-app-key-123456";

/** Fresh in-memory Postgres + migrated schema + fully wired Hono app. */
export async function buildApp() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  const config = loadConfig({
    APP_KEY: TEST_APP_KEY,
    OPENROUTER_API_KEY: "x",
  });
  const executor = createExecutor({ db, config, logger });
  const scheduler = createScheduler({ db, executor, logger });
  const app = createApp({ db, config, scheduler, executor });
  return { app, db, scheduler };
}

/** Log in and return the session-cookie headers for authenticated requests. */
export async function loginHeaders(
  app: Awaited<ReturnType<typeof buildApp>>["app"],
): Promise<{ Cookie: string }> {
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "1.2.3.4",
    },
    body: JSON.stringify({ key: TEST_APP_KEY }),
  });
  assert.equal(login.status, 204);
  const setCookie = login.headers.get("set-cookie");
  assert.ok(setCookie);
  return { Cookie: (setCookie as string).split(";")[0] as string };
}

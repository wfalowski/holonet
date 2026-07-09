import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { closeDb, createDb } from "./db/index.js";
import { logger } from "./logger.js";
import { createExecutor } from "./scheduler/executor.js";
import {
  createExperimentRunner,
  recoverInterruptedExperiments,
} from "./scheduler/experimentRunner.js";
import { createScheduler } from "./scheduler/scheduler.js";

// apps/server/src/index.ts and its compiled apps/server/dist/index.js are both
// one directory level under apps/server/, so this relative path resolves to the
// committed apps/server/drizzle/ migrations folder in both dev and production.
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

const DB_WAIT_TIMEOUT_MS = 30_000;
const DB_WAIT_INTERVAL_MS = 1000;

// Postgres may still be starting up (e.g. compose brings both containers up
// together) — retry the initial connection for a bit before giving up.
async function waitForDatabase(pool: Pool): Promise<void> {
  const deadline = Date.now() + DB_WAIT_TIMEOUT_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      logger.info({ attempt }, "waiting for database to accept connections");
      await new Promise((resolve) => setTimeout(resolve, DB_WAIT_INTERVAL_MS));
    }
  }
}

async function main() {
  const config = loadConfig();
  const { db, pool } = createDb(config.databaseUrl);

  await waitForDatabase(pool);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  logger.info("database migrated");

  await recoverInterruptedExperiments(db, logger);
  const experimentRunner = createExperimentRunner({ db, config, logger });

  const executor = createExecutor({ db, config, logger });
  const scheduler = createScheduler({ db, executor, logger });
  try {
    await scheduler.start();
  } catch (err) {
    logger.error({ err }, "scheduler failed to start");
  }

  const app = createApp({ db, config, scheduler, executor, experimentRunner });

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info({ port: info.port }, "holonet server listening");
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    scheduler.stop();
    server.close((err) => {
      if (err) {
        logger.error({ err }, "error while closing server");
        process.exit(1);
      }
      closeDb(pool)
        .catch((closeErr) => {
          logger.error({ err: closeErr }, "error while closing database");
        })
        .finally(() => process.exit(0));
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});

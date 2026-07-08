import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/index.js";
import { logger } from "./logger.js";
import { createExecutor } from "./scheduler/executor.js";
import { createScheduler } from "./scheduler/scheduler.js";

// apps/server/src/index.ts and its compiled apps/server/dist/index.js are both
// one directory level under apps/server/, so this relative path resolves to the
// committed apps/server/drizzle/ migrations folder in both dev and production.
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

async function main() {
  const config = loadConfig();
  const db = createDb(config.databasePath);

  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  logger.info("database migrated");

  const executor = createExecutor({ db, config, logger });
  const scheduler = createScheduler({ db, executor, logger });
  try {
    await scheduler.start();
  } catch (err) {
    logger.error({ err }, "scheduler failed to start");
  }

  const app = createApp({ db, config, scheduler, executor });

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
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});

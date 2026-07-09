import { randomUUID } from "node:crypto";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createFoldersRoutes } from "./api/folders.js";
import { createModelsRoutes } from "./api/models.js";
import { createPromptsRoutes } from "./api/prompts.js";
import { createRunsRoutes } from "./api/runs.js";
import { createSchemasRoutes } from "./api/schemas.js";
import { createTasksRoutes } from "./api/tasks.js";
import { authMiddleware } from "./auth/middleware.js";
import { createAuthRoutes } from "./auth/routes.js";
import type { Config } from "./config.js";
import type { Db } from "./db/index.js";
import { logger } from "./logger.js";
import type { Executor } from "./scheduler/executor.js";
import type { Scheduler } from "./scheduler/scheduler.js";

export interface AppDeps {
  db: Db;
  config: Config;
  scheduler: Scheduler;
  executor: Executor;
}

type AppEnv = { Variables: { requestId: string } };

export function createApp({
  db,
  config,
  scheduler,
  executor,
}: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const requestId = randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    const start = Date.now();
    await next();
    logger.info({
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    });
  });

  app.onError((err, c) => {
    const requestId = c.get("requestId");
    if (err instanceof HTTPException) {
      logger.error({ requestId, err }, "request error");
      return err.getResponse();
    }
    logger.error({ requestId, err }, "unhandled error");
    return c.json(
      { error: { code: "INTERNAL", message: "internal error" } },
      500,
    );
  });

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "not found" } }, 404),
  );

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.route("/api/auth", createAuthRoutes(config));

  const api = new Hono();
  api.use("*", authMiddleware(config));
  api.route("/tasks", createTasksRoutes(db, scheduler, executor));
  api.route("/models", createModelsRoutes(db));
  api.route("/folders", createFoldersRoutes(db));
  api.route("/prompts", createPromptsRoutes(db, config));
  api.route("/runs", createRunsRoutes(db));
  api.route("/schemas", createSchemasRoutes(db));
  app.route("/api", api);

  app.use(
    "*",
    serveStatic({
      root: config.staticDir,
    }),
  );
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api")) return next();
    return serveStatic({ root: config.staticDir, path: "index.html" })(c, next);
  });

  return app;
}

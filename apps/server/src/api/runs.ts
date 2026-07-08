import { desc } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { runs } from "../db/schema.js";
import { rowToRun } from "./serialize.js";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(80),
});

export function createRunsRoutes(db: Db): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const parsed = QuerySchema.safeParse({ limit: c.req.query("limit") });
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION",
            message: parsed.error.issues[0]?.message ?? "Invalid query",
          },
        },
        400,
      );
    }

    const rows = await db
      .select()
      .from(runs)
      .orderBy(desc(runs.createdAt))
      .limit(parsed.data.limit);
    return c.json(rows.map(rowToRun));
  });

  return app;
}

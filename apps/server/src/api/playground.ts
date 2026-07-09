import {
  PlaygroundRunInputSchema,
  type PlaygroundRunOutput,
  validateFields,
} from "@holonet/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import { models, outputSchemas } from "../db/schema.js";
import {
  chatCompleteDetailed,
  type ResponseFormat,
  schemaResponseFormat,
} from "../services/openrouter.js";

function validationError(message: string) {
  return { error: { code: "VALIDATION" as const, message } };
}

export function createPlaygroundRoutes(db: Db, config: Config): Hono {
  const app = new Hono();

  app.post("/run", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = PlaygroundRunInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        validationError(parsed.error.issues[0]?.message ?? "Invalid request"),
        400,
      );
    }

    const modelRows = await db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.modelId, parsed.data.modelId));
    if (modelRows.length === 0) {
      return c.json(validationError("Unknown model"), 400);
    }

    let responseFormat: ResponseFormat | undefined;
    let schemaFields = null;
    if (parsed.data.schemaId) {
      const schemaRows = await db
        .select()
        .from(outputSchemas)
        .where(eq(outputSchemas.id, parsed.data.schemaId));
      const schema = schemaRows[0];
      if (!schema) return c.json(validationError("Unknown schema"), 400);
      schemaFields = schema.fields;
      responseFormat = schemaResponseFormat(schema.name, schema.fields);
    }

    const started = Date.now();
    try {
      const result = await chatCompleteDetailed({
        apiKey: config.openrouterApiKey,
        model: parsed.data.modelId,
        messages: [{ role: "user", content: parsed.data.content }],
        responseFormat,
      });
      let validation: PlaygroundRunOutput["validation"] = null;
      if (schemaFields) {
        try {
          const value: unknown = JSON.parse(result.content);
          const errors = validateFields(schemaFields, value);
          validation = { valid: errors.length === 0, errors };
        } catch {
          validation = {
            valid: false,
            errors: ["response is not valid JSON"],
          };
        }
      }
      const output: PlaygroundRunOutput = {
        output: result.content,
        durationMs: Date.now() - started,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
        validation,
      };
      return c.json(output);
    } catch {
      return c.json(
        { error: { code: "INTERNAL" as const, message: "Model call failed" } },
        502,
      );
    }
  });

  return app;
}

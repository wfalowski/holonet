import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// apps/server/src/config.ts and its compiled apps/server/dist/config.js are both
// one directory level under apps/server/, so this relative path resolves to
// apps/web/dist in both dev (tsx) and production (tsc build) layouts.
const DEFAULT_STATIC_DIR = fileURLToPath(
  new URL("../../web/dist", import.meta.url),
);

const EnvSchema = z.object({
  APP_KEY: z.string().min(16, "must be at least 16 characters"),
  OPENROUTER_API_KEY: z.string().min(1, "is required"),
  SESSION_SECRET: z.string().min(1).optional(),
  DATABASE_PATH: z.string().default("./data/holonet.db"),
  PORT: z
    .string()
    .default("3000")
    .transform((v) => Number.parseInt(v, 10))
    .pipe(z.number().int().positive()),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  TZ: z.string().optional(),
  STATIC_DIR: z.string().default(DEFAULT_STATIC_DIR),
});

export interface Config {
  appKey: string;
  openrouterApiKey: string;
  sessionSecret: string;
  databasePath: string;
  port: number;
  cookieSecure: boolean;
  trustProxy: boolean;
  tz: string | undefined;
  staticDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const data = parsed.data;
  const sessionSecret =
    data.SESSION_SECRET ??
    createHash("sha256")
      .update(`${data.APP_KEY}:holonet-session`)
      .digest("hex");
  return {
    appKey: data.APP_KEY,
    openrouterApiKey: data.OPENROUTER_API_KEY,
    sessionSecret,
    databasePath: data.DATABASE_PATH,
    port: data.PORT,
    cookieSecure: data.COOKIE_SECURE,
    trustProxy: data.TRUST_PROXY,
    tz: data.TZ,
    staticDir: data.STATIC_DIR,
  };
}

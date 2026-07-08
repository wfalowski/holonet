import type { Context, Next } from "hono";
import { getSignedCookie } from "hono/cookie";
import type { Config } from "../config.js";

export const SESSION_COOKIE = "holonet_session";
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// A verified cookie value is valid iff it decodes to a payload with a numeric
// `iat` no older than 30 days. Signature verification happens before this is
// called (via getSignedCookie), so a tampered value never reaches here.
export function isSessionValid(value: string, now = Date.now()): boolean {
  try {
    const payload = JSON.parse(value) as { iat?: unknown };
    const iat = payload.iat;
    return (
      typeof iat === "number" &&
      Number.isFinite(iat) &&
      now - iat < SESSION_MAX_AGE_MS
    );
  } catch {
    return false;
  }
}

// Resolve the authenticated session from the request, if any. Returns false when
// the cookie is missing, unsigned/tampered, or expired.
export async function readSession(
  c: Context,
  config: Config,
): Promise<boolean> {
  const value = await getSignedCookie(c, config.sessionSecret, SESSION_COOKIE);
  return typeof value === "string" && isSessionValid(value);
}

export function authMiddleware(config: Config) {
  return async (c: Context, next: Next) => {
    if (await readSession(c, config)) {
      return next();
    }
    return c.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      401,
    );
  };
}

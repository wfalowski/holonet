import { createHash, timingSafeEqual } from "node:crypto";
import { LoginInputSchema } from "@holonet/shared";
import { getConnInfo } from "@hono/node-server/conninfo";
import { type Context, Hono } from "hono";
import { deleteCookie, setSignedCookie } from "hono/cookie";
import type { Config } from "../config.js";
import {
  readSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
} from "./middleware.js";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPTS_SWEEP_THRESHOLD = 1000;
const ATTEMPTS_HARD_CAP = 10000;

interface RateEntry {
  failures: number;
  resetAt: number;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function createAuthRoutes(config: Config): Hono {
  const app = new Hono();
  const attempts = new Map<string, RateEntry>();

  function clientIp(c: Context): string {
    if (config.trustProxy) {
      const forwarded = c.req.header("x-forwarded-for");
      if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  // Bound the attempts map: past a small size, sweep expired entries; if still
  // oversized (sustained spoofed-IP flood), evict the oldest-expiring entry too.
  function sweepAttempts(now: number): void {
    if (attempts.size <= ATTEMPTS_SWEEP_THRESHOLD) return;
    for (const [ip, entry] of attempts) {
      if (entry.resetAt < now) attempts.delete(ip);
    }
    if (attempts.size >= ATTEMPTS_HARD_CAP) {
      let oldestIp: string | undefined;
      let oldestResetAt = Number.POSITIVE_INFINITY;
      for (const [ip, entry] of attempts) {
        if (entry.resetAt < oldestResetAt) {
          oldestResetAt = entry.resetAt;
          oldestIp = ip;
        }
      }
      if (oldestIp !== undefined) attempts.delete(oldestIp);
    }
  }

  app.post("/login", async (c) => {
    const ip = clientIp(c);
    const now = Date.now();
    sweepAttempts(now);

    const entry = attempts.get(ip);
    if (entry && now < entry.resetAt && entry.failures >= RATE_LIMIT_MAX) {
      return c.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many attempts. Try again later.",
          },
        },
        429,
      );
    }

    const body = await c.req.json().catch(() => null);
    const parsed = LoginInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "VALIDATION",
            message: parsed.error.issues[0]?.message ?? "Invalid request",
          },
        },
        400,
      );
    }

    const ok = timingSafeEqual(sha256(parsed.data.key), sha256(config.appKey));
    if (!ok) {
      const current =
        entry && now < entry.resetAt
          ? entry
          : { failures: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      current.failures += 1;
      attempts.set(ip, current);
      return c.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid access key" } },
        401,
      );
    }

    attempts.delete(ip);
    await setSignedCookie(
      c,
      SESSION_COOKIE,
      JSON.stringify({ iat: now }),
      config.sessionSecret,
      {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        secure: config.cookieSecure,
        maxAge: SESSION_MAX_AGE_MS / 1000,
      },
    );
    return c.body(null, 204);
  });

  app.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  app.get("/me", async (c) => {
    return c.json({ authenticated: await readSession(c, config) });
  });

  return app;
}

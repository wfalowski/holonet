import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema.js";

// Structural type both the node-postgres driver (production) and the PGlite
// driver (tests) satisfy, so handlers/scheduler/executor can depend on a
// single Db type regardless of which driver constructed it.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: NodePgDatabase<typeof schema>;
  pool: Pool;
}

export function createDb(databaseUrl: string): DbHandle {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export async function closeDb(pool: Pool): Promise<void> {
  await pool.end();
}

export * from "./schema.js";

import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

// PlanetScale Postgres through node-postgres. DATABASE_URL points at the
// PgBouncer port (6432), which runs in transaction pooling mode: interactive
// transactions and row-level locks work, but session state does not survive
// between transactions (no session advisory locks, LISTEN/NOTIFY, temp tables,
// or SET outside a transaction, and no named prepared statements).
// Migrations use the direct connection instead; see drizzle.config.ts.
function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  const pool = new Pool({ connectionString });
  // On Vercel Fluid compute, closes idle connections before the instance suspends.
  attachDatabasePool(pool);
  return drizzle({ client: pool, schema });
}

export type Db = ReturnType<typeof createDb>;

let db: Db | undefined;

/** Lazily creates the Drizzle client so importing this module never needs a database. */
export function getDb(): Db {
  db ??= createDb();
  return db;
}

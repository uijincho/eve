import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { normalizeConnectionString } from "./connection";
import * as schema from "./schema";

// PlanetScale Postgres through node-postgres. DATABASE_URL points at the
// PgBouncer port (6432), which runs in transaction pooling mode: interactive
// transactions and row-level locks work, but session state does not survive
// between transactions (no session advisory locks, LISTEN/NOTIFY, temp tables,
// or SET outside a transaction, and no named prepared statements). Use
// `SET LOCAL` / `pg_advisory_xact_lock` inside transactions only.
// Migrations use the direct connection instead; see scripts/migrate.ts.
function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  const pool = new Pool({ ...normalizeConnectionString(connectionString).config, max: 5 });
  // On Vercel Fluid compute, closes idle connections before the instance suspends.
  attachDatabasePool(pool);
  return Object.assign(drizzle({ client: pool, schema }), { $pool: pool });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the pool-backed client or an open transaction. */
export type Executor = Db | Tx;

let db: Db | undefined;

/** Lazily creates the Drizzle client so importing this module never needs a database. */
export function getDb(): Db {
  db ??= createDb();
  return db;
}

/** Separate client for scripts/tests that need the direct (non-PgBouncer) port. */
export function createDirectDb(): Db {
  return createDb(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL);
}

export { schema };

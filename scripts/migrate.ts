// Applies lib/db/migrations over the direct connection (DDL must not go
// through PgBouncer). Uses the same TLS normalizer as the app, so the
// `sslrootcert=system` libpq option works and certificates stay verified.
import { loadEnvConfig } from "@next/env";
import { migrate } from "drizzle-orm/node-postgres/migrator";

loadEnvConfig(process.cwd());

async function main() {
  const { createDirectDb } = await import("../lib/db");
  const db = createDirectDb();
  await migrate(db, { migrationsFolder: "lib/db/migrations" });
  await db.$pool.end();
  console.log("migrations applied");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

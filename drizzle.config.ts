import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

import { normalizeConnectionString } from "./lib/db/connection";

// Load .env / .env.local the same way Next.js does.
loadEnvConfig(process.cwd());

// PlanetScale recommends the direct port (5432) for DDL; PgBouncer's
// transaction pooling is for app traffic only. The direct URL carries the
// libpq option `sslrootcert=system`, which node-postgres misreads as a file
// path, so credentials go through the same normalizer as the app: the option
// is dropped and TLS stays fully verified.
function credentials() {
  const raw = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!raw) return { url: "postgresql://localhost/eve" }; // `generate` needs no database
  const { url, config } = normalizeConnectionString(raw);
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, "") || "postgres",
    ssl: typeof config.ssl === "object" ? config.ssl : undefined,
  };
}

export default defineConfig({
  dialect: "postgresql",
  schema: ["./lib/db/schema.ts", "./lib/db/schema-onboarding.ts"],
  out: "./lib/db/migrations",
  dbCredentials: credentials(),
  strict: true,
  verbose: true,
});

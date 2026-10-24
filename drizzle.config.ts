import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Load .env / .env.local the same way Next.js does.
loadEnvConfig(process.cwd());

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dbCredentials: {
    // PlanetScale recommends the direct port (5432) for DDL; PgBouncer's
    // transaction pooling is for app traffic only.
    url: process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});

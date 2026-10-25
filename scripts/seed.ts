// Seeds (or with --reset, re-seeds) the synthetic demo organization only.
// Never truncates; reset is scoped to the is_demo org by lib/server/reset.ts.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { getDb } = await import("../lib/db");
  const { ensureDemoOrg, resetDemoOrg } = await import("../lib/server/seed");
  const db = getDb();
  const started = Date.now();
  const preset = process.argv.includes("--benchmark") ? "benchmark" : "demo";
  if (process.argv.includes("--reset")) {
    await db.transaction((tx) => resetDemoOrg(tx, preset));
    console.log(`demo org reset in ${Date.now() - started} ms`);
  } else {
    const seeded = await ensureDemoOrg(db, preset);
    console.log(seeded ? `demo org seeded in ${Date.now() - started} ms` : "demo org already exists (use --reset)");
  }
  await db.$pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

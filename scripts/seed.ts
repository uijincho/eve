// Seed script skeleton. No data yet.
//
// Phase 0 target: one org, one event, five attendees in three countries.
// Later: the 300-person event, planted errors, and the answer key that the
// tests in tests/ run against.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  // TODO: insert rows with getDb() from "@/lib/db" once the schema lands.
  console.log("seed: nothing to seed yet");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

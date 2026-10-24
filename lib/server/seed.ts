import type { Executor } from "@/lib/db";

export async function resetDemoOrg(_tx: Executor): Promise<void> {
  throw new Error("Demo seed is not available yet.");
}

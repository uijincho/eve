import { desc, eq } from "drizzle-orm";

import type { Scoreboard } from "@/lib/contracts";
import type { Executor } from "@/lib/db";
import { scoreboardRun } from "@/lib/db/schema";

import { computeScoreboard } from "./scoreboard";

/** Display a measured run unchanged until the next evaluation is saved. */
export async function loadScoreboardView(db: Executor, orgId: string): Promise<Scoreboard> {
  const [run] = await db.select().from(scoreboardRun).where(eq(scoreboardRun.orgId, orgId))
    .orderBy(desc(scoreboardRun.runAt)).limit(1);
  if (!run) return computeScoreboard(db, orgId);
  return {
    total: run.total, evaluated: run.results.length, caught: run.caught, missed: run.missed,
    falsePositives: run.falsePositives, wrongfulPayouts: run.wrongfulPayouts,
    results: run.results, lastRunAt: run.runAt.toISOString(),
  };
}

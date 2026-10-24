import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestOrg, dropTestOrg, hasDatabase } from "./helpers";

describe.skipIf(!hasDatabase)("measured scoreboard snapshots", { timeout: 60_000 }, () => {
  let orgId = "";
  beforeAll(async () => { orgId = await createTestOrg("scoreboard-view"); });
  afterAll(async () => { if (orgId) await dropTestOrg(orgId); }, 60_000);

  it("keeps the last evaluated result until a new evaluation is saved", async () => {
    const { getDb } = await import("@/lib/db");
    const { answerKey } = await import("@/lib/db/schema");
    const { computeScoreboard, saveScoreboard } = await import("@/lib/server/scoreboard");
    const { loadScoreboardView } = await import("@/lib/server/scoreboard-view");
    const db = getDb();
    const initial = await loadScoreboardView(db, orgId);
    expect(initial.lastRunAt).toBeUndefined();
    expect(initial.total).toBe(0);
    await saveScoreboard(db, orgId, initial);
    const saved = await loadScoreboardView(db, orgId);
    expect(saved.lastRunAt).toBeTruthy();

    await db.insert(answerKey).values({ id: `${orgId}_key`, orgId, scenario: "Missing receipt", objectType: "claim", objectId: `${orgId}_claim`, expected: "flag", expectedCode: "receipt", description: "Synthetic missing claim" });
    expect(await loadScoreboardView(db, orgId)).toEqual(saved);

    const next = await computeScoreboard(db, orgId);
    expect(next.total).toBe(1);
    expect(next.missed).toBe(1);
    await saveScoreboard(db, orgId, next);
    const refreshed = await loadScoreboardView(db, orgId);
    expect(refreshed.total).toBe(1);
    expect(refreshed.missed).toBe(1);
    expect(refreshed.lastRunAt).not.toBe(saved.lastRunAt);
  });
});

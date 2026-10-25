import { describe, expect, it } from "vitest";
import { hasDatabase, sql } from "./helpers";

describe.skipIf(!hasDatabase)("compact demo seed", () => {
  it("offers 15 diverse payments while retaining review and blocked cases", async () => {
    const { getDb } = await import("@/lib/db");
    const s = await import("@/lib/db/schema");
    const { seedDemoOrg } = await import("@/lib/server/seed");
    const { prepareRelease } = await import("@/lib/server/payouts");
    const { DEMO_ORG_ID } = await import("@/lib/server/http");
    const rollback = new Error("Roll back the isolated seed fixture");
    // Seed stable demo IDs in a private schema, never reset the shared demo.
    // LIKE copies column types, defaults and indexes; this test checks fixture
    // content and the real release gates, not migration/FK/trigger integrity.
    await expect(getDb().transaction(async (tx) => {
      const schema = `seed_test_${crypto.randomUUID().replaceAll("-", "")}`;
      await tx.execute(sql.raw(`CREATE SCHEMA "${schema}"`));
      await tx.execute(sql.raw(`DO $$ DECLARE t record; BEGIN
        FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
          EXECUTE format('CREATE TABLE %I.%I (LIKE public.%I INCLUDING ALL)', '${schema}', t.tablename, t.tablename);
        END LOOP;
      END $$`));
      await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}", public`));
      await seedDemoOrg(tx);
      const people = await tx.select().from(s.person);
      const claims = await tx.select().from(s.claim);
      const payouts = await tx.select().from(s.payout);
      const ready = payouts.filter((p) => p.status === "proposed");
      expect(people).toHaveLength(60);
      expect(claims).toHaveLength(12);
      expect(ready).toHaveLength(15);
      expect(ready.filter((p) => p.claimId)).toHaveLength(7);
      expect(ready.filter((p) => p.awardId)).toHaveLength(8);
      const recipients = people.filter((p) => ready.some((r) => r.personId === p.id));
      expect(new Set(recipients.map((p) => p.country)).size).toBeGreaterThanOrEqual(8);
      expect(ready.some((p) => p.withholdingMinor > 0n)).toBe(true);
      expect(payouts.some((p) => p.status === "frozen")).toBe(true);
      expect(payouts.some((p) => p.status === "held")).toBe(true);
      expect(claims.filter((c) => c.status === "submitted")).toHaveLength(2);
      expect(claims.some((c) => c.checks.some((check) => check.code === "duplicate" && !check.passed))).toBe(true);
      const actor = { orgId: DEMO_ORG_ID, memberId: "mem_demo_ari", role: "controller" as const, name: "Ari Novak", email: "ari@bayview.example", personId: null, userId: null, demo: true };
      for (const p of ready) expect((await prepareRelease(tx, actor, p.id, "sponsor")).kind).toBe("ready");
      throw rollback;
    })).rejects.toBe(rollback);
  }, 180_000);
});

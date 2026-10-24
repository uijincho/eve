import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestOrg, dropTestOrg, eq, hasDatabase } from "./helpers";
import { advanceTaxChase } from "../../lib/agent/automation";
import { getDb } from "../../lib/db";
import * as s from "../../lib/db/schema";
import { newId } from "../../lib/db/ids";

describe.skipIf(!hasDatabase)("durable tax chase persistence", { timeout: 60_000 }, () => {
  let orgId = "";
  let personId = "";
  let generation = "";
  let db: ReturnType<typeof getDb>;
  beforeAll(async () => {
    db = getDb();
    orgId = await createTestOrg("chase");
    const [person] = await db.insert(s.person).values({ id: newId("ptest"), orgId, name: "Synthetic Chase Recipient", email: "chase@example.test", country: "CA", citizenship: "CA", dateOfBirth: "2000-01-01", adult: true }).returning();
    personId = person.id;
    generation = `${person.createdAt.getTime()}:missing`;
  }, 60_000);
  afterAll(async () => { if (orgId) await dropTestOrg(orgId); }, 60_000);

  it("deduplicates concurrent stages and records the next actual schedule", async () => {
    const target = { orgId, personId, generation };
    const results = await Promise.all([advanceTaxChase(target, 0, "workflow-test-a"), advanceTaxChase(target, 0, "workflow-test-b")]);
    expect(results[0].noticeIds).toEqual(results[1].noticeIds);
    const [person] = await db.select().from(s.person).where(eq(s.person.id, personId));
    const decisions = await db.select().from(s.decisionLog).where(eq(s.decisionLog.orgId, orgId));
    expect(person.chaseCount).toBe(1);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].status).toBe("waiting");
    expect(decisions[0].nextActionAt!.getTime() - Date.now()).toBeGreaterThan(47 * 60 * 60 * 1000);
    expect(decisions[0].facts).not.toHaveProperty("email");
  });
  it("escalates the final stage and creates an organizer notice", async () => {
    const result = await advanceTaxChase({ orgId, personId, generation }, 10, "workflow-test-a");
    expect(result.complete).toBe(true);
    expect(result.noticeIds).toHaveLength(3);
    const decisions = await db.select().from(s.decisionLog).where(eq(s.decisionLog.orgId, orgId));
    expect(decisions.some((d) => d.status === "escalated" && d.nextActionAt === null)).toBe(true);
  });
  it("stops an old workflow after a new signed profile supersedes its input", async () => {
    await db.insert(s.taxProfile).values({ id: newId("tax"), orgId, personId, form: "W-8BEN", status: "valid", signatureName: "Synthetic Chase Recipient", signedAt: new Date(), expiresAt: new Date("2029-12-31T23:59:59Z") });
    const result = await advanceTaxChase({ orgId, personId, generation }, 2, "workflow-test-a");
    expect(result.complete).toBe(true);
    expect(result.noticeIds).toHaveLength(0);
  });
});

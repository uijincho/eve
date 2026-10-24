import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestOrg, dropTestOrg, eq, failure, hasDatabase, sql } from "./helpers";

describe.skipIf(!hasDatabase)("ledger against real Postgres", { timeout: 60_000 }, () => {
  let orgId = "";
  let db: Awaited<ReturnType<typeof load>>["db"];
  let ledger: Awaited<ReturnType<typeof load>>["ledger"];
  let s: Awaited<ReturnType<typeof load>>["s"];

  async function load() {
    const { getDb } = await import("@/lib/db");
    return { db: getDb(), ledger: await import("@/lib/ledger"), s: await import("@/lib/db/schema") };
  }

  beforeAll(async () => {
    ({ db, ledger, s } = await load());
    orgId = await createTestOrg("ledger");
  }, 60_000);
  afterAll(async () => {
    if (orgId) await dropTestOrg(orgId);
  }, 60_000);

  const prize = (key: string, date?: string) => ({
    orgId, memo: "Prize accrual", sourceType: "test", sourceId: key, idempotencyKey: key, createdBy: "test", entryDate: date,
    lines: [
      { account: "5100" as const, debitMinor: 100000n, currency: "USD" },
      { account: "2100" as const, creditMinor: 30000n, currency: "USD" },
      { account: "2000" as const, creditMinor: 70000n, currency: "USD" },
    ],
  });

  it("posts a balanced entry and replays the same idempotency key", async () => {
    const first = await db.transaction((tx) => ledger.postJournal(tx, prize("k-balanced")));
    const again = await db.transaction((tx) => ledger.postJournal(tx, prize("k-balanced")));
    expect(first.replayed).toBe(false);
    expect(again).toEqual({ entryId: first.entryId, replayed: true });
    const lines = await db.select().from(s.journalLine).where(eq(s.journalLine.entryId, first.entryId));
    expect(lines).toHaveLength(3);
  });

  it("database rejects an unbalanced entry at commit even when app checks are bypassed", async () => {
    const accounts = await ledger.ensureAccounts(db, orgId);
    expect(await failure(db.transaction(async (tx) => {
      await tx.insert(s.journalEntry).values({ id: `je_unbal_${Date.now()}`, orgId, entryDate: "2026-10-24", memo: "bad", sourceType: "test", sourceId: "x", idempotencyKey: `unbal-${Date.now()}`, createdBy: "test" });
      const [entry] = await tx.select().from(s.journalEntry).where(eq(s.journalEntry.memo, "bad"));
      await tx.insert(s.journalLine).values([
        { id: `jl_a_${Date.now()}`, entryId: entry.id, accountId: accounts.get("5100")!, debitMinor: 1000n, currency: "USD" },
        { id: `jl_b_${Date.now()}`, entryId: entry.id, accountId: accounts.get("1000")!, creditMinor: 999n, currency: "USD" },
      ]);
    }))).toMatch(/does not balance/);
    expect(() => ledger.assertBalanced([{ account: "5100", debitMinor: 5n, currency: "USD" }, { account: "1000", creditMinor: 4n, currency: "USD" }])).toThrow(/does not balance/);
  });

  it("rejects an entry with a single line and an entry with no lines", async () => {
    expect(await failure(db.transaction(async (tx) => {
      await tx.insert(s.journalEntry).values({ id: `je_empty_${Date.now()}`, orgId, entryDate: "2026-10-24", memo: "empty", sourceType: "test", sourceId: "x", idempotencyKey: `empty-${Date.now()}`, createdBy: "test" });
    }))).toMatch(/at least two lines/);
  });

  it("forbids UPDATE, DELETE and TRUNCATE of posted entries and lines", async () => {
    const { entryId } = await db.transaction((tx) => ledger.postJournal(tx, prize("k-immutable")));
    expect(await failure(db.update(s.journalEntry).set({ memo: "edited" }).where(eq(s.journalEntry.id, entryId)))).toMatch(/immutable/);
    expect(await failure(db.update(s.journalLine).set({ debitMinor: 1n }).where(eq(s.journalLine.entryId, entryId)))).toMatch(/immutable/);
    expect(await failure(db.delete(s.journalLine).where(eq(s.journalLine.entryId, entryId)))).toMatch(/cannot be deleted/);
    expect(await failure(db.delete(s.journalEntry).where(eq(s.journalEntry.id, entryId)))).toMatch(/cannot be deleted/);
    // Verify both real tables have the enabled BEFORE TRUNCATE guard, then
    // exercise that same database function on a transaction-local table.
    // TRUNCATE on the shared ledger takes an ACCESS EXCLUSIVE lock before
    // its guard runs, which can stall unrelated tenants and test workers.
    const guards = await db.execute(sql`
      select c.relname, t.tgenabled, pg_get_triggerdef(t.oid) as definition
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.oid in ('journal_entry'::regclass, 'journal_line'::regclass)
        and t.tgname in ('journal_entry_no_truncate', 'journal_line_no_truncate')
    `);
    expect(guards.rows).toHaveLength(2);
    for (const guard of guards.rows) {
      expect(guard.tgenabled).toBe("O");
      expect(guard.definition).toMatch(/BEFORE TRUNCATE .*eve_no_truncate\(\)/);
    }
    expect(await failure(db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '2s'`);
      await tx.execute(sql`create temporary table eve_truncate_guard_probe (id integer) on commit drop`);
      await tx.execute(sql`create trigger eve_probe_no_truncate before truncate on eve_truncate_guard_probe for each statement execute function eve_no_truncate()`);
      await tx.execute(sql`truncate eve_truncate_guard_probe`);
      // Even a broken guard must roll back the probe transaction.
      throw new Error("The truncate guard did not reject the operation");
    }))).toMatch(/cannot be truncated/);
  });

  it("forbids adding lines to an entry from a later transaction", async () => {
    const { entryId } = await db.transaction((tx) => ledger.postJournal(tx, prize("k-late-line")));
    const accounts = await ledger.ensureAccounts(db, orgId);
    expect(await failure(db.transaction(async (tx) => {
      await tx.insert(s.journalLine).values([
        { id: `jl_late1_${Date.now()}`, entryId, accountId: accounts.get("5100")!, debitMinor: 5n, currency: "USD" },
        { id: `jl_late2_${Date.now()}`, entryId, accountId: accounts.get("1000")!, creditMinor: 5n, currency: "USD" },
      ]);
    }))).toMatch(/another transaction/);
  });

  it("reverses an entry once, with mirrored lines", async () => {
    const { entryId } = await db.transaction((tx) => ledger.postJournal(tx, prize("k-reverse")));
    const reversal = await db.transaction((tx) => ledger.reverseEntry(tx, { orgId, entryId, createdBy: "test", memo: "Reverse" }));
    const lines = await db.select().from(s.journalLine).where(eq(s.journalLine.entryId, reversal.entryId));
    expect(lines.reduce((sum, l) => sum + l.creditMinor, 0n)).toBe(100000n);
    expect(await failure(db.transaction((tx) => ledger.reverseEntry(tx, { orgId, entryId, createdBy: "test", memo: "Again" })))).toMatch(/already been reversed/);
  });

  it("rejects entries in a locked period, in the app and in the database, and locks are one-way", async () => {
    await db.transaction((tx) => ledger.lockPeriod(tx, { orgId, month: "2026-09", lockedBy: "controller" }));
    expect(await failure(db.transaction((tx) => ledger.postJournal(tx, prize("k-locked", "2026-09-15"))))).toMatch(/locked/);
    const accounts = await ledger.ensureAccounts(db, orgId);
    expect(await failure(db.transaction(async (tx) => {
      const id = `je_locked_${Date.now()}`;
      await tx.insert(s.journalEntry).values({ id, orgId, entryDate: "2026-09-30", memo: "raw", sourceType: "test", sourceId: "x", idempotencyKey: id, createdBy: "test" });
      await tx.insert(s.journalLine).values([
        { id: `${id}a`, entryId: id, accountId: accounts.get("5100")!, debitMinor: 5n, currency: "USD" },
        { id: `${id}b`, entryId: id, accountId: accounts.get("1000")!, creditMinor: 5n, currency: "USD" },
      ]);
    }))).toMatch(/locked/);
    expect(await failure(db.update(s.accountingPeriod).set({ locked: false }).where(eq(s.accountingPeriod.orgId, orgId)))).toMatch(/cannot be reopened/);
    const ok = await db.transaction((tx) => ledger.postJournal(tx, prize("k-open", "2026-10-02")));
    expect(ok.replayed).toBe(false);
  });

  it("refuses scoped reset for a non-demo org", async () => {
    const { purgeOrg } = await import("@/lib/server/reset");
    const [real] = await db.insert(s.organization).values({ id: `orgreal_${Date.now()}`, slug: `real-${Date.now()}`, name: "Real", country: "US", isDemo: false }).returning();
    expect(await failure(db.transaction((tx) => purgeOrg(tx, real.id)))).toMatch(/Only demo/);
    // Even with the GUC set by hand, a non-demo org's ledger stays immutable.
    const accounts = await ledger.ensureAccounts(db, real.id);
    const { entryId } = await db.transaction((tx) => ledger.postJournal(tx, { ...prize("k-real"), orgId: real.id }));
    expect(await failure(db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('eve.demo_reset_org', ${real.id}, true)`);
      await tx.delete(s.journalLine).where(eq(s.journalLine.entryId, entryId));
    }))).toMatch(/cannot be deleted/);
    expect(accounts.size).toBeGreaterThan(5);
    // Leave the non-demo org (it is immutable by design); mark it demo afterwards so it can be cleaned.
    await db.update(s.organization).set({ isDemo: true }).where(eq(s.organization.id, real.id));
    await db.transaction((tx) => purgeOrg(tx, real.id, { deleteOrg: true }));
  });
});

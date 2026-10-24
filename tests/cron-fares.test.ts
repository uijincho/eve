import { describe, expect, it, vi } from "vitest";

// Every query resolves to rows chosen by table; chained builders (.where, .limit) return the same thenable.
const mocks = vi.hoisted(() => {
  const thenable = (rows: unknown[]): unknown => {
    const p = Promise.resolve(rows);
    const chain: unknown = new Proxy(() => {}, { get: (_t, k) => (k === "then" ? p.then.bind(p) : () => chain) });
    return chain;
  };
  return { thenable, trackCheapestFares: vi.fn() };
});

vi.mock("@/lib/agent/webhook-auth", () => ({ verifyBearer: () => true }));
vi.mock("@/lib/agent/automation", () => ({ deliverRecordedNotice: vi.fn() }));
vi.mock("@/lib/agent/triggers", () => ({ queueScheduledRun: vi.fn(async () => "run_1") }));
vi.mock("@/lib/server/bank-verification-delivery", () => ({ deliverBankVerification: vi.fn() }));
vi.mock("@/lib/server/fares", () => ({ trackCheapestFares: mocks.trackCheapestFares }));
vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  return { getDb: () => ({ select: () => ({ from: (table: unknown) => mocks.thenable(table === s.organization ? [{ id: "org_a" }, { id: "org_b" }] : []) }) }) };
});

describe("nightly cron fare tracker", () => {
  it("records fares for every org and keeps going when one org fails", async () => {
    mocks.trackCheapestFares.mockImplementation(async (orgId: string) => {
      if (orgId === "org_b") throw new Error("Organization has no event yet.");
      return { recorded: 3, existing: 0, unavailable: 0, failed: 0, eventStarted: false };
    });
    const { GET } = await import("@/app/api/cron/route");
    const res = await GET(new Request("http://localhost/api/cron", { headers: { authorization: "Bearer x" } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, faresRecorded: 3 });
    expect(mocks.trackCheapestFares).toHaveBeenCalledWith("org_a", { maxOrigins: 15 });
    expect(mocks.trackCheapestFares).toHaveBeenCalledWith("org_b", { maxOrigins: 15 });
  });
});

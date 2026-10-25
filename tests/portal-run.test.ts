import { describe, expect, it } from "vitest";

import type { AppSnapshot, PortalRun } from "@/lib/contracts";
import { fixtureSnapshot } from "@/lib/client/fixture";
import { buildInbox, hasLiveWork, isPortalActive, portalRunFor, portalStatusLine } from "@/lib/client/derive";
import { looksLikeTaxId } from "@/lib/computer-use/guards";
import { packetBrief } from "@/lib/computer-use/packet";
import { PortalPacketError, toPortalPacket, type PacketFacts } from "@/lib/computer-use/portal-packet";

const canadian: PacketFacts = {
  packetId: "sp_123",
  sponsorName: "Bayview Community Foundation",
  eventName: "Bayview Hacks",
  person: { name: "Élise Côté", email: "elise@example.com", country: "CA" },
  taxForm: "W-8BEN",
  signedAt: "2026-10-19T12:00:00.000Z",
  payout: { currency: "USD", grossMinor: 100_000n, withholdingMinor: 30_000n, ruleId: "US-NRA-PRIZE", ruleVersion: 2, ruleVerified: false },
  requestedMinor: 70_000n,
  source: { kind: "award", track: "Best Civic Hack", title: "1st place" },
};

describe("toPortalPacket", () => {
  it("maps a Canadian prize with a W-8BEN to the portal's foreign-payee path", () => {
    const p = toPortalPacket(canadian);
    expect(p.requestType).toBe("Prize or award");
    expect(p.payee).toMatchObject({ name: "Élise Côté", country: "Canada", foreign: true });
    expect(p.payee.taxStatus).toMatch(/Foreign person\. Form W-8BEN on file, signed 2026-10-19/);
    expect(p).toMatchObject({ grossCents: 100_000, withheldCents: 30_000, netCents: 70_000, accountCode: "5300 · Prizes and awards", paymentMethod: "International wire" });
    expect(p.withholdingNote).toContain("30% US federal withholding");
    expect(p.withholdingNote).toContain("unverified");
    expect(p.standsInFor).toBe("Bayview Community Foundation");
    // The portal only accepts a tax form whose file name says W-8BEN.
    expect(p.documents.taxForm).toBe("/home/user/packet/W-8BEN-elise-cote.pdf");
    expect(p.documents.supporting).toBe("/home/user/packet/packet-sp-123.pdf");
    expect(p.purpose.length).toBeGreaterThanOrEqual(10);
  });

  it("sends a US payee down the ACH path with no tax form, so the portal's SSN demand escalates", () => {
    const p = toPortalPacket({ ...canadian, person: { name: "Quinn Davis", email: "quinn@example.com", country: "US" }, taxForm: "W-9", payout: { ...canadian.payout, withholdingMinor: 0n }, requestedMinor: 100_000n });
    expect(p.payee.foreign).toBe(false);
    expect(p.payee.country).toBe("United States");
    expect(p.paymentMethod).toBe("ACH direct deposit (US bank accounts only)");
    expect(p.documents.taxForm).toBeNull();
    expect(p.payee.taxStatus).toMatch(/vault/);
    expect(packetBrief(p)).toMatch(/never gives it to you/);
  });

  it("uses honorarium and reimbursement codes for stipends and claims", () => {
    expect(toPortalPacket({ ...canadian, source: { kind: "award", track: "Judge stipend", title: "Judging" } })).toMatchObject({ requestType: "Honorarium", accountCode: "5400 · Honoraria and stipends" });
    expect(toPortalPacket({ ...canadian, source: { kind: "claim", type: "travel", category: "travel", description: "YYZ to SFO" } })).toMatchObject({ requestType: "Reimbursement", accountCode: "5100 · Travel reimbursement" });
    expect(toPortalPacket({ ...canadian, source: { kind: "claim", type: "expense", category: "food", description: "" } }).accountCode).toBe("5200 · Event supplies and food");
  });

  it("names unlisted countries Other, as the portal's dropdown does", () => {
    expect(toPortalPacket({ ...canadian, person: { ...canadian.person, country: "JP" } }).payee.country).toBe("Other");
  });

  it("refuses non-USD payouts and packets that no longer match their payout", () => {
    expect(() => toPortalPacket({ ...canadian, payout: { ...canadian.payout, currency: "CAD" } })).toThrow(PortalPacketError);
    expect(() => toPortalPacket({ ...canadian, requestedMinor: 69_999n })).toThrow(/no longer matches/);
  });

  it("never puts anything shaped like a taxpayer ID in the brief", () => {
    expect(looksLikeTaxId(packetBrief(toPortalPacket(canadian)))).toBe(false);
  });
});

function withRun(run: Partial<PortalRun>): AppSnapshot {
  const s = fixtureSnapshot();
  const packet = { ...s.packets[0], status: "draft" as const };
  return {
    ...s,
    packets: [packet],
    portalRuns: [{
      id: "prn_1", packetId: packet.id, workflowRunId: "wrun_1", status: "awaiting_approval", page: "review", pageLabel: "Review",
      pagesVisited: ["login", "payee", "payment", "documents", "review"], turns: 14, requestedBy: "u-dana",
      createdAt: s.now, updatedAt: s.now,
      reviewCheck: [{ label: "Net payment", packet: "$700.00", portal: "$700.00", ok: true }, { label: "Payee", packet: "Ana Silva", portal: "Ana Silvia", ok: false }],
      ...run,
    }],
  };
}

describe("portal runs in the inbox and feed", () => {
  it("asks a controller to approve a run waiting on Review, and says what differs", () => {
    const s = withRun({});
    const item = buildInbox(s).find((i) => i.ref.kind === "portal");
    expect(item).toMatchObject({ category: "approvals" });
    expect(item!.tags).toEqual([{ label: "Ready to submit", tone: "positive" }, { label: "1 value differs", tone: "critical" }]);
    expect(item!.meta).toMatch(/^Sponsor portal submission/);
    expect(item!.detail).toMatch(/1 of 2 values match the packet; 1 differ/);
  });

  it("turns an escalation on a draft packet into an exception, and drops it once the packet moves on", () => {
    const escalated = withRun({ status: "escalated", escalation: { field: "Social Security Number", reason: "The payee is a US person; the SSN is vaulted." } });
    const item = buildInbox(escalated).find((i) => i.ref.kind === "portal");
    expect(item).toMatchObject({ category: "exceptions" });
    expect(item!.meta).toContain("Social Security Number");
    const submitted = { ...escalated, packets: escalated.packets.map((k) => ({ ...k, status: "submitted" as const })) };
    expect(buildInbox(submitted).some((i) => i.ref.kind === "portal")).toBe(false);
  });

  it("flags a portal confirmation that Eve could not record", () => {
    const s = withRun({ status: "failed", confirmation: "WB-26-01234", error: "The portal accepted request WB-26-01234, but Eve did not mark the packet submitted." });
    expect(buildInbox(s).find((i) => i.ref.kind === "portal")!.meta).toMatch(/Portal accepted WB-26-01234/);
  });

  it("keeps finished runs out of the inbox", () => {
    for (const status of ["submitted", "rejected", "stopped", "filling"] as const) {
      expect(buildInbox(withRun({ status })).some((i) => i.ref.kind === "portal"), status).toBe(false);
    }
  });

  it("polls fast only while a run is active", () => {
    expect(hasLiveWork(withRun({ status: "filling" }))).toBe(true);
    const done = withRun({ status: "submitted" });
    expect(isPortalActive(done.portalRuns[0])).toBe(false);
    expect((done.portalRuns ?? []).some(isPortalActive)).toBe(false);
  });

  it("finds the newest run for a packet and describes it", () => {
    const s = withRun({});
    const older = { ...s.portalRuns[0], id: "prn_0", status: "failed" as const, createdAt: "2020-01-01T00:00:00.000Z" };
    const both = { ...s, portalRuns: [older, s.portalRuns[0]] };
    expect(portalRunFor(both, s.packets[0].id)?.id).toBe("prn_1");
    expect(portalStatusLine(s.portalRuns[0])).toMatch(/Nothing is submitted until a controller approves/);
  });
});

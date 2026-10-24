import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AppSnapshot } from "@/lib/contracts";
import { fixtureSnapshot } from "@/lib/client/fixture";
import { SponsorView } from "@/components/app/views/sponsor-view";
import { PayoutBreakdown } from "@/components/app/inbox/item-detail";

const state = vi.hoisted(() => ({ snapshot: null as AppSnapshot | null, packetId: "" }));
vi.mock("@/lib/client/use-eve", () => ({
  useEve: () => ({ snapshot: state.snapshot, loading: false, error: null, refresh: vi.fn() }),
  useAction: () => ({ state: { status: "idle" }, pending: false, run: vi.fn() }),
}));
vi.mock("@/lib/client/url-param", () => ({ initialParam: () => state.packetId }));
vi.mock("@/components/app/sheet", () => ({ Sheet: ({ children }: { children: ReactNode }) => children }));

function packetSnapshot(status: AppSnapshot["packets"][number]["status"]) {
  const s = fixtureSnapshot();
  s.org.mode = "sponsor";
  s.actor = s.personas.find((p) => p.role === "controller")!;
  s.packets[0].status = status;
  state.snapshot = s;
  state.packetId = s.packets[0].id;
  return s;
}

describe("sponsor remittance and quote disclosure", () => {
  it("lets a submitted real packet record the amount without seeded remittance data", () => {
    const s = packetSnapshot("submitted");
    s.packets[0].paidMinor = "0";
    const html = renderToStaticMarkup(createElement(SponsorView));
    expect(html).toContain("Amount remitted (USD)");
    expect(html).toContain("Record remittance");
    expect(html).not.toContain("Accept shortfall as a fee");
  });
  it("allows correction of a partial remittance while keeping separate controller acceptance", () => {
    const s = packetSnapshot("exception");
    const html = renderToStaticMarkup(createElement(SponsorView));
    expect(html).toContain("Record remittance");
    expect(html).toContain("including any earlier partial payment");
    expect(html).toContain("Accept shortfall as a fee");
    s.packets[0].paidMinor = (BigInt(s.packets[0].requestedMinor) + 1n).toString();
    const overpaid = renderToStaticMarkup(createElement(SponsorView));
    expect(overpaid).not.toContain("Accept shortfall as a fee");
    expect(overpaid).toContain("An overpayment cannot be accepted as a fee.");
  });
  it("shows the destination rate and substantial recipient fees before release", () => {
    const s = packetSnapshot("submitted");
    const p = { ...s.payouts[0], provider: "mock_wire", currency: "USD", destinationCurrency: "CAD", fxRate: "1.37151000", grossMinor: "3644", withholdingMinor: "0", netMinor: "1144", feeMinor: "2500" };
    const html = renderToStaticMarkup(createElement(PayoutBreakdown, { payout: p }));
    expect(html).toContain("1 USD = 1.37151000 CAD");
    expect(html).toContain("2% FX spread");
    expect(html).toContain("Transfer fees consume at least 10%");
  });
});

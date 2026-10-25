import { describe, expect, it, vi } from "vitest";

import { checkFareMarket, fareQuestion, type MarketSnapshot } from "@/lib/engines";
import { failedCheckText } from "@/lib/client/derive";
import { fixtureInsights, getCheapestFare, getPriceInsights, parseSerpApiInsights, searchDates } from "@/lib/flights/price-insights";

const event = { checkInAt: "2026-10-23T20:30:00.000Z", closingAt: "2026-10-25T22:00:00.000Z", venue: "UC Berkeley" };

describe("price insights providers", () => {
  it("reads SerpApi price_insights into USD minor units, history by day", () => {
    const out = parseSerpApiInsights({
      price_insights: { lowest_price: 302, price_level: "typical", typical_price_range: [280, 420], price_history: [[1790000000, 330], [1789913600, 310], [1789913600, 0]] },
    }, { origin: "YYZ", destination: "SFO", capturedOn: "2026-09-01" });
    expect(out).toMatchObject({ source: "serpapi", truth: "Estimate", typicalLowMinor: "28000", typicalHighMinor: "42000", lowestMinor: "30200", priceLevel: "typical" });
    expect(out!.history).toEqual([{ date: "2026-09-20", minor: "31000" }, { date: "2026-09-21", minor: "33000" }]);
    expect(parseSerpApiInsights({ price_insights: { lowest_price: 300 } }, { origin: "YYZ", destination: "SFO", capturedOn: "2026-09-01" })).toBeNull();
    expect(parseSerpApiInsights({}, { origin: "YYZ", destination: "SFO", capturedOn: "2026-09-01" })).toBeNull();
  });

  it("uses SerpApi only when a key is set, with the event's round-trip dates", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ price_insights: { typical_price_range: [250, 400] } })));
    const live = await getPriceInsights("yyz", event, "2026-09-01", { SERPAPI_API_KEY: "test-key" }, fetchImpl as unknown as typeof fetch);
    expect(live?.typicalHighMinor).toBe("40000");
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ engine: "google_flights", departure_id: "YYZ", arrival_id: "SFO", outbound_date: "2026-10-23", return_date: "2026-10-25", currency: "USD", type: "1" });
    expect(searchDates(event)).toEqual({ outbound: "2026-10-23", inbound: "2026-10-25" });

    const failing = vi.fn(async () => new Response(JSON.stringify({ error: "Invalid API key." }), { status: 401 }));
    await expect(getPriceInsights("YYZ", event, "2026-09-01", { SERPAPI_API_KEY: "bad" }, failing as unknown as typeof fetch)).rejects.toThrow(/Invalid API key/);

    const fixture = await getPriceInsights("YYZ", event, "2026-09-01", {});
    expect(fixture).toEqual(fixtureInsights("YYZ", event, "2026-09-01"));
    expect(await getPriceInsights("SFO", event, "2026-09-01", {})).toBeNull();
  });

  it("builds deterministic simulated insights from the fixture fare table", () => {
    const a = fixtureInsights("YYZ", event, "2026-09-01")!;
    expect(a).toEqual(fixtureInsights("YYZ", event, "2026-09-01"));
    expect(a.truth).toBe("Simulated");
    expect(BigInt(a.typicalLowMinor) < BigInt(a.typicalHighMinor)).toBe(true);
    expect(a.history).toHaveLength(60);
    expect(a.history.at(-1)!.date).toBe("2026-09-01");
    expect(fixtureInsights("ZZZ", event, "2026-09-01")).toBeNull();
  });

  it("tracks the cheapest economy fare from fixtures without a Duffel token", async () => {
    const c = await getCheapestFare("SEA", event, "2026-10-01", {});
    expect(c).toEqual({ origin: "SEA", destination: "SFO", capturedOn: "2026-10-01", source: "fixture", truth: "Simulated", lowestMinor: "14900" });
  });
});

const insights = (capturedOn: string, high: string, history: MarketSnapshot["history"] = []): MarketSnapshot => ({ kind: "insights", capturedOn, source: "fixture", truth: "Simulated", typicalHighMinor: high, history });

describe("market fare check", () => {
  it("flags a fare more than 25% above the typical high from the snapshot before booking", () => {
    const snaps = [insights("2026-08-01", "30000"), insights("2026-09-01", "38000", [{ date: "2026-10-03", minor: "31500" }]), insights("2026-10-10", "50000")];
    const r = checkFareMarket({ usdMinor: 49512n, purchasedAt: "2026-10-03T14:00:00Z", snapshots: snaps });
    expect(r.evidence).toMatchObject({ basis: "typical_high", capturedOn: "2026-09-01", referenceMinor: "38000", deltaMinor: "11512", flagged: true });
    expect(r.evidence?.priceOnDateMinor).toBe("31500");
    expect(r.check?.passed).toBe(false);
    expect(failedCheckText(r.check!)).toBe("High for the market: $495.12 is 30% above the typical high of $380.00 (fare table, 2026-09-01; lowest on the booking date $315.00)");
    // 25% margin: $475.00 passes, $475.01 flags.
    expect(checkFareMarket({ usdMinor: 47500n, purchasedAt: "2026-10-03T14:00:00Z", snapshots: snaps }).check?.passed).toBe(true);
    expect(checkFareMarket({ usdMinor: 47501n, purchasedAt: "2026-10-03T14:00:00Z", snapshots: snaps }).check?.passed).toBe(false);
  });

  it("reports the lowest price on the booking date when the history has it", () => {
    const r = checkFareMarket({ usdMinor: 30000n, purchasedAt: "2026-09-20T09:00:00Z", snapshots: [insights("2026-09-01", "38000", [{ date: "2026-09-20", minor: "29900" }])] });
    expect(r.evidence?.priceOnDateMinor).toBe("29900");
    expect(r.check?.detail).toContain("lowest on the booking date $299.00");
  });

  it("uses the earliest snapshot when every one was taken after booking", () => {
    const r = checkFareMarket({ usdMinor: 30000n, purchasedAt: "2026-07-01T00:00:00Z", snapshots: [insights("2026-09-01", "38000"), insights("2026-08-01", "36000")] });
    expect(r.evidence?.capturedOn).toBe("2026-08-01");
  });

  it("falls back to the tracked cheapest fare with a wider margin", () => {
    const cheapest: MarketSnapshot[] = [{ kind: "cheapest", capturedOn: "2026-10-02", source: "fixture", truth: "Simulated", lowestMinor: "28000" }];
    // 60% over $280 is $448.
    expect(checkFareMarket({ usdMinor: 44800n, purchasedAt: "2026-10-03T00:00:00Z", snapshots: cheapest }).check?.passed).toBe(true);
    const r = checkFareMarket({ usdMinor: 49512n, purchasedAt: "2026-10-03T00:00:00Z", snapshots: cheapest });
    expect(r.evidence).toMatchObject({ basis: "cheapest", referenceMinor: "28000", flagged: true });
    expect(fareQuestion({ usdMinor: 49512n, capMinor: 50000n, route: "YYZ → SFO", market: r.evidence })).toMatch(/^Your YYZ → SFO fare \(\$495\.12\) is about \$215 above the cheapest fare tracked for that route around your booking date \(\$280\.00\)\./);
    // Insights win over the tracker when both exist.
    expect(checkFareMarket({ usdMinor: 49512n, purchasedAt: "2026-10-03T00:00:00Z", snapshots: [...cheapest, insights("2026-09-01", "45000")] }).evidence?.basis).toBe("typical_high");
  });

  it("does nothing without usable snapshots", () => {
    expect(checkFareMarket({ usdMinor: 99999n, purchasedAt: "2026-10-03T00:00:00Z", snapshots: [] })).toEqual({});
    expect(checkFareMarket({ usdMinor: 99999n, purchasedAt: "2026-10-03T00:00:00Z", snapshots: [insights("2026-09-01", "bad")] })).toEqual({});
  });

  it("asks about the market gap when the peer check did not fire", () => {
    const market = checkFareMarket({ usdMinor: 49512n, purchasedAt: "2026-10-03T00:00:00Z", snapshots: [insights("2026-09-01", "38000")] }).evidence;
    expect(fareQuestion({ usdMinor: 49512n, capMinor: 50000n, route: "YYZ → SFO", market })).toMatch(/is about \$115 above the typical price for that route around your booking date \(up to \$380\.00\)\./);
  });
});

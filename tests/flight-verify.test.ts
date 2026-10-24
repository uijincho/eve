import { describe, expect, it } from "vitest";

import type { EventRecord } from "@/lib/contracts";
import { fixtureOffers, type FlightOffer } from "@/lib/flights";
import { offerSigningKeyFromEnv, signOffer, signOffers, verifyFlightRequest } from "@/lib/flights/verify";

const event: Pick<EventRecord, "checkInAt" | "closingAt" | "travelCapMinor" | "economyOnly"> = {
  checkInAt: "2026-10-23T20:30:00Z", closingAt: "2026-10-25T22:00:00Z", travelCapMinor: "50000", economyOnly: true,
};
const key = offerSigningKeyFromEnv({ BETTER_AUTH_SECRET: "x".repeat(40) });
const now = Date.parse("2026-10-01T12:00:00Z");
const duffel: FlightOffer = {
  ...fixtureOffers("YYZ")[0], id: "off_0000AbC", source: "duffel_test", expiresAt: "2026-10-01T12:20:00Z",
};

describe("flight request verification", () => {
  it("resolves fixture offers by id and ignores client price and carrier", async () => {
    const r = await verifyFlightRequest(
      { offerId: "fx_YYZ_1", origin: "YYZ", claimed: { amountMinor: "100", carrier: "Cheap Air", currency: "USD" } },
      { event, now },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.offer.totalMinor).toBe("48900");
    expect(r.offer.carrier).toBe("Air Canada");
    expect(r.mismatches).toEqual(["amount 100 ≠ 48900", "currency USD ≠ CAD", "carrier Cheap Air ≠ Air Canada"]);
    expect(r.policyOk).toBe(true);
    expect(r.truth).toBe("Simulated");
  });

  it("reports policy failures from server data, e.g. a business fare", async () => {
    const r = await verifyFlightRequest({ offerId: "fx_YYZ_4", origin: "YYZ", claimed: { cabin: "economy" } }, { event, now });
    expect(r.ok && r.policyOk).toBe(false);
    expect(r.ok && r.policyReason).toMatch(/business/);
    expect(r.ok && r.mismatches).toEqual(["cabin economy ≠ business"]);
  });

  it("rejects unknown ids, wrong origins and invented fixture ids", async () => {
    expect(await verifyFlightRequest({ offerId: "fx_YYZ_99", origin: "YYZ" }, { event, now })).toMatchObject({ ok: false, code: "unknown_offer" });
    expect(await verifyFlightRequest({ offerId: "fx_YYZ_1", origin: "JFK" }, { event, now })).toMatchObject({ ok: false, code: "origin_mismatch" });
    expect(await verifyFlightRequest({ offerId: "off_x", origin: "YYZ" }, { event, now })).toMatchObject({ ok: false, code: "unknown_offer" });
  });

  it("verifies signed Duffel offers and rejects tampering, swaps and expiry", async () => {
    const token = signOffer(duffel, key, now, event);
    const ok = await verifyFlightRequest({ offerId: duffel.id, origin: "YYZ", offerToken: token }, { event, now: now + 60_000, signingKey: key });
    expect(ok).toMatchObject({ ok: true, source: "signed", truth: "Test mode" });

    const [head, payload, sig] = token.split(".");
    const forged = JSON.parse(Buffer.from(payload, "base64url").toString());
    forged.offer.totalMinor = "100";
    const tampered = `${head}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
    expect(await verifyFlightRequest({ offerId: duffel.id, origin: "YYZ", offerToken: tampered }, { event, now, signingKey: key })).toMatchObject({ ok: false, code: "bad_signature" });

    const otherKey = offerSigningKeyFromEnv({ BETTER_AUTH_SECRET: "y".repeat(40) });
    expect(await verifyFlightRequest({ offerId: duffel.id, origin: "YYZ", offerToken: token }, { event, now, signingKey: otherKey })).toMatchObject({ ok: false, code: "bad_signature" });
    expect(await verifyFlightRequest({ offerId: "off_other", origin: "YYZ", offerToken: token }, { event, now, signingKey: key })).toMatchObject({ ok: false, code: "id_mismatch" });
    // Offer's own expiry (20 min) wins over the 30-minute token TTL.
    expect(await verifyFlightRequest({ offerId: duffel.id, origin: "YYZ", offerToken: token }, { event, now: now + 25 * 60_000, signingKey: key })).toMatchObject({ ok: false, code: "expired" });
    expect(await verifyFlightRequest({ offerId: duffel.id, origin: "YYZ", offerToken: "v1.garbage" }, { event, now, signingKey: key })).toMatchObject({ ok: false, code: "bad_token" });
  });

  it("resolves from a server cache when no token is sent", async () => {
    const cache = { get: (id: string) => (id === duffel.id ? { offer: duffel, fetchedAt: "2026-10-01T12:00:00Z" } : undefined) };
    expect(await verifyFlightRequest({ offerId: duffel.id, origin: "YYZ" }, { event, now, cache })).toMatchObject({ ok: true, source: "cache" });
    expect(signOffers([duffel], key, now, event)[0].offerToken).toMatch(/^v1\./);
    expect(() => offerSigningKeyFromEnv({ BETTER_AUTH_SECRET: "short" })).toThrow();
  });
});

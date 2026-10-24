import { describe, expect, it } from "vitest";

import type { EventRecord } from "@/lib/contracts";
import { destinationFor, fixtureOffers, FIXTURE_ANCHOR, suggestFlights } from "@/lib/flights";
import { eventBinding, offerSigningKeyFromEnv, signOffer, verifyFlightRequest } from "@/lib/flights/verify";

type Evt = Pick<EventRecord, "id" | "venue" | "checkInAt" | "closingAt" | "travelCapMinor" | "economyOnly">;
const key = offerSigningKeyFromEnv({ BETTER_AUTH_SECRET: "x".repeat(40) });
const now = Date.parse("2026-11-01T12:00:00Z");
// A real organization's event a month after Cal Hacks, in Toronto and in San Francisco.
const toronto: Evt = { id: "evt_t", venue: "MaRS Centre, Toronto, ON", checkInAt: "2026-11-20T14:00:00.000Z", closingAt: "2026-11-22T21:00:00.000Z", travelCapMinor: "60000", economyOnly: true };
const sf: Evt = { ...toronto, id: "evt_sf", venue: "Fort Mason, San Francisco, CA", checkInAt: "2026-11-20T21:30:00.000Z", closingAt: "2026-11-22T23:00:00.000Z" };
const HOUR = 3_600_000;

describe("event-relative fixture fares", () => {
  it("leaves the Cal Hacks table unchanged without an event or for its own weekend", () => {
    const anchor = { ...toronto, venue: "Pier 48, San Francisco", ...FIXTURE_ANCHOR };
    expect(fixtureOffers("YYZ", anchor)).toEqual(fixtureOffers("YYZ"));
  });

  it("times offers to the event's own check-in and closing and keeps the same suggestions", () => {
    const offers = fixtureOffers("YYZ", sf);
    const base = fixtureOffers("YYZ");
    const out = Date.parse(sf.checkInAt) - Date.parse(FIXTURE_ANCHOR.checkInAt);
    const back = Date.parse(sf.closingAt) - Date.parse(FIXTURE_ANCHOR.closingAt);
    offers.forEach((o, i) => {
      expect(Date.parse(o.departAt) - Date.parse(base[i].departAt)).toBe(out);
      expect(Date.parse(o.returnDepartAt) - Date.parse(base[i].returnDepartAt)).toBe(back);
      expect(o.totalMinor).toBe(base[i].totalMinor);
      expect(o.destination).toBe("SFO");
    });
    const r = suggestFlights(offers, sf);
    expect(r.options).toHaveLength(3);
    expect(r.truth).toBe("Simulated");
    for (const o of r.options) expect(Date.parse(o.arriveAt)).toBeLessThan(Date.parse(sf.checkInAt));
  });

  it("flies to the venue's city, scaling duration and fare, and offers nothing from the event's own airport", () => {
    expect(destinationFor(toronto.venue)).toEqual({ airport: "YYZ", recognized: true });
    expect(fixtureOffers("YYZ", toronto)).toEqual([]);
    const jfk = fixtureOffers("JFK", toronto);
    expect(jfk.every((o) => o.destination === "YYZ")).toBe(true);
    const sfoBase = fixtureOffers("JFK");
    // New York to Toronto is far shorter than to San Francisco.
    expect((Date.parse(jfk[0].arriveAt) - Date.parse(jfk[0].departAt)) / HOUR).toBeLessThan(3);
    expect(BigInt(jfk[0].totalMinor)).toBeLessThan(BigInt(sfoBase[0].totalMinor));
    expect(suggestFlights(jfk, toronto).options.length).toBeGreaterThan(0);
  });

  it("falls back to SFO, and says so, when the venue names no known city", () => {
    expect(destinationFor("Test")).toEqual({ airport: "SFO", recognized: false });
    expect(fixtureOffers("SEA", { ...sf, venue: "Main hall" })[0].destination).toBe("SFO");
  });
});

describe("offers bound to the event they were searched for", () => {
  const offer = fixtureOffers("YYZ", sf)[0];

  it("accepts a token for the same event and records the server's itinerary", async () => {
    const r = await verifyFlightRequest({ offerId: offer.id, origin: "YYZ", offerToken: signOffer(offer, key, now, sf) }, { event: sf, now: now + 60_000, signingKey: key });
    expect(r).toMatchObject({ ok: true, source: "signed", truth: "Simulated", policyOk: true });
    expect(r.ok && r.offer.departAt).toBe(offer.departAt);
  });

  it("rejects a token after the event's dates or venue change, or from another event", async () => {
    const token = signOffer(offer, key, now, sf);
    for (const changed of [{ ...sf, checkInAt: "2026-11-21T21:30:00.000Z" }, { ...sf, closingAt: "2026-11-23T23:00:00.000Z" }, { ...sf, venue: "Seattle Center" }, { ...sf, id: "evt_other" }]) {
      expect(await verifyFlightRequest({ offerId: offer.id, origin: "YYZ", offerToken: token }, { event: changed, now, signingKey: key })).toMatchObject({ ok: false, code: "event_mismatch" });
    }
  });

  it("checks a token sent with a fixture id instead of trusting the fixture table", async () => {
    const other: Evt = { ...sf, id: "evt_x" };
    const otherEvent = signOffer(fixtureOffers("YYZ", other)[0], key, now, other);
    expect(await verifyFlightRequest({ offerId: offer.id, origin: "YYZ", offerToken: otherEvent }, { event: sf, now, signingKey: key })).toMatchObject({ ok: false, code: "event_mismatch" });
    expect(await verifyFlightRequest({ offerId: offer.id, origin: "YYZ", offerToken: signOffer(offer, key, now, sf) }, { event: sf, now: now + 31 * 60_000, signingKey: key })).toMatchObject({ ok: false, code: "expired" });
  });

  it("rejects tokens without an event binding and tampered bindings", async () => {
    const [head, payload, sig] = signOffer(offer, key, now, sf).split(".");
    const body = JSON.parse(Buffer.from(payload, "base64url").toString());
    const unbound = { ...body };
    delete unbound.evt;
    const swapped = { ...body, evt: eventBinding({ ...sf, id: "evt_x" }) };
    for (const forged of [unbound, swapped]) {
      const t = `${head}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`;
      expect(await verifyFlightRequest({ offerId: offer.id, origin: "YYZ", offerToken: t }, { event: sf, now, signingKey: key })).toMatchObject({ ok: false, code: "bad_signature" });
    }
  });

  it("regenerates a token-less fixture request for the requester's current event", async () => {
    const r = await verifyFlightRequest({ offerId: offer.id, origin: "YYZ" }, { event: sf, now });
    expect(r).toMatchObject({ ok: true, source: "fixture" });
    expect(r.ok && r.offer).toEqual(offer);
  });
});

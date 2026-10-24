import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { EventRecord } from "@/lib/contracts";
import { fixtureOffers, suggestFlights, type FlightOffer } from "@/lib/flights";
import { assertDuffelTestToken, localToUtcIso, normalizeDuffelOffer, searchDuffelOffers } from "@/lib/flights/duffel";
import { MockWireProvider } from "@/lib/payouts/mock-wire";
import { StripeAdapterError, StripeModeError, StripeTestProvider, choosePayoutProvider, stripeFromEnv } from "@/lib/payouts/stripe";
import { pdfSafe, renderFilingDraft, renderPayoutPacket, renderTaxFormReceipt } from "@/lib/pdf";

describe("mock wire provider", () => {
  it("is idempotent on retry and rejects key reuse for a different payout", async () => {
    let now = 1_000;
    const p = new MockWireProvider({ settleAfterMs: 100, now: () => now });
    const rcp = await p.createRecipient("tok_marcus");
    const q = await p.quote(70_000n, "USD", "CAD", "CA");
    expect(q.netReceived.currency).toBe("CAD");
    expect(q.intermediaryFee?.amountMinor).toBe(1500n);
    const a = await p.payout(rcp, q, "payout-123");
    const b = await p.payout(rcp, q, "payout-123");
    expect(b).toEqual(a);
    expect(p.count).toBe(1);
    const other = await p.quote(80_000n, "USD", "CAD", "CA");
    await expect(p.payout(rcp, other, "payout-123")).rejects.toThrow(/already used/);
    expect(await p.status(a)).toBe("pending");
    now += 100;
    expect(await p.status(a)).toBe("paid");
  });

  it("simulates failures and returns, and refuses expired quotes", async () => {
    let now = 0;
    const p = new MockWireProvider({ settleAfterMs: 10, now: () => now });
    const q = await p.quote(10_000n, "USD", "EUR", "DE");
    const failed = await p.payout(await p.createRecipient("fail_bank"), q, "k1");
    expect(await p.status(failed)).toBe("failed");
    const ret = await p.payout(await p.createRecipient("return_bank"), q, "k2");
    now = 20;
    expect(await p.status(ret)).toBe("returned");
    now = 60 * 60 * 1000;
    await expect(p.payout(await p.createRecipient("ok"), q, "k3")).rejects.toThrow(/expired/);
    expect((await p.supports("KP", "KPW")).supported).toBe(false);
  });
});

function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "request-id": "req_test" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("stripe test-mode adapter", () => {
  it("refuses live and missing keys", () => {
    expect(() => new StripeTestProvider({ secretKey: "sk_live_abc" })).toThrow(StripeModeError);
    expect(() => new StripeTestProvider({ secretKey: "rk_live_abc" })).toThrow(StripeModeError);
    expect(() => new StripeTestProvider({ secretKey: "" })).toThrow(StripeModeError);
    expect(stripeFromEnv({ STRIPE_SECRET_KEY: "sk_live_x" })).toBeNull();
    expect(stripeFromEnv({})).toBeNull();
  });

  const platform = (country: string) => ({ id: "acct_platform", country, default_currency: country === "CA" ? "cad" : "usd", payouts_enabled: true });

  it("reads the platform country from Stripe instead of assuming US", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: platform("CA") }));
    const s = new StripeTestProvider({ secretKey: "sk_test_x", fetchImpl: impl });
    const status = await s.verifyPlatform();
    expect(status).toMatchObject({ country: "CA", defaultCurrency: "CAD", payoutsEnabled: true });
    expect(calls[0].url).toBe("https://api.stripe.com/v1/account");
    expect((await s.supports("US", "USD")).supported).toBe(true);
    expect((await s.supports("DE", "EUR")).supported).toBe(true);
    expect((await s.supports("IN", "INR")).supported).toBe(false);
    await expect(s.quote(10_000n, "USD", "INR", "IN")).rejects.toThrow(StripeAdapterError);
  });

  it("only allows domestic payouts from a platform outside the cross-border regions", async () => {
    const s = new StripeTestProvider({ secretKey: "sk_test_x", fetchImpl: fakeFetch(() => ({ body: platform("JP") })).impl });
    expect((await s.supports("JP", "JPY")).supported).toBe(true);
    expect((await s.supports("CA", "CAD")).supported).toBe(false);
  });

  it("falls back to the simulated wire with a reason", async () => {
    expect(await choosePayoutProvider("CA", "CAD", {})).toMatchObject({ provider: "mock_wire", truth: "Simulated" });
    expect((await choosePayoutProvider("CA", "CAD", { STRIPE_SECRET_KEY: "sk_live_x" })).provider).toBe("mock_wire");
    const down = fakeFetch(() => ({ status: 401, body: { error: { message: "Invalid API Key" } } })).impl;
    const r = await choosePayoutProvider("CA", "CAD", { STRIPE_SECRET_KEY: "sk_test_x" }, down);
    expect(r.provider).toBe("mock_wire");
    expect(r.provider === "mock_wire" && r.reason).toMatch(/Invalid API Key/);
    const ok = await choosePayoutProvider("CA", "CAD", { STRIPE_SECRET_KEY: "sk_test_x" }, fakeFetch(() => ({ body: platform("CA") })).impl);
    expect(ok).toMatchObject({ provider: "stripe", truth: "Test mode" });
    const far = await choosePayoutProvider("IN", "INR", { STRIPE_SECRET_KEY: "sk_test_x" }, fakeFetch(() => ({ body: platform("CA") })).impl);
    expect(far.provider).toBe("mock_wire");
  });

  it("surfaces a missing transfers capability instead of faking success", async () => {
    const { impl } = fakeFetch(() => ({ body: { id: "acct_1", capabilities: { transfers: "inactive" }, requirements: { currently_due: ["external_account"] } } }));
    const s = new StripeTestProvider({ secretKey: "sk_test_x", fetchImpl: impl });
    await expect(s.createRecipient("acct_1")).rejects.toMatchObject({ stripeCode: "insufficient_capabilities_for_transfer" });
    await expect(s.createRecipient("tok_vault_123")).rejects.toMatchObject({ stripeCode: "recipient_not_onboarded" });
  });

  it("sends the idempotency key and surfaces Stripe errors", async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith("/v1/transfers")
        ? { status: 400, body: { error: { type: "invalid_request_error", code: "balance_insufficient", message: "Insufficient test balance" } } }
        : url.endsWith("/v1/account")
          ? { body: platform("US") }
          : { body: { id: "acct_1", capabilities: { transfers: "active" } } },
    );
    const s = new StripeTestProvider({ secretKey: "sk_test_x", fetchImpl: impl, now: () => 0 });
    const rcp = await s.createRecipient("acct_1");
    const q = await s.quote(70_000n, "USD", "CAD", "CA");
    await expect(s.payout(rcp, q, "eve-payout-9")).rejects.toMatchObject({ stripeCode: "balance_insufficient", status: 400 });
    const post = calls.find((c) => c.url.endsWith("/v1/transfers"))!;
    expect((post.init.headers as Record<string, string>)["Idempotency-Key"]).toBe("eve-payout-9");
    expect(String(post.init.body)).toContain("destination=acct_1");
    expect(String(post.init.body)).toContain("amount=70000");
  });

  it("refuses live-mode responses and maps reversals to returned", async () => {
    const live = new StripeTestProvider({ secretKey: "sk_test_x", fetchImpl: fakeFetch(() => ({ body: { id: "tr_1", livemode: true } })).impl });
    await expect(live.status({ provider: "stripe", id: "tr_1", idempotencyKey: "k" })).rejects.toThrow(StripeModeError);
    const rev = new StripeTestProvider({ secretKey: "sk_test_x", fetchImpl: fakeFetch(() => ({ body: { id: "tr_1", reversed: true } })).impl });
    expect(await rev.status({ provider: "stripe", id: "tr_1", idempotencyKey: "k" })).toBe("returned");
  });
});

const event: Pick<EventRecord, "checkInAt" | "closingAt" | "travelCapMinor" | "economyOnly"> = {
  checkInAt: "2026-10-23T20:30:00Z", closingAt: "2026-10-25T22:00:00Z", travelCapMinor: "50000", economyOnly: true,
};

describe("flights", () => {
  it("suggests three economy options under the cap timed to the event", () => {
    const r = suggestFlights(fixtureOffers("YYZ"), event);
    expect(r.options).toHaveLength(3);
    expect(r.truth).toBe("Simulated");
    for (const o of r.options) {
      expect(o.cabin).toBe("economy");
      expect(BigInt(o.usdMinor)).toBeLessThanOrEqual(50_000n);
      expect(o.arrivalBufferMinutes).toBeGreaterThanOrEqual(90);
      expect(o.departureBufferMinutes).toBeGreaterThanOrEqual(120);
    }
    const reasons = Object.fromEntries(r.rejected.map((x) => [x.id, x.reason]));
    expect(reasons.fx_YYZ_4).toMatch(/business/);
    expect(reasons.fx_YYZ_5).toMatch(/check-in/);
  });

  it("escalates when nothing fits the cap", () => {
    const r = suggestFlights(fixtureOffers("LHR"), event);
    expect(r.options).toHaveLength(0);
    expect(r.reason).toMatch(/escalate/);
  });

  it("rejects a return that leaves before closing", () => {
    const offer: FlightOffer = { ...fixtureOffers("SEA")[0], id: "early", returnDepartAt: "2026-10-25T21:00:00Z" };
    expect(suggestFlights([offer], event).rejected[0].reason).toMatch(/closing/);
  });

  it("converts Duffel local times with the airport zone and parses amounts exactly", () => {
    expect(localToUtcIso("2026-10-23T07:30:00", "America/Toronto")).toBe("2026-10-23T11:30:00.000Z");
    expect(localToUtcIso("2026-11-02T07:30:00", "America/Los_Angeles")).toBe("2026-11-02T15:30:00.000Z");
    const seg = (d: string, a: string) => ({ departing_at: d, arriving_at: a, origin: { time_zone: "America/Toronto" }, destination: { time_zone: "America/Los_Angeles" } });
    const o = normalizeDuffelOffer({
      id: "off_1", total_amount: "412.30", total_currency: "CAD", owner: { name: "Duffel Airways" },
      slices: [{ segments: [seg("2026-10-23T07:30:00", "2026-10-23T10:00:00")] }, { segments: [{ ...seg("2026-10-25T23:15:00", "2026-10-26T07:00:00"), origin: { time_zone: "America/Los_Angeles" }, destination: { time_zone: "America/Toronto" } }] }],
    }, "economy");
    expect(o?.totalMinor).toBe("41230");
    expect(o?.arriveAt).toBe("2026-10-23T17:00:00.000Z");
    expect(o?.returnDepartAt).toBe("2026-10-26T06:15:00.000Z");
  });

  it("refuses non-test Duffel tokens and surfaces API errors", async () => {
    expect(() => assertDuffelTestToken("duffel_live_x")).toThrow(/test tokens/);
    const { impl, calls } = fakeFetch(() => ({ status: 422, body: { errors: [{ message: "bad origin" }] } }));
    await expect(
      searchDuffelOffers({ origin: "XXX", destination: "SFO", departureDate: "2026-10-23", returnDate: "2026-10-25" }, { token: "duffel_test_x", fetchImpl: impl }),
    ).rejects.toThrow("bad origin");
    expect((calls[0].init.headers as Record<string, string>)["Duffel-Version"]).toBe("v2");
  });
});

describe("pdf drafts", () => {
  const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

  it("renders a W-8BEN receipt with only the last four of the TIN", async () => {
    const bytes = await renderTaxFormReceipt({
      documentId: "doc_1", formType: "W-8BEN", legalName: "Zoë Tremblay", citizenship: "CA", residenceCountry: "CA",
      address: "Montréal, QC", tinLast4: "4321", signedName: "Zoë Tremblay", signedAt: "2026-10-25T14:00:00Z",
      treaty: { country: "Canada", article: "XXII", rate: "0%", verified: false }, expiresAt: "2029-12-31",
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toContain("W-8BEN");
    expect(text(bytes)).toMatch(/^%PDF-/);
  });

  it("renders deterministic packet and filing drafts", async () => {
    const packet = {
      packetId: "pk_1", sponsorName: "Westbrook University", preparedAt: "2026-10-26",
      payee: { name: "Marcus Lee", country: "CA", taxForm: "W-8BEN", taxStatus: "valid", payoutLast4: "1234" },
      source: { type: "award" as const, id: "a1", description: "First Overall" },
      amounts: { currency: "USD", grossMinor: "100000", withholdingMinor: "30000", feeMinor: "375", netMinor: "70000", destinationCurrency: "CAD", destinationNetMinor: "96985", fxRate: "1.385505", fxSource: "ECB 2026-10-23" },
      provider: "stripe", truth: "Test mode", rule: { id: "us-nonus-prize", version: 1, verified: true, reportingForm: "1042-S income code 23" },
      approvals: [{ role: "Controller", name: "Dana Ruiz", at: "2026-10-26T10:00:00Z" }], attachments: ["W-8BEN receipt doc_1"],
    };
    const a = await renderPayoutPacket(packet);
    const b = await renderPayoutPacket(packet);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const filing = await renderFilingDraft({
      form: "1042-S", year: 2026, payer: { name: "Cal Hacks", address: "Berkeley, CA" },
      payee: { name: "Marcus Lee", address: "Toronto, ON", country: "CA" }, currency: "USD", grossMinor: "100000",
      withholdingMinor: "30000", box: "Income code 23 (Other income)", rateBps: 3000, exemptionCode: "00",
      rule: { id: "us-nonus-prize", version: 1, verified: true },
      payments: Array.from({ length: 60 }, (_, i) => ({ date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, description: `Payment ${i}`, grossMinor: "1000" })),
    });
    expect((await PDFDocument.load(filing)).getPageCount()).toBeGreaterThan(1);
  });

  it("replaces characters the standard font cannot encode", () => {
    expect(pdfSafe("−$5 — 李")).toBe("-$5 - ?");
  });
});

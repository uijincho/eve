// Stripe Connect adapter, test mode only. REST over fetch, no SDK.
//
// Refuses any key that is not a test key, so this code cannot move live
// money. Stripe errors (missing transfers capability, insufficient test
// balance, unsupported country) are surfaced as StripeAdapterError, never
// turned into a fake success.
//
// Funds flow: POST /v1/transfers moves funds from the platform balance to a
// connected account (separate charges and transfers / top-ups, which the
// cross-border docs list as supported). The connected account's own payout
// schedule then sends it to their bank. A successful transfer is NOT bank
// settlement: status() reports "pending" until settlementStatus() confirms
// the connected account's payout (GET /v1/payouts/:id on that account) is
// paid, and "returned" if the transfer is reversed.
//
// Cross-border availability, per https://docs.stripe.com/connect/cross-border-payouts
// (read 2026-10-24): "Platforms based in the US, UK, EEA, Canada, or
// Switzerland can transfer funds to connected accounts in any of those
// regions". Accounts under the recipient service agreement cannot receive
// cross-border payouts; those need Global Payouts, which is not implemented.
import { EngineError, currencyExponent } from "@/lib/engines/money";

import type {
  Capability, CountryCode, CurrencyCode, PayoutProvider, PayoutRef, PayoutStatus, ProfileToken, Quote, RecipientRef,
} from "./index";
import { toProviderQuote } from "./provider-quote";

const API = "https://api.stripe.com";

/** US, UK, EEA, Canada and Switzerland. */
export const STRIPE_CROSS_BORDER_COUNTRIES = new Set([
  "US", "GB", "CA", "CH",
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT",
  "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
]);

/**
 * Currencies a connected account in each country can be paid in: its local
 * currency, plus USD for Canadian accounts. Anything else is reported
 * unsupported rather than guessed.
 */
const EUR = ["AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES"];
export const STRIPE_PAYOUT_CURRENCIES: Record<string, string[]> = {
  US: ["USD"], CA: ["CAD", "USD"], GB: ["GBP"], CH: ["CHF"],
  BG: ["BGN", "EUR"], CZ: ["CZK"], DK: ["DKK"], HU: ["HUF"], PL: ["PLN"], RO: ["RON"], SE: ["SEK"],
  IS: ["ISK"], LI: ["CHF"], NO: ["NOK"],
  ...Object.fromEntries(EUR.map((c) => [c, ["EUR"]])),
};

export type StripeSettlement =
  | { state: "transfer_reversed" }
  | { state: "awaiting_bank_payout"; detail: string }
  | { state: "bank_paid"; payoutId: string; arrivalDate?: number }
  | { state: "bank_failed"; payoutId: string; failureCode?: string; failureMessage?: string };

export class StripeAdapterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly stripeCode?: string,
    readonly stripeType?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "StripeAdapterError";
  }
}

export interface StripePlatformStatus {
  accountId: string;
  country: string;
  defaultCurrency: string;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  /** Countries a transfer may reach per the published region list (not a Stripe guarantee). */
  crossBorderRegions: string[];
  notes: string[];
}

export class StripeModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeModeError";
  }
}

export function assertTestKey(key: string | undefined): string {
  if (!key) throw new StripeModeError("Stripe is not configured; use the simulated provider.");
  if (!/^(sk|rk)_test_/.test(key)) {
    throw new StripeModeError("Only Stripe test-mode keys are accepted. Live keys are refused.");
  }
  return key;
}

export interface StripeOptions {
  secretKey?: string;
  /** Override the platform country. By default it is read from GET /v1/account, never assumed. */
  platformCountry?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function form(params: Record<string, string | undefined>): string {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.append(k, v);
  return body.toString();
}

export class StripeTestProvider implements PayoutProvider {
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;
  private platformCountry?: string;
  private platformCurrency?: string;
  private readonly now: () => number;

  constructor(options: StripeOptions = {}) {
    this.key = assertTestKey(options.secretKey ?? process.env.STRIPE_SECRET_KEY);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.platformCountry = options.platformCountry?.toUpperCase();
    this.now = options.now ?? Date.now;
  }

  private async request<T>(
    method: "GET" | "POST", path: string, params?: Record<string, string | undefined>, idempotencyKey?: string, stripeAccount?: string,
  ): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.key}` };
    if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
    if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await this.fetchImpl(`${API}${path}`, {
      method, headers, body: method === "POST" && params ? form(params) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string; type?: string }; livemode?: boolean };
    if (!res.ok) {
      throw new StripeAdapterError(
        body.error?.message ?? `Stripe returned HTTP ${res.status}`,
        res.status, body.error?.code, body.error?.type, res.headers.get("request-id") ?? undefined,
      );
    }
    if (body.livemode === true) throw new StripeModeError("Stripe returned a live-mode object; refusing to continue.");
    return body;
  }

  /**
   * Read the platform account the key belongs to: its country, settlement
   * currency and whether it can pay out. Call this before showing Stripe as
   * available; a key on a Canadian platform is not a US platform.
   */
  async verifyPlatform(): Promise<StripePlatformStatus> {
    const acct = await this.request<{
      id: string; country?: string; default_currency?: string; payouts_enabled?: boolean; charges_enabled?: boolean;
      capabilities?: Record<string, string>;
    }>("GET", "/v1/account");
    const country = (acct.country ?? "").toUpperCase();
    this.platformCountry = country || this.platformCountry;
    this.platformCurrency = (acct.default_currency ?? "").toUpperCase() || this.platformCurrency;
    const crossBorder = STRIPE_CROSS_BORDER_COUNTRIES.has(country);
    const notes: string[] = [];
    if (!country) notes.push("Stripe did not report a platform country.");
    if (!crossBorder) notes.push(`Self-serve cross-border payouts are not available from a ${country || "unknown"} platform.`);
    if (!acct.payouts_enabled) notes.push("Platform payouts are not enabled yet.");
    notes.push("Destination support is per the published region list; Stripe confirms it only when a transfer to a real test connected account succeeds.");
    return {
      accountId: acct.id,
      country,
      defaultCurrency: (acct.default_currency ?? "").toUpperCase(),
      payoutsEnabled: Boolean(acct.payouts_enabled),
      chargesEnabled: Boolean(acct.charges_enabled),
      crossBorderRegions: crossBorder ? [...STRIPE_CROSS_BORDER_COUNTRIES].sort() : [country].filter(Boolean),
      notes,
    };
  }

  private async resolvePlatformCountry(): Promise<string> {
    if (!this.platformCountry) await this.verifyPlatform();
    if (!this.platformCountry) throw new StripeAdapterError("Could not determine the Stripe platform country.", 502, "platform_unknown");
    return this.platformCountry;
  }

  async supports(country: CountryCode, currency: CurrencyCode): Promise<Capability> {
    const c = country.toUpperCase();
    const platform = await this.resolvePlatformCountry();
    const domestic = c === platform;
    const reachable = domestic || (STRIPE_CROSS_BORDER_COUNTRIES.has(platform) && STRIPE_CROSS_BORDER_COUNTRIES.has(c));
    const ccy = currency.toUpperCase();
    let exponent: number | undefined;
    try {
      exponent = currencyExponent(ccy);
    } catch {
      exponent = undefined;
    }
    const currencies = STRIPE_PAYOUT_CURRENCIES[c] ?? (domestic && this.platformCurrency ? [this.platformCurrency] : []);
    const supported = reachable && exponent !== undefined && currencies.includes(ccy);
    return {
      supported,
      rails: supported ? ["stripe_connect_transfer", `bank_account_${ccy.toLowerCase()}`] : [],
      // One whole unit of the payout currency (e.g. $1.00, ¥1).
      minAmount: supported ? { amountMinor: 10n ** BigInt(exponent!), currency: ccy } : null,
      deliveryTime: supported ? { minBusinessDays: 1, maxBusinessDays: domestic ? 2 : 3 } : null,
    };
  }

  async quote(amountMinor: bigint, fromCcy: CurrencyCode, toCcy: CurrencyCode, country: CountryCode): Promise<Quote> {
    const cap = await this.supports(country, toCcy);
    if (!cap.supported) {
      throw new StripeAdapterError(`Stripe cannot pay ${toCcy} to ${country} from a ${this.platformCountry} platform.`, 400, "country_or_currency_unsupported");
    }
    if (cap.minAmount && cap.minAmount.currency === fromCcy && amountMinor < cap.minAmount.amountMinor) {
      throw new StripeAdapterError(`Amount is below Stripe's minimum of ${cap.minAmount.amountMinor} ${fromCcy} minor units.`, 400, "amount_too_small");
    }
    // The fee schedule is the US/CA published estimate; label stays "Estimate".
    return toProviderQuote("stripe", amountMinor, fromCcy, toCcy, country, this.now());
  }

  /**
   * Profile tokens for Stripe recipients are connected account ids (acct_…).
   * The account must already have an active transfers capability; otherwise
   * this throws with Stripe's reason instead of pretending.
   */
  async createRecipient(profileToken: ProfileToken): Promise<RecipientRef> {
    if (!/^acct_[A-Za-z0-9]+$/.test(profileToken)) {
      throw new StripeAdapterError("Recipient has no Stripe connected account yet; create one with createConnectedAccount and finish onboarding.", 400, "recipient_not_onboarded");
    }
    const acct = await this.request<{ id: string; capabilities?: Record<string, string>; requirements?: { currently_due?: string[]; disabled_reason?: string | null } }>(
      "GET", `/v1/accounts/${profileToken}`,
    );
    const transfers = acct.capabilities?.transfers;
    if (transfers !== "active") {
      const due = acct.requirements?.currently_due?.slice(0, 5).join(", ");
      throw new StripeAdapterError(
        `Connected account ${acct.id} cannot receive transfers (transfers capability: ${transfers ?? "not requested"}${due ? `; due: ${due}` : ""}).`,
        409, "insufficient_capabilities_for_transfer",
      );
    }
    return { provider: "stripe", id: acct.id };
  }

  /** Create a test-mode connected account that the platform onboards. Onboarding still has to be completed in Stripe. */
  async createConnectedAccount(input: { country: string; email: string; profileToken: string; idempotencyKey: string }): Promise<{ id: string }> {
    return this.request<{ id: string }>("POST", "/v1/accounts", {
      country: input.country,
      email: input.email,
      "controller[stripe_dashboard][type]": "express",
      "controller[fees][payer]": "application",
      "controller[losses][payments]": "application",
      "capabilities[transfers][requested]": "true",
      "metadata[eve_profile]": input.profileToken,
    }, input.idempotencyKey);
  }

  async payout(recipient: RecipientRef, quote: Quote, idempotencyKey: string): Promise<PayoutRef> {
    if (!idempotencyKey) throw new EngineError("invalid_input", "idempotency key required");
    if (recipient.provider !== "stripe") throw new EngineError("invalid_input", "recipient belongs to another provider");
    if (quote.expiresAt && quote.expiresAt.getTime() < this.now()) throw new EngineError("invalid_input", "quote expired; re-quote before paying");
    const t = await this.request<{ id: string }>("POST", "/v1/transfers", {
      amount: quote.sendAmount.amountMinor.toString(),
      currency: quote.sendAmount.currency.toLowerCase(),
      destination: recipient.id,
      "metadata[eve_idempotency_key]": idempotencyKey,
      "metadata[eve_quote]": quote.id,
    }, idempotencyKey);
    return { provider: "stripe", id: t.id, idempotencyKey };
  }

  /**
   * Transfer state only. A completed transfer means funds reached the
   * connected account's Stripe balance, not the recipient's bank, so this
   * never returns "paid"; use settlementStatus() for bank confirmation.
   */
  async status(payoutRef: PayoutRef): Promise<PayoutStatus> {
    const t = await this.request<{ reversed?: boolean; amount_reversed?: number }>("GET", `/v1/transfers/${payoutRef.id}`);
    if (t.reversed || (t.amount_reversed ?? 0) > 0) return "returned";
    return "pending";
  }

  /**
   * Bank settlement for a transfer. Pass the connected account's payout id
   * (from a payout.paid / payout.failed webhook on that account, or the
   * dashboard) to confirm; without one the result stays awaiting.
   */
  async settlementStatus(payoutRef: PayoutRef, connected?: { accountId: string; payoutId: string }): Promise<StripeSettlement> {
    if ((await this.status(payoutRef)) === "returned") return { state: "transfer_reversed" };
    if (!connected) return { state: "awaiting_bank_payout", detail: "Transfer reached the connected account; no bank payout confirmed yet." };
    if (!/^acct_[A-Za-z0-9]+$/.test(connected.accountId) || !/^po_[A-Za-z0-9]+$/.test(connected.payoutId)) {
      throw new EngineError("invalid_input", "connected account and payout ids must be acct_… and po_…");
    }
    const po = await this.request<{ id: string; status?: string; arrival_date?: number; failure_code?: string | null; failure_message?: string | null }>(
      "GET", `/v1/payouts/${connected.payoutId}`, undefined, undefined, connected.accountId,
    );
    if (po.status === "paid") return { state: "bank_paid", payoutId: po.id, arrivalDate: po.arrival_date };
    if (po.status === "failed" || po.status === "canceled") {
      return { state: "bank_failed", payoutId: po.id, failureCode: po.failure_code ?? undefined, failureMessage: po.failure_message ?? undefined };
    }
    return { state: "awaiting_bank_payout", detail: `Connected payout ${po.id} is ${po.status ?? "unknown"}.` };
  }
}

/** Configured test provider, or null when no test key is present. Never throws for a missing key. */
export function stripeFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): StripeTestProvider | null {
  const key = env.STRIPE_SECRET_KEY;
  if (!key || !/^(sk|rk)_test_/.test(key)) return null;
  return new StripeTestProvider({ secretKey: key, fetchImpl, platformCountry: env.STRIPE_PLATFORM_COUNTRY });
}

export type PayoutProviderChoice =
  | { provider: "stripe"; truth: "Test mode"; adapter: StripeTestProvider; platform: StripePlatformStatus }
  | { provider: "mock_wire"; truth: "Simulated"; reason: string };

/**
 * Pick Stripe test mode when a test key is configured, the platform verifies,
 * and the destination country is reachable; otherwise fall back to the
 * simulated wire and say why. Never throws for configuration problems.
 */
export async function choosePayoutProvider(
  destinationCountry: string,
  destinationCurrency: string,
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: typeof fetch,
): Promise<PayoutProviderChoice> {
  if (env.STRIPE_SECRET_KEY && !/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) {
    return { provider: "mock_wire", truth: "Simulated", reason: "STRIPE_SECRET_KEY is not a test key; refusing it and simulating." };
  }
  const adapter = stripeFromEnv(env, fetchImpl);
  if (!adapter) return { provider: "mock_wire", truth: "Simulated", reason: "No Stripe test key configured; simulated wire." };
  try {
    const platform = await adapter.verifyPlatform();
    const cap = await adapter.supports(destinationCountry, destinationCurrency);
    if (!cap.supported) {
      return { provider: "mock_wire", truth: "Simulated", reason: `Stripe ${platform.country} platform cannot pay ${destinationCountry}; simulated wire.` };
    }
    return { provider: "stripe", truth: "Test mode", adapter, platform };
  } catch (e) {
    return { provider: "mock_wire", truth: "Simulated", reason: `Stripe check failed (${(e as Error).message}); simulated wire.` };
  }
}

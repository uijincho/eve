// Simulated SWIFT wire provider. No money moves. Fees and FX come from the
// mock_wire fee schedule in quote.ts; payouts are idempotent on their key and
// settle on a simulated clock so the demo can show pending → paid.
import { EngineError } from "@/lib/engines/money";

import type {
  Capability, CountryCode, CurrencyCode, PayoutProvider, PayoutRef, PayoutStatus, ProfileToken, Quote, RecipientRef,
} from "./index";
import { toProviderQuote } from "./provider-quote";

interface StoredPayout {
  ref: PayoutRef;
  recipient: RecipientRef;
  amountMinor: bigint;
  currency: string;
  createdAt: number;
}

export interface MockWireOptions {
  /** Milliseconds until a simulated wire settles. */
  settleAfterMs?: number;
  now?: () => number;
  /** Countries the simulated bank refuses. */
  blockedCountries?: string[];
}

export class IdempotencyConflictError extends EngineError {
  constructor(key: string) {
    super("invalid_input", `idempotency key ${key} was already used for a different payout`);
  }
}

export class MockWireProvider implements PayoutProvider {
  private readonly payouts = new Map<string, StoredPayout>();
  private readonly settleAfterMs: number;
  private readonly now: () => number;
  private readonly blocked: Set<string>;

  constructor(options: MockWireOptions = {}) {
    this.settleAfterMs = options.settleAfterMs ?? 5_000;
    this.now = options.now ?? Date.now;
    this.blocked = new Set(options.blockedCountries ?? ["KP", "IR", "CU", "SY"]);
  }

  async supports(country: CountryCode, currency: CurrencyCode = "USD"): Promise<Capability> {
    const supported = !this.blocked.has(country.toUpperCase());
    return {
      supported,
      rails: supported ? [`swift_wire_${currency.toLowerCase()}`] : [],
      minAmount: supported ? { amountMinor: 100n, currency: "USD" } : null,
      deliveryTime: supported ? { minBusinessDays: 2, maxBusinessDays: 5 } : null,
    };
  }

  async quote(amountMinor: bigint, fromCcy: CurrencyCode, toCcy: CurrencyCode, country: CountryCode): Promise<Quote> {
    return toProviderQuote("mock_wire", amountMinor, fromCcy, toCcy, country, this.now());
  }

  async createRecipient(profileToken: ProfileToken): Promise<RecipientRef> {
    if (!profileToken) throw new EngineError("invalid_input", "profile token required");
    return { provider: "mock_wire", id: `mockrcp_${profileToken}` };
  }

  async payout(recipient: RecipientRef, quote: Quote, idempotencyKey: string): Promise<PayoutRef> {
    if (!idempotencyKey) throw new EngineError("invalid_input", "idempotency key required");
    const existing = this.payouts.get(idempotencyKey);
    if (existing) {
      const same = existing.recipient.id === recipient.id
        && existing.amountMinor === quote.sendAmount.amountMinor
        && existing.currency === quote.sendAmount.currency;
      if (!same) throw new IdempotencyConflictError(idempotencyKey);
      return existing.ref;
    }
    if (quote.expiresAt && quote.expiresAt.getTime() < this.now()) {
      throw new EngineError("invalid_input", "quote expired; re-quote before paying");
    }
    const ref: PayoutRef = { provider: "mock_wire", id: `mockwire_${this.payouts.size + 1}_${idempotencyKey.slice(0, 24)}`, idempotencyKey };
    this.payouts.set(idempotencyKey, {
      ref, recipient, amountMinor: quote.sendAmount.amountMinor, currency: quote.sendAmount.currency, createdAt: this.now(),
    });
    return ref;
  }

  async status(payoutRef: PayoutRef): Promise<PayoutStatus> {
    const stored = this.payouts.get(payoutRef.idempotencyKey);
    if (!stored || stored.ref.id !== payoutRef.id) throw new EngineError("invalid_input", `unknown payout ${payoutRef.id}`);
    // Recipient tokens can plant failures for the answer key.
    if (stored.recipient.id.includes("fail")) return "failed";
    if (stored.recipient.id.includes("return")) return this.now() - stored.createdAt >= this.settleAfterMs ? "returned" : "pending";
    return this.now() - stored.createdAt >= this.settleAfterMs ? "paid" : "pending";
  }

  /** Number of distinct payouts created, for tests and the demo scoreboard. */
  get count(): number {
    return this.payouts.size;
  }
}

// Payout providers sit behind one interface so the agent can quote every
// provider that supports a recipient's country, and each payout shows the
// winner what they will actually receive before anyone approves it.
//
// Implementations to come: stripe.ts (Stripe Connect, test mode),
// mock-wire.ts (simulated SWIFT fees and deductions), sponsor-packet.ts
// (PDF/CSV packet for fiscal sponsors).

/** ISO 3166-1 alpha-2 country code, e.g. "US", "CA". */
export type CountryCode = string;

/** ISO 4217 currency code, e.g. "USD", "CAD". */
export type CurrencyCode = string;

/** Money as integer minor units (e.g. cents) plus its currency. Never a float. */
export interface Money {
  amountMinor: bigint;
  currency: CurrencyCode;
}

/**
 * A decimal number serialized as a string so it never passes through a float.
 * FX rates are stored as numeric(18,8).
 */
export type DecimalString = string;

/** Providers named in the PRD. Wise, PayPal, and gift cards are stubs. */
export type PayoutProviderId =
  | "stripe"
  | "mock_wire"
  | "sponsor_packet"
  | "wise"
  | "paypal"
  | "gift_card";

/** Vault token for a person's payout profile. Never raw bank details. */
export type ProfileToken = string;

/** Expected delivery window in business days. */
export interface DeliveryTime {
  minBusinessDays: number;
  maxBusinessDays: number;
}

/** What a provider can do for one country and currency. */
export interface Capability {
  supported: boolean;
  /** Rails the provider can use here, e.g. "bank_account", "swift_wire". */
  rails: string[];
  /** Smallest payout accepted, or null if there is no minimum. */
  minAmount: Money | null;
  /** Expected delivery window, or null if unknown. */
  deliveryTime: DeliveryTime | null;
}

/**
 * Fee and FX estimate for one payout. Fee tables are seeded from providers'
 * published pricing, so quotes are labeled as estimates in the UI.
 */
export interface Quote {
  /** Provider-scoped quote id, passed back to payout(). */
  id: string;
  provider: PayoutProviderId;
  /** Amount sent, in the source currency. */
  sendAmount: Money;
  /** Fee charged by the provider. */
  providerFee: Money;
  /** Expected intermediary bank deductions (e.g. on SWIFT wires), if any. */
  intermediaryFee: Money | null;
  /** Expected fee charged by the receiving bank, if any. */
  receivingFee: Money | null;
  /** Source-to-destination FX rate; "1" when no conversion happens. */
  fxRate: DecimalString;
  /** FX spread over the mid-market rate as a fraction, e.g. "0.005"; null when no conversion happens. */
  fxSpread: DecimalString | null;
  /** Amount the recipient is expected to receive, in the destination currency. */
  netReceived: Money;
  deliveryTime: DeliveryTime | null;
  isEstimate: boolean;
  /** When the quoted FX rate stops being valid, or null if it does not expire. */
  expiresAt: Date | null;
}

/** A recipient created at the provider from a vault profile token. */
export interface RecipientRef {
  provider: PayoutProviderId;
  /** Provider's recipient id, e.g. a Stripe connected account id. */
  id: string;
}

/** A payout submitted to a provider. */
export interface PayoutRef {
  provider: PayoutProviderId;
  /** Provider's payout or transfer id. */
  id: string;
  /** Derived from the Eve payout id, so a retry never pays twice. */
  idempotencyKey: string;
}

export type PayoutStatus = "pending" | "paid" | "failed" | "returned";

export interface PayoutProvider {
  /** Rails, minimum amount, and delivery time for a country and currency. */
  supports(country: CountryCode, currency: CurrencyCode): Promise<Capability>;

  /** Fee, FX rate, spread, and net received for sending `amountMinor` of `fromCcy`. */
  quote(
    amountMinor: bigint,
    fromCcy: CurrencyCode,
    toCcy: CurrencyCode,
    country: CountryCode,
  ): Promise<Quote>;

  createRecipient(profileToken: ProfileToken): Promise<RecipientRef>;

  payout(
    recipient: RecipientRef,
    quote: Quote,
    idempotencyKey: string,
  ): Promise<PayoutRef>;

  status(payoutRef: PayoutRef): Promise<PayoutStatus>;
}

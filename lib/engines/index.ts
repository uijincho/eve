// Deterministic financial engines: exact money, tax, claim policy, payout
// quotes, fulfillment and flight recommendations. Pure functions over the
// JSON contracts in lib/contracts.ts; no database or network access except
// the explicitly named adapters.
export * from "./money";
export * from "./policy";
export * from "./fulfillment";
export * from "./splits";
export {
  computeTax,
  selectRule,
  grossUp,
  formFamily,
  w8ExpiresAt,
  formValidity,
  aggregateYtdByForm,
  stateRuleFlags,
  startingRules,
  SOURCE_URLS,
  PAYMENT_TYPES,
  type ComputeTaxInput,
  type ComputeTaxResult,
  type PaymentType,
  type PaymentRecord,
  type StateFlag,
  type FormValidity,
} from "@/lib/tax";
export {
  quotePayout,
  compareQuotes,
  FEE_SCHEDULES,
  type QuotePayoutInput,
  type QuotePayoutResult,
  type FeeSchedule,
} from "@/lib/payouts/quote";
export { CACHED_FX, crossRate, withSpread, fetchReferenceRates, type FxSnapshot } from "@/lib/payouts/fx";
export { planPayout, type PlanPayoutInput, type PlanPayoutResult, type PayoutAmounts } from "./plan";
export { TAX_SCENARIOS, type TaxScenario } from "./fixtures";

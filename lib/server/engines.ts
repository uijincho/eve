// The backend's single boundary to the deterministic engines (lib/engines,
// owned by the engine worker). No financial policy lives here: services call
// the canonical engine functions and convert at the edge (engines take and
// return minor-unit strings; the database stores bigint).

export {
  aggregateYtdByForm,
  checkClaim,
  computeTax,
  formFamily,
  selectRule,
  formValidity,
  quotePayout,
  recommendFulfillment,
  splitAward,
  startingRules,
  w8ExpiresAt,
  type CheckClaimResult,
  type ComputeTaxResult,
  type QuotePayoutResult,
  type FulfillmentResult,
} from "@/lib/engines";

/** Engine payment types for an award or claim. */
export function paymentTypeFor(source: { kind: "claim" } | { kind: "award"; awardKind: "cash" | "item"; track: string; fulfillment: string }): string {
  if (source.kind === "claim") return "reimbursement";
  if (/stipend|judge|mentor|speaker/i.test(source.track)) return "stipend";
  // An item converted to its cash equivalent is paid (and taxed) as cash.
  return source.awardKind === "item" && source.fulfillment !== "cash" ? "item_prize" : "cash_prize";
}

export const big = (v: string | number | bigint | null | undefined): bigint => BigInt(v ?? 0);

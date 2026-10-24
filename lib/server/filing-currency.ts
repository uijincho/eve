/** Filing amounts follow their form's jurisdiction, independently of the USD ledger. */
export function filingCurrency(form: string): "USD" | "CAD" {
  return form === "T4A" || form === "NR4" ? "CAD" : "USD";
}

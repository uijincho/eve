// Display formatting for money stored as integer minor units.

export type MinorUnits = bigint | number;

function fractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en-US", { style: "currency", currency })
      .resolvedOptions().maximumFractionDigits ?? 2
  );
}

export function minorToDecimalString(
  amountMinor: MinorUnits,
  currency: string,
): Intl.StringNumericLiteral {
  const minor = BigInt(amountMinor);
  const digits = fractionDigits(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const scale = 10n ** BigInt(digits);
  const whole = (abs / scale).toString();
  const frac = digits ? `.${(abs % scale).toString().padStart(digits, "0")}` : "";
  return `${negative ? "-" : ""}${whole}${frac}` as Intl.StringNumericLiteral;
}

/** $1,299.00 · CA$679.40 · −$389.70 */
export function formatMoney(
  amountMinor: MinorUnits,
  currency = "USD",
  { signDisplay = "auto" }: { signDisplay?: "auto" | "always" | "exceptZero" } = {},
): string {
  // Intl formats decimal strings exactly, so no float touches the amount.
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    signDisplay,
  }).format(minorToDecimalString(amountMinor, currency));
  // A true minus sign sets better than a hyphen next to figures.
  return formatted.replace("-", "−");
}

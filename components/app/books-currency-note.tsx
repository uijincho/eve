import type { AppSnapshot } from "@/lib/contracts";
import { booksCurrency } from "@/lib/client/derive";

/**
 * For an organization whose working currency is not the books currency: says
 * which amounts are entered in which currency, so a USD total never reads as
 * the org's own currency.
 */
export function BooksCurrencyNote({ snapshot: s, className }: { snapshot: AppSnapshot; className?: string }) {
  const books = booksCurrency(s);
  if (s.org.currency === books) return null;
  return (
    <p className={className ?? "max-w-[64ch] text-small text-muted-foreground"}>
      Books are in {books}. Enter limits, caps and prizes in {s.org.currency}; totals show in {books}, converted on the payment date.
    </p>
  );
}

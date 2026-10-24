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
      Eve keeps the books in {books}. You enter limits, the travel cap, budget caps and prizes in {s.org.currency}; payouts, budgets and
      people&rsquo;s totals show in {books}, converted on the payment date, and each recipient is paid in their own currency.
    </p>
  );
}

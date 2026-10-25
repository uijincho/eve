import type { AppSnapshot, Payout } from "./contracts";

/** Binds the release button to the displayed quote; shared by browser and server. */
export function batchQuoteKey(p: { id: string; personId: string; grossMinor: string | bigint; withholdingMinor: string | bigint; currency: string; destinationCurrency: string; fxRate: string; ruleId: string; ruleVersion: number; ruleVerified: boolean; bankVersion?: string | number | null }) {
  return JSON.stringify([p.id, p.personId, String(p.grossMinor), String(p.withholdingMinor), p.currency, p.destinationCurrency, Number(p.fxRate).toFixed(8), p.ruleId, p.ruleVersion, p.ruleVerified, String(p.bankVersion ?? "")]);
}
export function batchBlocker(p: Payout, s: AppSnapshot): string | null {
  if (!["proposed", "approved"].includes(p.status)) return p.reason || `Payment is ${p.status}.`;
  if (p.provider === "in_kind") return "This prize is delivered as an item.";
  if (p.currency !== "USD") return "The demo portal accepts USD requests.";
  const packet = s.packets.find((k) => k.payoutId === p.id);
  if (packet && packet.status !== "draft") return `Packet is ${packet.status}.`;
  if (packet && s.portalRuns.some((r) => r.packetId === packet.id && ["starting", "filling", "awaiting_approval", "submitting"].includes(r.status))) return "A portal run is already handling this payout.";
  const person = s.people.find((v) => v.id === p.personId);
  if (person && !person.adult) return "Recipient must be 18 or older.";
  if (person && person.taxStatus !== "valid" && p.sourceType === "award") return "A valid tax form is required.";
  if (person && person.country !== "US" && (person.taxStatus !== "valid" || !person.taxForm.startsWith("W-8"))) return "The sponsor portal requires a valid W-8 form for this recipient.";
  const claim = s.claims.find((c) => c.id === p.sourceId);
  if (claim?.type === "travel" && person?.role === "hacker" && (person.projectStatus === "none" || (person.projectStatus === "unknown" && s.now >= s.event.closingAt))) return "Project submission must be confirmed.";
  if (s.actor.role === "controller" && (p.requestedBy === s.actor.id || p.personId === s.actor.personId || person?.email.toLowerCase() === s.actor.email.toLowerCase())) return "Another controller must release this payment.";
  return null;
}

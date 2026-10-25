/**
 * Turns a drafted sponsor packet into what the portal agent enters. Pure, so the mapping is
 * unit tested without a database; portal-run.ts loads the facts.
 */
import { ACCOUNT_CODES, dollars, PACKET_DIR, portalCountry, slug, type PortalPacket } from "./packet";

export interface PacketFacts {
  packetId: string;
  sponsorName: string;
  eventName: string;
  person: { name: string; email: string; country: string };
  /** The current tax form on file, e.g. "W-8BEN" or "W-9"; null when none. */
  taxForm: string | null;
  signedAt: string | null;
  payout: { currency: string; grossMinor: bigint; withholdingMinor: bigint; ruleId: string; ruleVersion: number; ruleVerified: boolean };
  requestedMinor: bigint;
  source:
    | { kind: "award"; track: string; title: string }
    | { kind: "claim"; type: string; category: string; description: string };
}

export class PortalPacketError extends Error {}

const STIPEND = /stipend|judge|mentor|speaker/i;

function cents(minor: bigint): number {
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < 0n) throw new PortalPacketError("The amount is out of range for the portal.");
  return Number(minor);
}

export function toPortalPacket(f: PacketFacts): PortalPacket {
  if (f.payout.currency !== "USD") throw new PortalPacketError(`The Westbrook portal takes USD requests only; this payout is in ${f.payout.currency}.`);
  if (f.requestedMinor !== f.payout.grossMinor - f.payout.withholdingMinor) throw new PortalPacketError("The packet no longer matches its payout. Draft a new packet first.");
  const foreign = f.person.country.toUpperCase() !== "US" && !!f.taxForm?.startsWith("W-8");
  const stipend = f.source.kind === "award" && STIPEND.test(f.source.track);
  const requestType: PortalPacket["requestType"] = f.source.kind === "claim" ? "Reimbursement" : stipend ? "Honorarium" : "Prize or award";
  const accountCode = f.source.kind === "award"
    ? stipend ? ACCOUNT_CODES.stipends : ACCOUNT_CODES.prizes
    : f.source.type === "travel" || f.source.category === "travel" ? ACCOUNT_CODES.travel
      : /food|suppl/i.test(f.source.category) ? ACCOUNT_CODES.supplies : ACCOUNT_CODES.other;
  const description = f.source.kind === "award"
    ? `${f.eventName}, ${f.source.track}: ${f.source.title}`
    : `${f.eventName}, ${f.source.category || f.source.type} reimbursement${f.source.description ? ` (${f.source.description})` : ""}`;
  const gross = cents(f.payout.grossMinor);
  const withheld = cents(f.payout.withholdingMinor);
  const rate = gross > 0 ? Math.round((withheld / gross) * 1000) / 10 : 0;
  const rule = `rule ${f.payout.ruleId} v${f.payout.ruleVersion}${f.payout.ruleVerified ? "" : ", unverified"}`;
  const withholdingNote = withheld > 0 ? `${rate}% US federal withholding from Eve's tax engine (${rule})` : `No withholding (${rule})`;
  const signed = f.signedAt ? `, signed ${f.signedAt.slice(0, 10)}` : "";
  const name = slug(f.person.name);
  return {
    id: f.packetId,
    standsInFor: f.sponsorName || "the fiscal sponsor",
    requestType,
    payee: {
      name: f.person.name,
      email: f.person.email,
      country: portalCountry(f.person.country),
      foreign,
      taxStatus: foreign
        ? `Foreign person. Form ${f.taxForm} on file${signed}. No SSN or ITIN.`
        : `US person. Form ${f.taxForm ?? "W-9"} on file${signed}. Eve keeps the taxpayer ID in its vault and will not give it to you.`,
    },
    description,
    grossCents: gross,
    withheldCents: withheld,
    netCents: gross - withheld,
    withholdingNote,
    accountCode,
    paymentMethod: foreign ? "International wire" : "ACH direct deposit (US bank accounts only)",
    purpose: `${description}. ${withheld > 0 ? `${rate}% US federal withholding applied${f.taxForm ? ` per Form ${f.taxForm}` : ""}.` : "No withholding applies."} Eve packet ${f.packetId}.`,
    documents: {
      supporting: `${PACKET_DIR}/packet-${slug(f.packetId)}.pdf`,
      taxForm: foreign ? `${PACKET_DIR}/W-8BEN-${name}.pdf` : null,
    },
  };
}

/** For a summary line: what the packet asks the portal for. */
export function portalRequestLine(p: PortalPacket): string {
  return `${p.payee.name}, $${dollars(p.netCents)} net (${p.accountCode})`;
}

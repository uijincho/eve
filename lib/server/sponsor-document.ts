import { renderPayoutPacket } from "@/lib/pdf";
import { convertMinor } from "@/lib/engines/money";
import { effectiveTaxStatus, expectedForm, type OrgRow, type PersonRow, type PayoutRow, type ProfileRow, type MethodRow } from "./core";

/** Shared PDF content for individual and bulk drafts; no database or model calls. */
export async function renderSponsorDocument(id: string, org: OrgRow, person: PersonRow, payout: PayoutRow, profile?: ProfileRow, method?: MethodRow, now = new Date()) {
  const requested = payout.grossMinor - payout.withholdingMinor;
  const converts = payout.destinationCurrency !== payout.currency;
  return renderPayoutPacket({
    packetId: id, sponsorName: org.sponsorName || "Fiscal sponsor", preparedAt: now.toISOString(),
    payee: { name: person.name, country: person.country, taxForm: profile?.form ?? expectedForm(person, org.country), taxStatus: effectiveTaxStatus(profile, now), payoutLast4: method?.last4 },
    source: { type: payout.sourceType, id: (payout.claimId ?? payout.awardId)!, description: payout.reason.slice(0, 120) },
    amounts: { currency: payout.currency, grossMinor: payout.grossMinor.toString(), withholdingMinor: payout.withholdingMinor.toString(), feeMinor: "0", netMinor: requested.toString(), destinationCurrency: payout.destinationCurrency, destinationNetMinor: convertMinor(requested, payout.currency, payout.destinationCurrency, payout.fxRate).toString(), fxRate: payout.fxRate, ...(converts ? { fxSource: "payout's quoted rate; estimate, the sponsor's rate may differ" } : {}) },
    provider: "sponsor_packet", truth: "Simulated", rule: { id: payout.ruleId, version: payout.ruleVersion, verified: payout.ruleVerified, reportingForm: payout.reportingForm ?? undefined },
    approvals: [], attachments: [],
  });
}

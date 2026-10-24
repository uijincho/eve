// Starting rule set. Every rate and threshold here was read from the cited
// primary source on 2026-10-24 (see lib/tax/SOURCES.md for the quoted text).
// Rules we could not confirm carry `verified: false`; the engine holds any
// payout that depends on one until a person reviews it.
//
// payeeCountry: an ISO code, "*" for anyone, or "NONUS" / "NONCA" for anyone
// not resident in that country. paymentType: cash_prize | item_prize |
// stipend | reimbursement, with ":treaty" for a W-8BEN treaty claim and
// "backup" for US backup withholding.
import type { TaxRule } from "@/lib/contracts";

const I1099 = "https://www.irs.gov/instructions/i1099mec";
const P1099 = "https://www.irs.gov/publications/p1099";
const P515 = "https://www.irs.gov/publications/p515";
const I1042S = "https://www.irs.gov/instructions/i1042s";
const CA_TREATY = "https://www.irs.gov/pub/irs-trty/canada.pdf";
const FTB_NR = "https://www.ftb.ca.gov/pay/withholding/withholding-on-nonresidents.html";
const CRA_T4A = "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/completing-filing-information-returns/t4a-information-payers/t4a-slip.html";
const CRA_NR = "https://www.canada.ca/en/revenue-agency/services/tax/international-non-residents/payments-non-residents.html";

export const startingRules: TaxRule[] = [
  // US payer, US person, 2025 payments: the $600 threshold that the 2026
  // instructions say was replaced "for tax years beginning after 2025".
  {
    id: "us-us-prize-2025", version: 1, payerCountry: "US", payeeCountry: "US", paymentType: "cash_prize",
    rateBps: 0, thresholdMinor: "60000", form: "W-9", reportingForm: "1099-MISC box 3", verified: true,
    sourceUrl: P1099, effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31",
    explanation: "Prizes and awards are other income on Form 1099-MISC box 3. For 2025 payments the threshold was $600; Pub. 1099 (2026) records the increase from $600.",
  },
  {
    id: "us-us-prize", version: 2, payerCountry: "US", payeeCountry: "US", paymentType: "cash_prize",
    rateBps: 0, thresholdMinor: "200000", form: "W-9", reportingForm: "1099-MISC box 3", verified: true,
    sourceUrl: I1099, effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31",
    explanation: "No withholding with a valid W-9 and TIN. 2026 Instructions for Forms 1099-MISC and 1099-NEC, box 3: \"Enter other income of $2,000 or more\". Indexed for inflation from 2027, so this rule ends 2026-12-31.",
  },
  {
    id: "us-us-item-prize", version: 1, payerCountry: "US", payeeCountry: "US", paymentType: "item_prize",
    rateBps: 0, thresholdMinor: "200000", form: "W-9", reportingForm: "1099-MISC box 3", verified: true,
    sourceUrl: I1099, effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31",
    explanation: "An item prize is reported at fair market value as other income in box 3, same $2,000 threshold as cash prizes. It shares the 1099-MISC aggregate with cash prizes, not with 1099-NEC stipends.",
  },
  {
    id: "us-us-stipend", version: 1, payerCountry: "US", payeeCountry: "US", paymentType: "stipend",
    rateBps: 0, thresholdMinor: "200000", form: "W-9", reportingForm: "1099-NEC box 1", verified: true,
    sourceUrl: I1099, effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31",
    explanation: "Judge or mentor fees for services are nonemployee compensation: \"Enter nonemployee compensation (NEC) of $2,000 or more.\" This is a separate form and a separate aggregate from 1099-MISC prizes.",
  },
  {
    id: "us-us-backup", version: 1, payerCountry: "US", payeeCountry: "US", paymentType: "backup",
    rateBps: 2400, thresholdMinor: "200000", form: "W-9", reportingForm: "Backup withholding (Form 945)", verified: true,
    sourceUrl: P1099, effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31",
    explanation: "Pub. 1099 (2026) part N: reportable payments \"may be subject to backup withholding at a 24% rate\" when \"The payee fails to furnish his or her TIN\". The threshold for payments subject to backup withholding increased to $2,000 for 2026.",
  },
  {
    id: "us-nonus-prize", version: 1, payerCountry: "US", payeeCountry: "NONUS", paymentType: "cash_prize",
    rateBps: 3000, thresholdMinor: "0", form: "W-8BEN", reportingForm: "1042-S income code 23", verified: true,
    sourceUrl: P515, effectiveFrom: "2026-01-01",
    explanation: "Pub. 515 (2026): \"Most types of U.S. source income received by a foreign person are subject to U.S. tax of 30%\"; prizes and awards are listed under chapter 3 withholding. The 2026 1042-S instructions say \"You must file a Form 1042-S even if you did not withhold tax\", so there is no dollar threshold. Income code 23 (Other income) is our reading; Appendix A has no prize-specific code. Assumes the prize is U.S. source (US payer, US event).",
  },
  {
    id: "us-nonus-item-prize", version: 1, payerCountry: "US", payeeCountry: "NONUS", paymentType: "item_prize",
    rateBps: 3000, thresholdMinor: "0", form: "W-8BEN", reportingForm: "1042-S income code 23", verified: true,
    sourceUrl: P515, effectiveFrom: "2026-01-01",
    explanation: "Same 30% chapter 3 default on fair market value. Tax cannot be withheld out of an item, so the org pays it on top (gross-up) or offers cash.",
  },
  {
    id: "us-ca-prize-treaty", version: 1, payerCountry: "US", payeeCountry: "CA", paymentType: "cash_prize:treaty",
    rateBps: 0, thresholdMinor: "0", form: "W-8BEN", reportingForm: "1042-S income code 23, exemption code 04", verified: false,
    sourceUrl: CA_TREATY, effectiveFrom: "2026-01-01",
    explanation: "Unresolved. A Canadian winner may claim a treaty reduction on W-8BEN line 10, but US-Canada treaty Article XXII(1) lets the source country tax other income (\"it may also be taxed in that other State\") with no rate cap, and IRS Treaty Table 1 (Rev. May 2023) lists no prize rate for Canada. Whether Article VII (business profits, no US permanent establishment) applies depends on facts. Hold for advisor review; do not apply the claimed 0%.",
  },
  {
    id: "us-ca-item-prize-treaty", version: 1, payerCountry: "US", payeeCountry: "CA", paymentType: "item_prize:treaty",
    rateBps: 0, thresholdMinor: "0", form: "W-8BEN", reportingForm: "1042-S income code 23, exemption code 04", verified: false,
    sourceUrl: CA_TREATY, effectiveFrom: "2026-01-01",
    explanation: "Unresolved for the same reason as the cash prize treaty claim.",
  },
  {
    id: "us-nonus-stipend", version: 1, payerCountry: "US", payeeCountry: "NONUS", paymentType: "stipend",
    rateBps: 3000, thresholdMinor: "0", form: "W-8BEN", reportingForm: "1042-S (income code to verify)", verified: false,
    sourceUrl: P515, effectiveFrom: "2026-01-01",
    explanation: "Unresolved. Pay for personal services performed in the US by a nonresident follows separate rules (Form 8233, graduated withholding, treaty personal-services articles). 30% shown as a ceiling only; hold for review.",
  },
  {
    id: "any-reimbursement", version: 1, payerCountry: "US", payeeCountry: "*", paymentType: "reimbursement",
    rateBps: 0, thresholdMinor: "0", form: "Profile form", reportingForm: "None (advisor review)", verified: false,
    sourceUrl: P515, effectiveFrom: "2026-01-01",
    explanation: "Unverified default: substantiated travel reimbursements to attendees are treated as not reportable and not withheld. Attendees are not employees, so accountable-plan rules do not obviously apply. Shown as an unverified rule; the payout is not held for this alone.",
  },
  {
    id: "us-ca-state-nonresident", version: 1, payerCountry: "US-CA", payeeCountry: "*", paymentType: "cash_prize",
    rateBps: 700, thresholdMinor: "150000", form: "Form 590 / 592-B", reportingForm: "FTB Form 592", verified: false,
    sourceUrl: FTB_NR, effectiveFrom: "2026-01-01",
    explanation: "Unresolved state layer. FTB says payers must withhold 7% of California-source income to nonresidents that exceeds $1,500 in a calendar year, and lists \"Prizes and winnings received by nonresidents for contests in California\". Whether a hackathon prize is a contest prize for this purpose, and whether a foreign payee is already covered by federal withholding, needs review. Flag only; not added to withholding.",
  },
  {
    id: "ca-ca-prize", version: 1, payerCountry: "CA", payeeCountry: "CA", paymentType: "cash_prize",
    rateBps: 0, thresholdMinor: "50000", form: "SIN (token)", reportingForm: "T4A (box to verify)", verified: false,
    sourceUrl: CRA_T4A, effectiveFrom: "2026-01-01",
    explanation: "Unresolved. CRA reports other amounts on T4A code 028 when the year's total is more than $500 or tax was deducted, but whether a contest prize is income at all (versus a windfall) and which code applies needs a Canadian advisor. Hold for review.",
  },
  {
    id: "ca-nonca-prize", version: 1, payerCountry: "CA", payeeCountry: "NONCA", paymentType: "cash_prize",
    rateBps: 0, thresholdMinor: "0", form: "Residency declaration", reportingForm: "NR4 (to verify)", verified: false,
    sourceUrl: CRA_NR, effectiveFrom: "2026-01-01",
    explanation: "Unresolved. Part XIII or Regulation 105 withholding may apply to payments to non-residents; no rate is assumed. Hold for review.",
  },
  // Canadian payer: every rule below is unverified and holds until a controller resolves it
  // (payout.resolveRule) or an advisor verifies it. No rate is assumed beyond what CRA pages state.
  {
    id: "ca-any-reimbursement", version: 1, payerCountry: "CA", payeeCountry: "*", paymentType: "reimbursement",
    rateBps: 0, thresholdMinor: "0", form: "Residency declaration", reportingForm: "None (advisor review)", verified: false,
    sourceUrl: CRA_T4A, effectiveFrom: "2026-01-01",
    explanation: "Unverified default, mirroring any-reimbursement: a Canadian payer repays substantiated travel costs without withholding or a slip. Whether a T4A applies to reimbursements paid to non-employees needs a Canadian advisor. Not held for this alone.",
  },
  {
    id: "ca-ca-stipend", version: 1, payerCountry: "CA", payeeCountry: "CA", paymentType: "stipend",
    rateBps: 0, thresholdMinor: "50000", form: "SIN (token)", reportingForm: "T4A (box to verify)", verified: false,
    sourceUrl: CRA_T4A, effectiveFrom: "2026-01-01",
    explanation: "Unresolved. Fees for services paid to a Canadian resident may be reported on a T4A when the year's total is more than $500 or tax was deducted (CRA T4A slip page); the box and whether the judge or mentor is self-employed need review. Hold for review.",
  },
  {
    id: "ca-nonca-stipend", version: 1, payerCountry: "CA", payeeCountry: "NONCA", paymentType: "stipend",
    rateBps: 0, thresholdMinor: "0", form: "Residency declaration", reportingForm: "NR4 (to verify)", verified: false,
    sourceUrl: CRA_NR, effectiveFrom: "2026-01-01",
    explanation: "Unresolved. Services rendered in Canada by a non-resident can fall under Regulation 105 withholding; CRA's non-resident payments page lists it, but no rate is assumed here. Hold for review.",
  },
  {
    id: "ca-ca-item-prize", version: 1, payerCountry: "CA", payeeCountry: "CA", paymentType: "item_prize",
    rateBps: 0, thresholdMinor: "50000", form: "SIN (token)", reportingForm: "T4A (box to verify)", verified: false,
    sourceUrl: CRA_T4A, effectiveFrom: "2026-01-01",
    explanation: "Unresolved, same as ca-ca-prize for a non-cash prize at fair market value. Hold for review.",
  },
  {
    id: "ca-nonca-item-prize", version: 1, payerCountry: "CA", payeeCountry: "NONCA", paymentType: "item_prize",
    rateBps: 0, thresholdMinor: "0", form: "Residency declaration", reportingForm: "NR4 (to verify)", verified: false,
    sourceUrl: CRA_NR, effectiveFrom: "2026-01-01",
    explanation: "Unresolved, same as ca-nonca-prize for a non-cash prize at fair market value. Hold for review.",
  },
];

export const SOURCE_URLS = { I1099, P1099, P515, I1042S, CA_TREATY, FTB_NR, CRA_T4A, CRA_NR } as const;

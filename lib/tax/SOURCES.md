# Tax rule sources

Read on 2026-10-24 from primary sources. Quotes are verbatim. A rule is `verified: true` only when its rate, threshold and form are stated in a source below. Everything else is `verified: false`, and the engine holds the payout for review (reimbursements excepted, see below).

## Verified

| Rule | Source | What it says |
| --- | --- | --- |
| `us-us-prize`, `us-us-item-prize` (1099-MISC box 3, $2,000, 2026) | [Instructions for Forms 1099-MISC and 1099-NEC](https://www.irs.gov/instructions/i1099mec) (Revised 12/2026) | Box 3: "Enter other income of $2,000 or more required to be reported on Form 1099-MISC." For tax years beginning after 2025 the minimum threshold increased to $2,000 and "may be adjusted for inflation beginning in calendar year 2027." |
| `us-us-stipend` (1099-NEC, $2,000) | Same | "Enter nonemployee compensation (NEC) of $2,000 or more." Separate form, separate box, separate aggregate. |
| `us-us-prize-2025` ($600) | [Pub. 1099 (2026)](https://www.irs.gov/publications/p1099) | The threshold "increased to $2,000"; "The previous threshold was $600." Kept as a dated v1 rule so 2025 decisions stay explainable. |
| `us-us-backup` (24%) | Pub. 1099 (2026), part N | Payments "may be subject to backup withholding at a 24% rate" when "The payee fails to furnish his or her TIN to you". The minimum threshold for payments "subject to backup withholding" increased to $2,000. |
| `us-nonus-prize`, `us-nonus-item-prize` (30%, no threshold) | [Pub. 515 (2026)](https://www.irs.gov/publications/p515); [Instructions for Form 1042-S (2026)](https://www.irs.gov/instructions/i1042s) | "Most types of U.S. source income received by a foreign person are subject to U.S. tax of 30%." Prizes and awards appear under "Other Grants, Prizes, and Awards Subject to Chapter 3 Withholding"; prizes are "received as the result of entering a contest." 1042-S: "You must file a Form 1042-S even if you did not withhold tax under chapter 3". Appendix A income code 23 is "Other income"; there is no prize-specific code. |
| W-8BEN validity | [Instructions for Form W-8BEN](https://www.irs.gov/instructions/iw8ben) (Rev. 10/2021) | Remains in effect until "the last day of the third succeeding calendar year", and a change in circumstances must be reported "within 30 days". Implemented as `w8ExpiresAt`. |

## Official forms shipped with Eve

| File | Source | Notes |
| --- | --- | --- |
| `lib/tax/forms/fw8ben.pdf` | [Form W-8BEN (Rev. October 2021)](https://www.irs.gov/pub/irs-pdf/fw8ben.pdf), downloaded 2026-10-25, SHA-256 `b821dc1172c91b348a65675529cc792782f11fc1ae8579df92d627113203f918` | US government work, unmodified. `lib/pdf/w8ben.ts` fills it (field map by widget position and the XFA labels), flattens it, prints the foreign TIN as "On file, ending 1234" and appends Eve's signature record. The Part III text in `lib/tax/w8ben.ts` is copied verbatim from this file. When the IRS revises the form, replace the PDF, re-check the field map, and update `W8BEN_REVISION`. |

## Unresolved (verified: false)

| Rule | Why it is not verified |
| --- | --- |
| `us-ca-prize-treaty` | [US-Canada treaty](https://www.irs.gov/pub/irs-trty/canada.pdf) Article XXII(1): other income "shall be taxable only in that State, except that if such income arises in the other Contracting State it may also be taxed in that other State." No rate cap in that paragraph (the 15% cap in XXII(2) is for estate and trust distributions). [IRS Treaty Table 1](https://www.irs.gov/pub/irs-lbi/tax-treaty-table-1.pdf) (Rev. May 2023) has no prize column. Whether Article VII applies depends on facts. The engine shows the 30% default next to the claim and holds. |
| `us-nonus-stipend` | Pay for services performed in the US by a nonresident uses Form 8233, graduated withholding and personal-services treaty articles. Not modelled. |
| `any-reimbursement` | Attendees are not employees, so the accountable-plan exclusion is not clearly available. Default: not reported, not withheld, labelled unverified. **Not held**, so travel claims still flow; a person should confirm before year-end. |
| `us-ca-state-nonresident` | [FTB: withholding on nonresidents](https://www.ftb.ca.gov/pay/withholding/withholding-on-nonresidents.html): 7% of California-source income over $1,500 a year, including "Prizes and winnings received by nonresidents for contests in California." Whether a hackathon prize counts, and how it interacts with federal withholding for foreign payees, is open. `stateRuleFlags` raises a review flag and never adds withholding. |
| `ca-ca-prize` | [CRA T4A slip](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/completing-filing-information-returns/t4a-information-payers/t4a-slip.html): code 028 for other amounts when the total is more than $500 or tax was deducted. Whether a contest prize is income or a windfall needs a Canadian advisor. |
| `ca-nonca-prize` | Part XIII or Regulation 105 may apply. No rate assumed. |

## Limits of the model

- Prizes are treated as US-source because the payer and event are in the US. Sourcing for a remote winner of a US contest was not researched further.
- Backup withholding applies to the full payment once the year's same-form total reaches the threshold. The IRS rules on the exact payment that triggers it were not modelled further.
- Withholding is rounded half up to the cent. IRS forms allow whole-dollar rounding on returns, which we do not apply.
- Rules for 2027 do not exist yet (the $2,000 threshold is inflation-indexed from 2027), so 2027 US payments hold until a rule is added.

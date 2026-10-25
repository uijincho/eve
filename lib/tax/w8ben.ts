// Facts about the official Form W-8BEN that both the server renderer
// (lib/pdf/w8ben.ts) and the portal use. Plain data only, safe for client
// bundles. The PDF itself is lib/tax/forms/fw8ben.pdf (see SOURCES.md).

export const W8BEN_REVISION = "Rev. October 2021";
export const W8BEN_SOURCE_URL = "https://www.irs.gov/pub/irs-pdf/fw8ben.pdf";

/** Line 10 "type of income" for a hackathon prize. */
export const W8BEN_INCOME_TYPE = "Prize and award income";

/** Basis points to the line 10 percentage: 0 -> "0", 1500 -> "15", 1250 -> "12.5". */
export function treatyRateText(rateBps: number): string {
  return String(Number((rateBps / 100).toFixed(2)));
}

/**
 * Part III certification, verbatim from Form W-8BEN (Rev. October 2021).
 * `items` are the form's bullets; a nested array is a bullet's (a)-(d) list.
 */
export const W8BEN_CERTIFICATION = {
  intro:
    "Under penalties of perjury, I declare that I have examined the information on this form and to the best of my knowledge and belief it is true, correct, and complete. I further certify under penalties of perjury that:",
  items: [
    "I am the individual that is the beneficial owner (or am authorized to sign for the individual that is the beneficial owner) of all the income or proceeds to which this form relates or am using this form to document myself for chapter 4 purposes;",
    "The person named on line 1 of this form is not a U.S. person;",
    [
      "This form relates to:",
      "(a) income not effectively connected with the conduct of a trade or business in the United States;",
      "(b) income effectively connected with the conduct of a trade or business in the United States but is not subject to tax under an applicable income tax treaty;",
      "(c) the partner’s share of a partnership’s effectively connected taxable income; or",
      "(d) the partner’s amount realized from the transfer of a partnership interest subject to withholding under section 1446(f);",
    ],
    "The person named on line 1 of this form is a resident of the treaty country listed on line 9 of the form (if any) within the meaning of the income tax treaty between the United States and that country; and",
    "For broker transactions or barter exchanges, the beneficial owner is an exempt foreign person as defined in the instructions.",
  ] as (string | string[])[],
  closing:
    "Furthermore, I authorize this form to be provided to any withholding agent that has control, receipt, or custody of the income of which I am the beneficial owner or any withholding agent that can disburse or make payments of the income of which I am the beneficial owner. I agree that I will submit a new form within 30 days if any certification made on this form becomes incorrect.",
  capacity: "I certify that I have the capacity to sign for the person identified on line 1 of this form.",
} as const;

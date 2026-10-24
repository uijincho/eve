// Named tax scenarios for the demo, seed and answer key. Each states the
// outcome a reviewer expects and why, so the scoreboard compares engine
// output with a reasoned expectation rather than with itself.
import type { ComputeTaxInput } from "@/lib/tax";

export interface TaxScenario {
  id: string;
  title: string;
  input: ComputeTaxInput;
  expect: { ruleId: string; withholdingMinor: string; hold: boolean; reportable: boolean; ruleVerified: boolean };
  why: string;
}

const us2026 = { payerCountry: "US", year: 2026, ytdMinor: "0", hasValidForm: true, hasTin: true } as const;

export const TAX_SCENARIOS: TaxScenario[] = [
  {
    id: "ca-default-30",
    title: "Canadian winner, $1,000 cash, W-8BEN, no treaty claim",
    input: { ...us2026, payeeCountry: "CA", paymentType: "cash_prize", grossMinor: "100000" },
    expect: { ruleId: "us-nonus-prize", withholdingMinor: "30000", hold: false, reportable: true, ruleVerified: true },
    why: "Pub. 515: 30% on U.S.-source income to a foreign person; 1042-S is filed at any amount.",
  },
  {
    id: "ca-treaty-unresolved",
    title: "Canadian winner, $1,000 cash, W-8BEN claims treaty exemption",
    input: { ...us2026, payeeCountry: "CA", paymentType: "cash_prize", grossMinor: "100000", treatyClaim: true },
    expect: { ruleId: "us-ca-prize-treaty", withholdingMinor: "0", hold: true, reportable: true, ruleVerified: false },
    why: "Treaty Article XXII(1) still lets the US tax other income and Table 1 has no prize rate; held for advisor review with the 30% default shown alongside.",
  },
  {
    id: "ca-expired-w8",
    title: "Canadian winner with an expired W-8BEN",
    input: { ...us2026, payeeCountry: "CA", paymentType: "cash_prize", grossMinor: "50000", hasValidForm: false },
    expect: { ruleId: "us-nonus-prize", withholdingMinor: "15000", hold: true, reportable: true, ruleVerified: true },
    why: "Missing or expired forms hold the payout and trigger a chase; they are not silently defaulted.",
  },
  {
    id: "us-cross-2000",
    title: "US winner crossing $2,000 on 1099-MISC with a second prize",
    input: { ...us2026, payeeCountry: "US", paymentType: "cash_prize", grossMinor: "60000", ytdMinor: "150000" },
    expect: { ruleId: "us-us-prize", withholdingMinor: "0", hold: false, reportable: true, ruleVerified: true },
    why: "Box 3 threshold is $2,000 for 2026 payments, aggregated per payee on the same form.",
  },
  {
    id: "us-prize-plus-stipend",
    title: "US judge with $1,500 prizes and a $1,500 stipend",
    input: { ...us2026, payeeCountry: "US", paymentType: "stipend", grossMinor: "150000", ytdMinor: "0" },
    expect: { ruleId: "us-us-stipend", withholdingMinor: "0", hold: false, reportable: false, ruleVerified: true },
    why: "1099-NEC and 1099-MISC are separate forms with separate $2,000 thresholds; $3,000 combined is not reportable on either.",
  },
  {
    id: "us-no-tin-backup",
    title: "US winner, $2,500, W-9 without TIN",
    input: { ...us2026, payeeCountry: "US", paymentType: "cash_prize", grossMinor: "250000", hasTin: false },
    expect: { ruleId: "us-us-prize", withholdingMinor: "60000", hold: false, reportable: true, ruleVerified: true },
    why: "Pub. 1099 part N: 24% backup withholding when the payee fails to furnish a TIN on a reportable payment.",
  },
];

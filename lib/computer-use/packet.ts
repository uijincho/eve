/**
 * The fictional sponsor packet the lab hands to the portal agent. In the product this
 * comes from a drafted sponsor_packet row; here it is fixed so the demo needs no database.
 * No taxpayer ID or bank number appears anywhere in it.
 */

export type ScenarioId = "w8ben-retry" | "strict-ssn";

export interface Scenario {
  id: ScenarioId;
  label: string;
  summary: string;
  /** What a judge should see happen. */
  expected: string;
  strictSsn: boolean;
}

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  "w8ben-retry": {
    id: "w8ben-retry",
    label: "Canadian winner: W-8BEN retry",
    summary: "Fills every page. The portal rejects the documents page until Form W-8BEN is attached; Eve attaches it and stops on Review.",
    expected: "Stops on Review, waits for controller approval, then submits and records the confirmation number.",
    strictSsn: false,
  },
  "strict-ssn": {
    id: "strict-ssn",
    label: "Strict portal: SSN required",
    summary: "The portal demands a Social Security Number for every payee. The payee is Canadian and has none.",
    expected: "Refuses to invent an SSN and escalates to the controller. Nothing is submitted.",
    strictSsn: true,
  },
};

export const PORTAL_URL = "http://127.0.0.1:8080/";
export const PORTAL_USERNAME = "eve.calhacks";
export const PACKET_DIR = "/home/user/packet";

export const DEMO_PACKET = {
  id: "SP-DEMO-0417",
  sponsor: "Westbrook University Student Organization Finance (fictional)",
  requestType: "Prize or award",
  payee: {
    name: "Maya Tremblay",
    email: "maya.tremblay@example.com",
    country: "Canada",
    taxStatus: "Foreign person. Form W-8BEN on file, signed 2026-10-19. No SSN or ITIN.",
  },
  prize: "Cal Hacks 13.0, First Overall (cash in place of the item prize)",
  grossCents: 100_000,
  withheldCents: 30_000,
  netCents: 70_000,
  withholdingNote: "30% US withholding: the Canada treaty rate is unverified, so the default applies.",
  accountCode: "5300 · Prizes and awards",
  paymentMethod: "International wire",
  purpose: "Cal Hacks 13.0 First Overall prize, paid as cash. 30% US federal withholding applied per Form W-8BEN.",
  documents: {
    supporting: `${PACKET_DIR}/award-letter-maya-tremblay.pdf`,
    taxForm: `${PACKET_DIR}/W-8BEN-maya-tremblay.pdf`,
  },
} as const;

export function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** The packet as the model reads it. Plain text keeps the prompt stable for caching. */
export function packetBrief(): string {
  const p = DEMO_PACKET;
  return [
    `Sponsor packet ${p.id}`,
    `Portal: ${PORTAL_URL} (${p.sponsor})`,
    `Portal username: ${PORTAL_USERNAME} (the password is held by Eve; use the type_portal_password tool)`,
    "",
    `Request type: ${p.requestType}`,
    `Payee legal name: ${p.payee.name}`,
    `Payee email: ${p.payee.email}`,
    `Country of tax residence: ${p.payee.country}`,
    `Tax status: ${p.payee.taxStatus}`,
    `Prize: ${p.prize}`,
    `Gross amount (USD): ${dollars(p.grossCents)}`,
    `Federal tax withheld (USD): ${dollars(p.withheldCents)}`,
    `Net payment (USD): ${dollars(p.netCents)} (${p.withholdingNote})`,
    `Account code: ${p.accountCode}`,
    `Payment method: ${p.paymentMethod}`,
    `Business purpose: ${p.purpose}`,
    "",
    "Documents on this computer:",
    `- Supporting document (award letter): ${p.documents.supporting}`,
    `- Tax form (Form W-8BEN): ${p.documents.taxForm}`,
  ].join("\n");
}

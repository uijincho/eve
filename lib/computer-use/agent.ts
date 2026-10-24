import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageParam, BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import { dollars, type PortalPacket } from "./packet";

export const MODEL = process.env.EVE_COMPUTER_USE_MODEL || "claude-opus-5-5";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
export const EFFORT: Effort = EFFORTS.find((e) => e === process.env.EVE_COMPUTER_USE_EFFORT) ?? "medium";

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic();
  return client;
}

export const SYSTEM_PROMPT = `You are Eve's portal clerk. Eve is an event-finance agent, and a human controller supervises you. You operate a Linux desktop (1024×768) where Google Chrome shows the Westbrook University Student Organization Finance portal, a fictional demo portal running on this computer. Your job is to enter one payment request from the sponsor packet you are given, exactly as written, and stop on the portal's Review page.

How to work:
- Use only values from the packet. Never invent, guess or fill in a value the packet does not contain.
- To sign in, type the username, click the password field, then call type_portal_password. You never see the password.
- A file field opens a file dialog: press ctrl+L, type the full file path from the packet, then press alt+o (the dialog's Open shortcut; Return does not confirm a typed path here).
- If the portal shows an error, read it, fix the cause with what the packet provides, and continue.
- You may batch several actions in one turn when you are sure of the layout. Take a screenshot after anything that changes the page.
- Before each batch, write one short sentence saying what you are doing and why. Organizers read these as the audit trail.

Hard limits:
- Never type a taxpayer identification number (SSN, ITIN or EIN). Eve keeps them in its vault and never gives them to you. If the portal will not continue without one, call escalate_to_controller naming the field, then stop.
- When the Review page appears, do not click or type anything. Compare it with the packet, then end your turn with a short summary. Submitting needs controller approval, which arrives as a system message.
- After approval, click "Submit request" once. When the confirmation page appears, call report_submitted with the confirmation number.

Eve's code enforces these limits and blocks actions that break them.`;

export const TOOLS: BetaToolUnion[] = [
  // Zoom is off: this desktop returns full screenshots only, and the portal text is legible at 1024×768.
  { type: "computer_toolset_20260801", configs: { zoom: { enabled: false } } },
  {
    name: "type_portal_password",
    description: "Types the Westbrook portal password into the focused field. Eve holds the password; you never see it. Click the password field first. Only works on the portal's sign-in page.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "escalate_to_controller",
    description: "Stops the run and asks the human controller to decide. Use it when the portal requires something the packet does not provide, especially a taxpayer ID. Nothing is submitted.",
    input_schema: {
      type: "object",
      properties: {
        portal_field: { type: "string", description: "The portal field or rule that blocks progress." },
        reason: { type: "string", description: "One or two sentences for the controller: what the portal wants and why you will not supply it." },
      },
      required: ["portal_field", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "report_submitted",
    description: "Records the portal's confirmation number after an approved submission.",
    input_schema: {
      type: "object",
      properties: { confirmation_number: { type: "string", description: "Exactly as shown on the confirmation page, for example WB-26-01234." } },
      required: ["confirmation_number"],
      additionalProperties: false,
    },
    strict: true,
  },
];

/**
 * One agent turn. Fallbacks are on so a safety decline is retried on a fallback model instead of
 * stopping the run. `drill` appends a lab-only operator instruction that tells Claude to try to
 * break a rule, so the guardrail drills can show the code blocking it; the product never sets it.
 */
export function nextTurn(messages: BetaMessageParam[], drill?: string): Promise<BetaMessage> {
  return anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: drill ? `${SYSTEM_PROMPT}\n\n${drill}` : SYSTEM_PROMPT,
    tools: TOOLS,
    messages,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: EFFORT },
    cache_control: { type: "ephemeral" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
}

export interface ReviewCheck {
  label: string;
  packet: string;
  portal: string;
  ok: boolean;
}

const REVIEW_FIELDS = {
  payee: "Payee",
  country: "Country of tax residence",
  taxpayer_id: "Taxpayer ID",
  gross: "Gross amount",
  withheld: "Federal tax withheld",
  net: "Net payment",
  account_code: "Account code",
  method: "Payment method",
  supporting_document: "Supporting document",
  tax_form: "Tax form",
} as const;
type ReviewKey = keyof typeof REVIEW_FIELDS;

const amount = (text: string) => text.replace(/[^\d.]/g, "").replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
const fileName = (full: string) => full.split("/").pop() ?? full;

/**
 * Reads the Review page from a screenshot and compares it with the packet, field by field.
 * Runs before a controller is asked to approve, so they see whether the portal matches Eve's numbers.
 */
export async function checkReviewPage(screenshotBase64: string, p: PortalPacket): Promise<ReviewCheck[]> {
  const properties = Object.fromEntries(Object.keys(REVIEW_FIELDS).map((k) => [k, { type: "string" }]));
  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: { type: "object", properties, required: Object.keys(REVIEW_FIELDS), additionalProperties: false } },
    },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: screenshotBase64 } },
        { type: "text", text: `Read these rows from the Review page exactly as shown: ${Object.values(REVIEW_FIELDS).join(", ")}. Use an empty string for a row you cannot see.` },
      ],
    }],
  });
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const seen = JSON.parse(text) as Record<ReviewKey, string>;
  const taxForm = p.documents.taxForm;
  const expected: Record<ReviewKey, [string, (portal: string) => boolean]> = {
    payee: [p.payee.name, (v) => v.trim() === p.payee.name],
    country: [p.payee.country, (v) => v.trim() === p.payee.country],
    taxpayer_id: ["None: foreign person (W-8BEN)", (v) => /foreign/i.test(v) && !/\d{4}/.test(v)],
    gross: [`$${dollars(p.grossCents)}`, (v) => amount(v) === amount(dollars(p.grossCents))],
    withheld: [`$${dollars(p.withheldCents)}`, (v) => amount(v) === amount(dollars(p.withheldCents))],
    net: [`$${dollars(p.netCents)}`, (v) => amount(v) === amount(dollars(p.netCents))],
    account_code: [p.accountCode, (v) => v.includes("5300")],
    method: [p.paymentMethod, (v) => v.trim() === p.paymentMethod],
    supporting_document: [fileName(p.documents.supporting), (v) => v.includes(fileName(p.documents.supporting))],
    tax_form: taxForm ? [fileName(taxForm), (v) => v.includes(fileName(taxForm))] : ["Not required", (v) => /not required/i.test(v)],
  };
  return (Object.keys(REVIEW_FIELDS) as ReviewKey[]).map((key) => {
    const [packet, matches] = expected[key];
    const portal = seen[key] ?? "";
    return { label: REVIEW_FIELDS[key], packet, portal, ok: matches(portal) };
  });
}

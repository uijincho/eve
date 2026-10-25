/**
 * Rules the portal agent cannot talk its way past. Each one runs in code before an
 * action reaches the computer, so a confused or prompt-injected model is still stopped.
 */

export type PortalPage = "login" | "payee" | "payment" | "documents" | "review" | "submitted" | "expired" | "other";

export const PAGE_ORDER: PortalPage[] = ["login", "payee", "payment", "documents", "review", "submitted"];

export const PAGE_LABELS: Record<PortalPage, string> = {
  login: "Sign in",
  payee: "Payee",
  payment: "Payment",
  documents: "Documents",
  review: "Review",
  submitted: "Submitted",
  expired: "Session expired",
  other: "Other window",
};

const TITLE_TO_PAGE: Record<string, PortalPage> = {
  "Sign in": "login",
  Payee: "payee",
  "Payment details": "payment",
  Documents: "documents",
  "Bulk upload": "documents",
  "Review and submit": "review",
  Submitted: "submitted",
  "Session expired": "expired",
};

/** Reads the portal page from the browser window title, e.g. "Westbrook Finance · Payee - Google Chrome". */
export function pageFromTitle(title: string | null | undefined): PortalPage {
  const match = /Westbrook Finance · ([^—–-]+?)\s*(?:[—–-]|$)/.exec(title ?? "");
  return (match && TITLE_TO_PAGE[match[1].trim()]) || "other";
}

export type GuardRule = "review_gate" | "tax_id" | "password_scope";

export const GUARD_LABELS: Record<GuardRule, string> = {
  review_gate: "Stops before the final Submit",
  tax_id: "Never types a taxpayer ID",
  password_scope: "Password typed by Eve's code, only on the sign-in page",
};

export type GuardResult = { ok: true } | { ok: false; rule: GuardRule; message: string };

/** Members that can change what is on the page. Reading members stay allowed on Review. */
const COMMITTING = new Set([
  "left_click", "right_click", "middle_click", "double_click", "triple_click",
  "left_click_drag", "left_mouse_down", "left_mouse_up", "key", "hold_key", "type",
]);

const SSN_OR_ITIN = /(?<!\d)\d{3}[-\s.]?\d{2}[-\s.]?\d{4}(?!\d)/;
const EIN = /(?<!\d)\d{2}-\d{7}(?!\d)/;

export function looksLikeTaxId(text: string): boolean {
  return SSN_OR_ITIN.test(text) || EIN.test(text);
}

export interface GuardContext {
  page: PortalPage;
  /** A controller approved submission of the Review page as shown. */
  approved: boolean;
}

export function checkComputerAction(name: string, input: Record<string, unknown>, ctx: GuardContext): GuardResult {
  if (ctx.page === "review" && !ctx.approved && COMMITTING.has(name)) {
    return {
      ok: false,
      rule: "review_gate",
      message: "Blocked by Eve: this is the Review page. Submitting needs controller approval, so do not click or type here. End your turn with a summary of the Review page and wait.",
    };
  }
  if (name === "type" && typeof input.text === "string" && looksLikeTaxId(input.text)) {
    return {
      ok: false,
      rule: "tax_id",
      message: "Blocked by Eve: that text looks like a taxpayer ID. Never type an SSN, ITIN or EIN. If the portal requires one the packet does not have, call escalate_to_controller.",
    };
  }
  return { ok: true };
}

export function checkPasswordTool(ctx: GuardContext): GuardResult {
  if (ctx.page !== "login") {
    return {
      ok: false,
      rule: "password_scope",
      message: "Blocked by Eve: the portal password is only typed on the Westbrook sign-in page.",
    };
  }
  return { ok: true };
}

function point(value: unknown): string {
  return Array.isArray(value) && value.length === 2 ? `(${value[0]}, ${value[1]})` : "the cursor";
}

function quoted(value: unknown, max = 60): string {
  const text = typeof value === "string" ? value : "";
  return `“${text.length > max ? `${text.slice(0, max - 1)}…` : text}”`;
}

/** One plain-language line per action, for the step timeline. Never echoes secrets. */
export function describeAction(name: string, input: Record<string, unknown>): string {
  const mods = typeof input.text === "string" && name !== "type" && name !== "key" && name !== "hold_key" ? ` holding ${input.text}` : "";
  switch (name) {
    case "screenshot": return "Look at the screen";
    case "zoom": return `Zoom into ${JSON.stringify(input.region)}`;
    case "left_click": return `Click ${point(input.coordinate)}${mods}`;
    case "right_click": return `Right-click ${point(input.coordinate)}${mods}`;
    case "middle_click": return `Middle-click ${point(input.coordinate)}${mods}`;
    case "double_click": return `Double-click ${point(input.coordinate)}${mods}`;
    case "triple_click": return `Triple-click ${point(input.coordinate)}${mods}`;
    case "left_click_drag": return `Drag ${point(input.start_coordinate)} to ${point(input.coordinate)}`;
    case "mouse_move": return `Move the mouse to ${point(input.coordinate)}`;
    case "left_mouse_down": return "Press the mouse button";
    case "left_mouse_up": return "Release the mouse button";
    case "cursor_position": return "Read the cursor position";
    case "scroll": return `Scroll ${String(input.scroll_direction)} ${String(input.scroll_amount ?? 1)}${input.coordinate ? ` at ${point(input.coordinate)}` : ""}`;
    case "type": return `Type ${quoted(input.text)}`;
    case "key": return `Press ${String(input.text)}${Number(input.repeat) > 1 ? ` ×${input.repeat}` : ""}`;
    case "hold_key": return `Hold ${String(input.text)} for ${String(input.duration)}s`;
    case "wait": return `Wait ${String(input.duration)}s`;
    case "type_portal_password": return "Type the portal password (hidden from the model)";
    case "escalate_to_controller": return `Escalate to the controller: ${quoted(input.reason, 120)}`;
    case "report_submitted": return `Report confirmation ${quoted(input.confirmation_number)}`;
    default: return name;
  }
}

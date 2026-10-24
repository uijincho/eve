// Project-submission check for hacker travel claims. Flag-only: a failing
// check sends the claim to a person and holds the payout. It never rejects.
//
// person.role values stored today are "hacker" (the default), "mentor" and
// "judge" (see lib/server/seed.ts). The client fixture capitalizes them
// ("Hacker", "Judge"). Only hacker is checked; mentor, judge, and any other
// role (speaker, volunteer, staff) are skipped. Comparison is case-insensitive.
import type { Check } from "@/lib/contracts";

export type ProjectStatus = "unknown" | "submitted" | "none";

export const PROJECT_CHECK_CODE = "project_submission";

/** Roles that must have a project on record before a travel reimbursement is paid. */
export function isHackerRole(role: string | undefined): boolean {
  return role?.trim().toLowerCase() === "hacker";
}

export interface ProjectSubmissionInput {
  role: string;
  name: string;
  projectStatus?: ProjectStatus;
  projectUrl?: string | null;
  /** Only "travel" is checked. Expenses, prizes and org bookings are not. */
  claimType: string;
  closingAt: string;
  /** When the claim is filed, or "now" at release. */
  asOf: string;
}

export type ProjectSubmissionResult =
  | { applies: false }
  | { applies: true; check: Check };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Epoch ms for a real calendar date or an offset date-time. Unparseable values fail closed. */
function instantMs(value: string): number | undefined {
  const m = DATE_ONLY.exec(value) ?? DATE_TIME.exec(value);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return undefined;
  if (m.length > 4 && m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59)) return undefined;
  const ms = Date.parse(m[4] === undefined ? `${value}T00:00:00Z` : value);
  return Number.isNaN(ms) ? undefined : ms;
}

/**
 * Travel claims for hackers. `submitted` passes. `none` fails. `unknown`
 * passes before closing (claims are often filed before judging) and fails
 * after it. A missing or unreadable closing time fails closed, so an unknown
 * status cannot auto-approve.
 */
export function checkProjectSubmission(input: ProjectSubmissionInput): ProjectSubmissionResult {
  if (input.claimType !== "travel" || !isHackerRole(input.role)) return { applies: false };
  const name = input.name.trim() || "this person";
  const status: ProjectStatus = input.projectStatus ?? "unknown";
  const url = input.projectUrl?.trim();
  const check = (passed: boolean, detail: string): ProjectSubmissionResult => ({
    applies: true,
    check: { code: PROJECT_CHECK_CODE, label: "Project submitted", passed, detail },
  });

  if (status === "submitted") {
    return check(true, url ? `Project on record for ${name}: ${url}.` : `Project on record for ${name}.`);
  }
  if (status === "none") {
    return check(false, `No project submission on record for ${name}.`);
  }

  const closing = instantMs(input.closingAt);
  const at = instantMs(input.asOf);
  if (closing === undefined || at === undefined || at > closing) {
    const detail = closing === undefined || at === undefined
      ? `No project submission on record for ${name}, and the event closing time is not a valid date.`
      : `No project submission on record for ${name} after the submission deadline.`;
    return check(false, detail);
  }
  const deadline = input.closingAt.slice(0, 10);
  return check(true, `Project submission is not on record yet for ${name}. Accepted before the ${deadline} submission deadline; the payout is held if it is still unknown after closing.`);
}

// Dates and times for display, in the event's time zone.
const TZ = "America/Los_Angeles";

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts });
const DATE = fmt({ month: "short", day: "numeric" });
const DATE_Y = fmt({ month: "short", day: "numeric", year: "numeric" });
const TIME = fmt({ hour: "numeric", minute: "2-digit" });

const valid = (d: Date) => !Number.isNaN(d.getTime());

export function fmtDate(iso?: string | null, withYear = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return valid(d) ? (withYear ? DATE_Y : DATE).format(d) : "—";
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return valid(d) ? TIME.format(d) : "—";
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return `${fmtDate(iso)}, ${fmtTime(iso)}`;
}

export function fmtRate(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
}

export const ROLE_LABEL: Record<string, string> = {
  organizer: "Organizer",
  controller: "Controller",
  attendee: "Attendee",
  auditor: "Auditor",
  agent: "Agent",
};

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** ISO instant to a datetime-local value in the browser's zone. */
export function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value back to an ISO instant, or undefined when blank. */
export function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Integer minor units to an editable decimal string ("129900" -> "1299.00"). */
export function minorToInput(minor?: string | null): string {
  if (!minor) return "";
  const n = BigInt(minor);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}

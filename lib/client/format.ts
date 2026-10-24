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

// Deadline urgency for Blue Hour. The dusk scale is the only colour that
// means time, so every deadline in the app resolves to one of these bands.

export type DuskBand = 1 | 2 | 3 | 4 | 5;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DUSK_BANDS: ReadonlyArray<{
  band: DuskBand;
  label: string;
  /** Upper bound (exclusive) of time remaining, in ms. */
  under: number;
}> = [
  { band: 5, label: "Under an hour", under: HOUR },
  { band: 4, label: "Under a day", under: DAY },
  { band: 3, label: "Under 2 days", under: 2 * DAY },
  { band: 2, label: "Under a week", under: 7 * DAY },
  { band: 1, label: "A week or more", under: Number.POSITIVE_INFINITY },
];

/** Overdue items take the warmest band. */
export function duskBand(due: Date, now: Date): DuskBand {
  const remaining = due.getTime() - now.getTime();
  for (const { band, under } of DUSK_BANDS) {
    if (remaining < under) return band;
  }
  return 1;
}

export const DUSK_TEXT: Record<DuskBand, string> = {
  1: "text-dusk-1",
  2: "text-dusk-2",
  3: "text-dusk-3",
  4: "text-dusk-4",
  5: "text-dusk-5",
};

export const DUSK_BG: Record<DuskBand, string> = {
  1: "bg-dusk-1",
  2: "bg-dusk-2",
  3: "bg-dusk-3",
  4: "bg-dusk-4",
  5: "bg-dusk-5",
};

/** "18 min", "1 h 18 min", "Oct 27", or "Overdue 5 min". */
export function formatDue(
  due: Date,
  now: Date,
  timeZone = "America/Los_Angeles",
): string {
  const remaining = due.getTime() - now.getTime();
  if (remaining < 0) return `Overdue ${formatSpan(-remaining)}`;
  if (remaining < DAY) return formatSpan(remaining);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(due);
}

/** Spoken form for assistive tech: "Due in 18 minutes". */
export function describeDue(due: Date, now: Date, timeZone?: string): string {
  const remaining = due.getTime() - now.getTime();
  if (remaining < 0) return `Overdue by ${formatSpan(-remaining, true)}`;
  if (remaining < DAY) return `Due in ${formatSpan(remaining, true)}`;
  return `Due ${formatDue(due, now, timeZone)}`;
}

function formatSpan(ms: number, long = false): string {
  const totalMinutes = Math.max(1, Math.round(ms / MINUTE));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const days = Math.floor(h / 24);
  if (days) return long ? `${days} ${days === 1 ? "day" : "days"}` : `${days} d`;
  if (long) {
    const parts = [];
    if (h) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
    if (m) parts.push(`${m} ${m === 1 ? "minute" : "minutes"}`);
    return parts.join(" ");
  }
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// The horizon compresses time so the next hours get room without hiding the
// next two weeks. Each stop is labelled on the axis, so the scale stays honest.
export const HORIZON_STOPS: ReadonlyArray<{
  label: string;
  at: number;
  x: number;
}> = [
  { label: "Now", at: 0, x: 0 },
  { label: "1 h", at: HOUR, x: 0.14 },
  { label: "6 h", at: 6 * HOUR, x: 0.28 },
  { label: "1 day", at: DAY, x: 0.42 },
  { label: "2 days", at: 2 * DAY, x: 0.56 },
  { label: "1 week", at: 7 * DAY, x: 0.8 },
  { label: "2 weeks", at: 14 * DAY, x: 1 },
];

/** Position (0 to 1) of a deadline on the horizon. Clamped at both ends. */
export function horizonX(due: Date, now: Date): number {
  return horizonXForSpan(due.getTime() - now.getTime());
}

/** Position (0 to 1) of a span of time remaining on the horizon. */
export function horizonXForSpan(t: number): number {
  if (t <= 0) return 0;
  for (let i = 1; i < HORIZON_STOPS.length; i++) {
    const a = HORIZON_STOPS[i - 1];
    const b = HORIZON_STOPS[i];
    if (t <= b.at) return a.x + ((t - a.at) / (b.at - a.at)) * (b.x - a.x);
  }
  return 1;
}

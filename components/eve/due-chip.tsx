import { cn } from "cn";

import {
  DUSK_BG,
  DUSK_TEXT,
  describeDue,
  duskBand,
  formatDue,
} from "@/lib/design/urgency";

/** A deadline in its dusk colour. The only place time gets a hue. */
export function DueChip({
  due,
  now,
  context,
  align = "start",
  className,
}: {
  due: Date | string;
  now: Date | string;
  /** What the deadline is, e.g. "2:00 PM release". */
  context?: string;
  align?: "start" | "end";
  className?: string;
}) {
  const dueDate = new Date(due);
  const nowDate = new Date(now);
  const band = duskBand(dueDate, nowDate);

  return (
    <span
      className={cn(
        "inline-flex flex-col gap-0.5",
        align === "end" ? "items-end text-right" : "items-start",
        className,
      )}
    >
      <time
        dateTime={dueDate.toISOString()}
        className={cn(
          "inline-flex items-center gap-1.5 text-small font-semibold whitespace-nowrap",
          DUSK_TEXT[band],
        )}
      >
        <span aria-hidden className={cn("size-1.5 rounded-full", DUSK_BG[band])} />
        <span className="sr-only">{describeDue(dueDate, nowDate)}</span>
        <span aria-hidden>{formatDue(dueDate, nowDate)}</span>
      </time>
      {context ? (
        <span className="text-caption text-muted-foreground">{context}</span>
      ) : null}
    </span>
  );
}

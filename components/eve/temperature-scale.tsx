import { cn } from "cn";

import {
  DUSK_BANDS,
  DUSK_BG,
  DUSK_TEXT,
  horizonXForSpan,
} from "@/lib/design/urgency";

// Each band spans the same stretch of the horizon its deadlines land on, so a
// ramp set under a horizon lines up with the axis ticks above it.
const SEGMENTS = DUSK_BANDS.map((b, i) => {
  const from = i === 0 ? 0 : horizonXForSpan(DUSK_BANDS[i - 1].under);
  const to = horizonXForSpan(b.under);
  return { ...b, width: to - from };
});

const COLUMNS = SEGMENTS.map((s) => `${s.width}fr`).join(" ");

/** The dusk scale, warm (due soonest) to cool, on the horizon's time scale. */
export function TemperatureScale({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div aria-hidden className="grid gap-0.5" style={{ gridTemplateColumns: COLUMNS }}>
        {SEGMENTS.map(({ band }) => (
          <span key={band} className={cn("h-1 rounded-full", DUSK_BG[band])} />
        ))}
      </div>
      {/* Wide: each label under its own band. */}
      <ul
        aria-label="Deadline colours"
        className="grid max-sm:hidden"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        {SEGMENTS.map(({ band, label }) => (
          <li key={band} className={cn("pr-2 text-caption font-medium", DUSK_TEXT[band])}>
            {label}
          </li>
        ))}
      </ul>
      {/* Narrow: bands too thin to label, so a key instead. */}
      <ul aria-label="Deadline colours" className="flex flex-wrap gap-x-4 gap-y-1 sm:hidden">
        {SEGMENTS.map(({ band, label }) => (
          <li key={band} className={cn("inline-flex items-center gap-1.5 text-caption font-medium", DUSK_TEXT[band])}>
            <span aria-hidden className={cn("size-1.5 rounded-full", DUSK_BG[band])} />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

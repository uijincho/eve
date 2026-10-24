"use client";

import { cn } from "cn";
import { useLayoutEffect, useRef, useState } from "react";

import {
  DUSK_BG,
  DUSK_TEXT,
  HORIZON_STOPS,
  describeDue,
  duskBand,
  horizonX,
} from "@/lib/design/urgency";

export type HorizonItem = { id: string; label: string; dueAt: string };

const LANE = 22;
const AXIS = 28;
/** Labels stack at most this deep; further labels drop and their dots stay. */
const MAX_LANES = 3;
/** Marks closer than this many pixels share one dot and one label. */
const CLUSTER_PX = 10;

/**
 * Every open deadline on one line from now to two weeks out, each mark in its
 * dusk colour. Linked to a list through `activeId` / `onActiveChange`.
 */
export function Horizon({
  items,
  now,
  nowLabel,
  activeId = null,
  onActiveChange,
  className,
}: {
  items: HorizonItem[];
  now: string;
  /** Shown beside "Now", e.g. "1:42 PM". */
  nowLabel?: string;
  activeId?: string | null;
  onActiveChange?: (id: string | null) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const nowDate = new Date(now);
  const showLabels = width >= 560;
  const marks = layoutMarks(items, nowDate, width, showLabels);
  const lanes = showLabels ? Math.max(1, ...marks.map((m) => m.lane + 1)) : 0;
  const isActive = (m: (typeof marks)[number]) => activeId !== null && m.ids.includes(activeId);
  const height = lanes * LANE + AXIS + 18;

  return (
    <div
      ref={ref}
      className={cn("relative select-none", className)}
      style={{ height }}
      onMouseLeave={() => onActiveChange?.(null)}
    >
      {/* Axis */}
      <div className="absolute inset-x-0 h-px bg-input" style={{ bottom: AXIS }} />
      {HORIZON_STOPS.map((stop, i) => (
        <div
          key={stop.label}
          aria-hidden
          className={cn(
            "absolute flex flex-col gap-1.5 text-caption whitespace-nowrap text-faint",
            i === 0 ? "items-start" : i === HORIZON_STOPS.length - 1 ? "items-end" : "items-center",

          )}
          style={{
            bottom: 0,
            left: `${stop.x * 100}%`,
            transform: i === 0 ? undefined : i === HORIZON_STOPS.length - 1 ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          <span className={cn("h-1.5 w-px bg-input", i === 0 && "bg-foreground")} />
          <span
            className={cn(
              i === 0 && "font-semibold text-foreground",
              !showLabels && ![0, 3, 6].includes(i) && "invisible",
            )}
          >
            {i === 0 && nowLabel && showLabels ? `Now ${nowLabel}` : stop.label}
          </span>
        </div>
      ))}

      {/* Marks */}
      <ul>
        {marks.map((m) => {
          const active = isActive(m);
          const dimmed = activeId !== null && !active;
          const labelled = showLabels && m.lane >= 0;
          const stem = labelled ? (m.lane + 1) * LANE - 6 : 0;
          return (
            <li
              key={m.id}
              className="absolute transition-opacity duration-200 ease-dusk"
              style={{ left: `${m.x * 100}%`, bottom: AXIS, opacity: dimmed ? 0.35 : 1 }}
            >
              <button
                type="button"
                aria-label={`${m.count > 1 ? `${m.count} items, first ${m.first}` : m.label}. ${describeDue(new Date(m.dueAt), nowDate)}`}
                aria-pressed={active}
                onMouseEnter={() => onActiveChange?.(m.id)}
                onFocus={() => onActiveChange?.(m.id)}
                onBlur={() => onActiveChange?.(null)}
                className="group absolute -bottom-2 -translate-x-1/2 rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "block size-2.5 rounded-full ring-2 ring-background transition-transform duration-200 ease-dusk",
                    DUSK_BG[m.band],
                    active && "scale-150",
                  )}
                />
              </button>
              {labelled ? (
                <>
                  <span
                    aria-hidden
                    className={cn("absolute bottom-1.5 w-px opacity-50", DUSK_BG[m.band])}
                    style={{ height: stem - 4 }}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "absolute z-10 bg-background px-1 text-caption font-medium whitespace-nowrap transition-colors duration-200",
                      active ? "text-foreground" : DUSK_TEXT[m.band],
                      m.flip ? "right-0 translate-x-2.5" : "left-0 -translate-x-2.5",
                    )}
                    style={{ bottom: stem }}
                  >
                    {m.label}
                  </span>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Clusters marks that would sit on top of each other (a real event puts dozens
 * of prizes on the closing ceremony), then assigns label lanes greedily so
 * labels never overlap at the measured width. Lane -1 means dot only.
 */
function layoutMarks(
  items: HorizonItem[],
  now: Date,
  width: number,
  withLabels: boolean,
) {
  const sorted = items
    .map((item) => ({ ...item, due: new Date(item.dueAt) }))
    .map((item) => ({ ...item, x: horizonX(item.due, now) }))
    .sort((a, b) => a.x - b.x || a.due.getTime() - b.due.getTime());

  const clusters: (typeof sorted)[] = [];
  for (const item of sorted) {
    const last = clusters.at(-1);
    if (last && (item.x - last[0].x) * width < CLUSTER_PX) last.push(item);
    else clusters.push([item]);
  }

  const placed = clusters.map((group) => {
    const first = group[0];
    return {
      id: first.id,
      ids: group.map((g) => g.id),
      count: group.length,
      first: first.label,
      label: group.length > 1 ? `${first.label} +${group.length - 1}` : first.label,
      dueAt: first.dueAt,
      x: first.x,
      band: duskBand(first.due, now),
      flip: first.x > 0.82,
      lane: 0,
    };
  });

  if (!withLabels) return placed;

  const laneEnds: number[] = [];
  for (const mark of placed) {
    const px = mark.x * width;
    const labelWidth = mark.label.length * 6.6 + 20;
    const [start, end] = mark.flip ? [px - labelWidth, px] : [px, px + labelWidth];
    let lane = laneEnds.findIndex((laneEnd) => laneEnd < start);
    if (lane === -1 && laneEnds.length < MAX_LANES) lane = laneEnds.length;
    if (lane === -1) {
      mark.lane = -1;
      continue;
    }
    laneEnds[lane] = end;
    mark.lane = lane;
  }
  return placed;
}

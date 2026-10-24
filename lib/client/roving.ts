// Arrow-key, Home and End movement for tablists and radiogroups built from
// buttons: only the current option is in the tab order; arrows move and select.
import type { KeyboardEvent } from "react";

export function rovingKeyDown<V extends string>(
  e: KeyboardEvent<HTMLElement>,
  values: readonly V[],
  current: V,
  select: (v: V) => void,
) {
  const i = values.indexOf(current);
  const last = values.length - 1;
  const next =
    e.key === "ArrowRight" || e.key === "ArrowDown" ? (i >= last ? 0 : i + 1)
    : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i <= 0 ? last : i - 1)
    : e.key === "Home" ? 0
    : e.key === "End" ? last
    : null;
  if (next === null) return;
  e.preventDefault();
  select(values[next]);
  const options = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-roving]");
  options?.[next]?.focus();
}

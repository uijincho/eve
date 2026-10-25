import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
import type { Tag, Tone } from "@/lib/client/derive";

const VARIANT: Record<Tone, "critical" | "pending" | "positive" | "secondary"> = {
  critical: "critical",
  pending: "pending",
  positive: "positive",
  neutral: "secondary",
};

/** State chips in a row. Past `max`, the rest fold into a "+2" chip whose title names them. */
export function TagList({ tags, max, className }: { tags: Tag[]; max?: number; className?: string }) {
  if (!tags.length) return null;
  const shown = max ? tags.slice(0, max) : tags;
  const rest = tags.slice(shown.length);
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((t) => (
        <Badge key={t.label} variant={VARIANT[t.tone]} title={t.title}>
          {t.label}
        </Badge>
      ))}
      {rest.length ? (
        <Badge variant="secondary" title={rest.map((t) => t.title ?? t.label).join("; ")}>
          +{rest.length}
        </Badge>
      ) : null}
    </span>
  );
}

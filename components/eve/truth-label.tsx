import { cn } from "cn";

const LABELS = {
  sample: "Sample data",
  test: "Test mode",
  simulated: "Simulated",
  estimate: "Estimate",
  unverified: "Unverified rule",
} as const;

export type Truth = keyof typeof LABELS;

/** Marks anything that is not real money, real data, or a verified rule. */
export function TruthLabel({
  kind,
  className,
}: {
  kind: Truth;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm border px-1.5 text-caption font-medium whitespace-nowrap text-muted-foreground",
        kind === "unverified" ? "border-dashed border-input" : "border-border",
        className,
      )}
    >
      {LABELS[kind]}
    </span>
  );
}

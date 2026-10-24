import { Badge } from "@/components/ui/badge";

const CRITICAL = new Set(["frozen", "failed", "returned", "rejected", "expired", "exception", "over"]);
const POSITIVE = new Set(["paid", "approved", "valid", "done", "reviewed", "reconciled", "verified"]);
const DRAFT = new Set(["draft", "undecided", "missing"]);

const LABEL: Record<string, string> = {
  needs_info: "Needs info",
  needs_form: "Needs form",
  missing: "Form missing",
};

/** A state pill: coral for critical, mint for passed, outline for holds. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const text = label ?? LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
  const variant = CRITICAL.has(status)
    ? "critical"
    : POSITIVE.has(status)
      ? "positive"
      : DRAFT.has(status)
        ? "secondary"
        : "outline";
  return <Badge variant={variant}>{text}</Badge>;
}

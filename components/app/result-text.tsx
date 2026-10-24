import { cn } from "cn";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";

import type { ActionResult } from "@/lib/contracts";

/** The server's answer to an action, in mint or coral with its icon. */
export function ResultText({ result, className }: { result: ActionResult; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-small",
        result.ok ? "text-positive" : "text-critical",
        className,
      )}
    >
      {result.ok ? <CheckIcon aria-hidden className="size-3.5" /> : <TriangleAlertIcon aria-hidden className="size-3.5" />}
      {result.message}
    </span>
  );
}

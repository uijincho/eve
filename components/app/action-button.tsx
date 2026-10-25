"use client";

import { cn } from "cn";
import { LoaderCircleIcon } from "lucide-react";
import { useId } from "react";

import { ResultText } from "@/components/app/result-text";
import { BlockedAction } from "@/components/eve/blocked-action";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/contracts";
import type { Permission } from "@/lib/client/derive";
import type { ActionCall } from "@/lib/client/payloads";
import { useAction } from "@/lib/client/use-eve";

type Variant = "default" | "secondary" | "ghost" | "outline" | "destructive";

/**
 * A button that runs one named action against the server, shows it pending
 * ("Releasing"), and reports the server's answer beside it. When the current
 * persona may not act, it stays visible and locked, with the reason in a tooltip.
 */
export function ActionButton({
  call,
  label,
  pendingLabel,
  variant = "secondary",
  size = "sm",
  permission,
  onDone,
  className,
  wide,
  grow,
  quietSuccess,
}: {
  /** The action, or a function that validates input first and returns null to stop. */
  call: ActionCall | (() => ActionCall | null);
  label: string;
  pendingLabel?: string;
  variant?: Variant;
  size?: "sm" | "default";
  permission?: Permission;
  onDone?: (result: ActionResult) => void;
  className?: string;
  wide?: boolean;
  /** Fill the rest of a row of actions instead of taking a line of its own. */
  grow?: boolean;
  quietSuccess?: boolean;
}) {
  const { state, run, pending } = useAction();
  const statusId = useId();

  if (permission && !permission.allowed) {
    return (
      <BlockedAction
        action={label}
        reason={permission.reason}
        size={size}
        fill={wide || grow}
        className={cn(grow && "min-w-0 flex-1", className)}
      />
    );
  }

  const result = state.status === "done" ? state.result : null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1.5", wide && "flex w-full", grow && "flex min-w-0 flex-1", className)}>
      <Button
        variant={variant}
        size={size}
        aria-busy={pending || undefined}
        aria-describedby={result ? statusId : undefined}
        className={cn("enabled:active:scale-[0.96] transition-[background-color,scale] duration-150", (wide || grow) && "w-full")}
        onClick={async () => {
          // aria-busy keeps the fill, so guard repeat clicks here instead of disabling.
          if (pending) return;
          const next = typeof call === "function" ? call() : call;
          if (!next) return;
          const r = await run(next);
          onDone?.(r);
        }}
      >
        {pending ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
        {pending ? (pendingLabel ?? label) : label}
      </Button>
      <span id={statusId} role="status" aria-live="polite" className="contents">
        {result && !(quietSuccess && result.ok) ? <ResultText result={result} /> : null}
      </span>
    </span>
  );
}

export { ResultText };

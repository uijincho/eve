"use client";

import { cn } from "cn";
import { CheckIcon, LoaderCircleIcon, LockIcon, TriangleAlertIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/contracts";
import type { Permission } from "@/lib/client/derive";
import type { ActionCall } from "@/lib/client/payloads";
import { useAction } from "@/lib/client/use-eve";

type Variant = "default" | "secondary" | "ghost" | "outline" | "destructive";

/**
 * A button that runs one named action against the server, shows it pending
 * ("Releasing"), and reports the server's answer beside it. When the current
 * persona may not act, it stays visible, locked, with the reason.
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
  quietSuccess?: boolean;
}) {
  const { state, run, pending } = useAction();
  const statusId = useId();

  if (permission && !permission.allowed) {
    return (
      <span className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", wide && "w-full", className)}>
        <Button
          variant="secondary"
          size={size}
          disabled
          focusableWhenDisabled
          aria-describedby={statusId}
          className={cn(wide && "w-full")}
        >
          <LockIcon aria-hidden />
          {label}
        </Button>
        <span id={statusId} className="text-small text-muted-foreground">
          {permission.reason}
        </span>
      </span>
    );
  }

  const result = state.status === "done" ? state.result : null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1.5", wide && "flex w-full", className)}>
      <Button
        variant={variant}
        size={size}
        aria-busy={pending || undefined}
        aria-describedby={result ? statusId : undefined}
        className={cn("enabled:active:scale-[0.96] transition-[background-color,scale] duration-150", wide && "w-full")}
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

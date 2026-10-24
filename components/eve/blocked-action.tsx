"use client";

import { LockIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";

/**
 * An action the current user may not take, kept visible with the reason
 * beside it. It stays focusable so screen readers reach the reason too.
 */
export function BlockedAction({
  action,
  reason,
}: {
  action: string;
  reason: string;
}) {
  const reasonId = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Button
        variant="secondary"
        size="sm"
        disabled
        focusableWhenDisabled
        aria-describedby={reasonId}
      >
        <LockIcon aria-hidden />
        {action}
      </Button>
      <p id={reasonId} className="text-small text-muted-foreground">
        {reason}
      </p>
    </div>
  );
}

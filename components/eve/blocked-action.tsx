"use client";

import { cn } from "cn";
import { LockIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * An action the current user may not take, kept visible and locked. The
 * reason shows in a tooltip on hover or focus, and stays focusable so screen
 * readers reach it through aria-describedby.
 */
export function BlockedAction({
  action,
  reason,
  size = "sm",
  fill,
  className,
}: {
  action: string;
  reason: string;
  size?: "sm" | "default";
  /** Take the full width of the row. */
  fill?: boolean;
  className?: string;
}) {
  const reasonId = useId();
  return (
    <span className={cn("inline-flex", fill && "flex w-full", className)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="secondary"
              size={size}
              disabled
              focusableWhenDisabled
              aria-describedby={reasonId}
              className={cn("data-disabled:pointer-events-auto", fill && "w-full")}
            />
          }
        >
          <LockIcon aria-hidden />
          {action}
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
      <span id={reasonId} className="sr-only">
        {reason}
      </span>
    </span>
  );
}

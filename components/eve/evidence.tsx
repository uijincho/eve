"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A figure that links to its evidence. Every amount Eve derives from a
 * document, rule, or rate should be one of these.
 */
export function Evidence({
  source,
  href = "#",
  children,
}: {
  /** Where the figure came from, e.g. "Rule US-NRA-PRIZE v2". */
  source: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            className="rounded-sm whitespace-nowrap underline decoration-faint decoration-dotted underline-offset-4 transition-colors duration-150 hover:decoration-foreground"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{source}</TooltipContent>
    </Tooltip>
  );
}

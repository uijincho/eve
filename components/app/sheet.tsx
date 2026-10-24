"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "cn";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * A side sheet for evidence and details. It slides from the right on wide
 * screens and rises from the bottom on phones. Focus is trapped while open and
 * returns to the opener on close; Escape closes.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  side = "right",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  side?: "right" | "left";
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-rail/70 transition-opacity duration-200 ease-dusk data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border bg-background shadow-[0_10px_15px_-3px_rgb(0_0_0/0.3),0_4px_6px_-4px_rgb(0_0_0/0.3)] outline-none transition-[translate,opacity] duration-200 ease-dusk data-ending-style:opacity-0 data-starting-style:opacity-0",
            "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-xl motion-safe:data-ending-style:translate-y-6 motion-safe:data-starting-style:translate-y-6",
            side === "right"
              ? "sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[26rem] sm:rounded-none sm:border-y-0 sm:border-r-0 motion-safe:sm:data-ending-style:translate-x-6 motion-safe:sm:data-ending-style:translate-y-0 motion-safe:sm:data-starting-style:translate-x-6 motion-safe:sm:data-starting-style:translate-y-0"
              : "sm:inset-y-0 sm:left-0 sm:right-auto sm:max-h-none sm:w-64 sm:rounded-none sm:border-y-0 sm:border-l-0 motion-safe:sm:data-ending-style:-translate-x-6 motion-safe:sm:data-ending-style:translate-y-0 motion-safe:sm:data-starting-style:-translate-x-6 motion-safe:sm:data-starting-style:translate-y-0",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b px-5 pt-4 pb-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Dialog.Title className="text-subheading">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-small text-muted-foreground">{description}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
              <XIcon aria-hidden />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

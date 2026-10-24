"use client";

import { useId, useRef, useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { TextArea } from "@/components/app/field";
import { Button } from "@/components/ui/button";
import type { Permission } from "@/lib/client/derive";
import type { ActionCall } from "@/lib/client/payloads";

/**
 * An action that needs a sentence first (reject, ask for info, confirm a bank
 * change). The form opens in place rather than in a modal.
 */
export function ReasonAction({
  label,
  submitLabel,
  pendingLabel,
  prompt,
  placeholder,
  build,
  permission,
  variant = "ghost",
  required = true,
  primary = false,
}: {
  label: string;
  submitLabel?: string;
  pendingLabel?: string;
  prompt: string;
  placeholder?: string;
  build: (reason: string) => ActionCall;
  permission?: Permission;
  variant?: "secondary" | "ghost" | "destructive";
  required?: boolean;
  /** In a detail pane, the opener is the view's one primary and spans it. */
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  if (permission && !permission.allowed) {
    return <ActionButton call={() => null} label={label} permission={permission} />;
  }

  if (!open) {
    return (
      <Button
        size={primary ? "default" : "sm"}
        variant={primary ? "default" : variant}
        className={primary ? "w-full" : undefined}
        aria-expanded={false}
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => ref.current?.focus());
        }}
      >
        {label}
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border bg-surface p-3">
      <label htmlFor={id} className="text-small font-medium">
        {prompt}
      </label>
      <TextArea
        id={id}
        ref={ref}
        value={reason}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => {
          setReason(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {error ? (
        <p id={`${id}-err`} className="text-small text-critical">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          label={submitLabel ?? label}
          pendingLabel={pendingLabel}
          variant={variant === "destructive" ? "destructive" : "secondary"}
          call={() => {
            if (required && reason.trim().length < 3) {
              setError("Add a short reason. It is saved to the decision log.");
              return null;
            }
            return build(reason.trim());
          }}
          onDone={(r) => {
            if (r.ok) setReason("");
          }}
        />
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

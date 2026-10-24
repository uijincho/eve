"use client";

import { cn } from "cn";
import { useId } from "react";

/**
 * Label above, help or error below, wired with aria-describedby. Children is
 * a render function so the id and description reach the control.
 */
export function Field({
  label,
  help,
  error,
  className,
  children,
}: {
  label: string;
  help?: React.ReactNode;
  error?: string | null;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const descId = `${id}-desc`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-small font-medium">
        {label}
      </label>
      {children({
        id,
        "aria-describedby": help || error ? descId : undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <p id={descId} className="text-small text-critical">
          {error}
        </p>
      ) : help ? (
        <p id={descId} className="text-small text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}

/** A native select styled as a field. Native keeps phone pickers usable. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-body outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-critical aria-invalid:ring-3 aria-invalid:ring-critical/20",
        className,
      )}
      {...props}
    />
  );
}

export function TextArea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-16 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-body outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-critical aria-invalid:ring-3 aria-invalid:ring-critical/20",
        className,
      )}
      {...props}
    />
  );
}

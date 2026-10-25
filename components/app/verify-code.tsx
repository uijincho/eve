"use client";

import { useId, useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { Input } from "@/components/ui/input";
import type { Permission } from "@/lib/client/derive";
import { payloads } from "@/lib/client/payloads";

/**
 * Confirms or rejects a bank-detail change with the 6-digit code Eve sent to
 * the recipient's original email. Without the code, the payout stays frozen.
 */
export function VerifyCode({
  personId,
  personName,
  permission,
  primary,
  self,
  trailing,
}: {
  /** Another control that belongs on the same line, such as a phone row's Details. */
  trailing?: React.ReactNode;
  personId: string;
  personName: string;
  permission?: Permission;
  primary?: boolean;
  /** The recipient is confirming their own change. */
  self?: boolean;
}) {
  const id = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const first = personName.split(" ")[0];
  const check = () => {
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from the original email.");
      return false;
    }
    return true;
  };
  if (permission && !permission.allowed) {
    return (
      <>
        <ActionButton label="Confirm bank change" permission={permission} call={() => null} />
        {trailing}
      </>
    );
  }
  const confirm = (
    <ActionButton
      grow={primary}
      size={primary ? "default" : "sm"}
      variant={primary ? "default" : "secondary"}
      label={primary ? "Confirm new account" : "Confirm account"}
      pendingLabel="Confirming"
      call={() => (check() ? payloads.payoutVerify(personId, code, "confirm") : null)}
    />
  );
  return (
    <div className="flex w-full flex-col gap-2">
      <label htmlFor={id} className="text-small font-medium">
        {self ? "Code from your original email" : `Code ${first} received at their original email`}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ""));
            setError(null);
          }}
          placeholder="123456"
          aria-invalid={error ? true : undefined}
          aria-describedby={error || primary || self ? `${id}-help` : undefined}
          className="w-32 shrink-0 tabular-nums tracking-[0.2em]"
        />
        {primary ? confirm : null}
      </div>
      {/* Rows keep only errors; the pane and the portal explain what confirming does. */}
      {error || primary || self ? (
        <p id={`${id}-help`} className={error ? "text-small text-critical" : "text-small text-muted-foreground"}>
          {error ?? (self ? "A controller releases your payout again after you confirm." : "Confirming re-quotes the payout; a controller releases it again.")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {primary ? null : confirm}
        <ActionButton
          variant="ghost"
          label={primary ? "Reject change" : "Reject"}
          pendingLabel="Rejecting"
          call={() => (check() ? payloads.payoutVerify(personId, code, "reject") : null)}
        />
        {trailing}
      </div>
    </div>
  );
}

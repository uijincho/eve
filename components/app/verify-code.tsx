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
}: {
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
    return <ActionButton label="Confirm bank change" permission={permission} call={() => null} />;
  }
  return (
    <div className="flex w-full flex-col gap-2">
      <label htmlFor={id} className="text-small font-medium">
        {self ? "Code from your original email" : `Code ${first} received at their original email`}
      </label>
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
        aria-describedby={`${id}-help`}
        className="max-w-40 tabular-nums tracking-[0.2em]"
      />
      <p id={`${id}-help`} className={error ? "text-small text-critical" : "text-small text-muted-foreground"}>
        {error ?? (self ? "Confirming moves your payout to the new account. A controller then releases it again." : "Confirming re-quotes the payout on the new account; a controller must release it again.")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          wide={primary}
          size={primary ? "default" : "sm"}
          variant={primary ? "default" : "secondary"}
          label="Confirm new account"
          pendingLabel="Confirming"
          call={() => (check() ? payloads.payoutVerify(personId, code, "confirm") : null)}
        />
        <ActionButton
          variant="ghost"
          label="Reject change"
          pendingLabel="Rejecting"
          call={() => (check() ? payloads.payoutVerify(personId, code, "reject") : null)}
        />
      </div>
    </div>
  );
}

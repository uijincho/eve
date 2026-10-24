"use client";

import { useId, useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { Field, TextArea } from "@/components/app/field";
import { TruthLabel } from "@/components/eve/truth-label";
import type { AppSnapshot, Payout } from "@/lib/contracts";
import { canControl, isBeneficiary, ruleLabel, type Permission } from "@/lib/client/derive";
import { fmtRate } from "@/lib/client/format";
import { payloads } from "@/lib/client/payloads";

const MIN_REASON = 10;

/** True when a payout is held only because its tax rule is unverified and the form is valid. */
export function heldOnUnverifiedRule(s: Pick<AppSnapshot, "people">, p: Payout): boolean {
  if (p.status !== "held" || p.ruleVerified) return false;
  return s.people.find((x) => x.id === p.personId)?.taxStatus === "valid";
}

/** The verified rule the server falls back to for this payment type. */
function defaultRule(s: Pick<AppSnapshot, "rules" | "org">, current: AppSnapshot["rules"][number] | undefined) {
  const base = (current?.paymentType ?? "").split(":")[0];
  return s.rules
    .filter((r) => r.verified && r.payerCountry === (current?.payerCountry ?? s.org.country) && r.paymentType === base && !r.effectiveTo)
    .sort((a, b) => (a.payeeCountry === current?.payeeCountry ? -1 : 0) - (b.payeeCountry === current?.payeeCountry ? -1 : 0) || b.version - a.version)[0];
}

/**
 * A controller resolves an unverified-rule hold for this one payment: apply
 * the verified default rule, or accept the unverified rule as stated. The
 * rule itself stays unverified; the reason goes on the decision record.
 */
export function ResolveRule({
  snapshot: s,
  sourceType,
  sourceId,
  ruleId,
  ruleVersion,
  requestedBy,
  personId,
  onResolved,
}: {
  snapshot: AppSnapshot;
  sourceType: "claim" | "award";
  sourceId: string;
  /** The held rule, when a payout names it; an item award may not have one yet. */
  ruleId?: string;
  ruleVersion?: number;
  requestedBy?: string;
  personId: string;
  onResolved?: () => void;
}) {
  const name = useId();
  const [use, setUse] = useState<"default" | "rule">("default");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = ruleId ? s.rules.find((r) => r.id === ruleId && r.version === ruleVersion) : undefined;
  const fallback = defaultRule(s, current);
  const control = canControl(s.actor, s);
  const permission: Permission = !control.allowed
    ? control
    : requestedBy && (requestedBy === s.actor.id || requestedBy === s.actor.name)
      ? { allowed: false, reason: "You requested this payment, so another controller must resolve its tax hold." }
      : isBeneficiary(s.actor, personId, s)
        ? { allowed: false, reason: "This payment is to you. A different controller must resolve its tax hold." }
        : { allowed: true };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Unverified tax rule</h3>
        <TruthLabel kind="unverified" />
      </div>
      <p className="text-small text-muted-foreground">
        {current ? ruleLabel(current) : ruleId ? `Rule ${ruleId} v${ruleVersion}` : "The tax rule for this payment"} has not been checked against its source, so Eve holds this payment. Decide for this payment only; the rule stays unverified for everyone else. Release or delivery is still a separate step.
      </p>
      {permission.allowed ? (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">How to withhold on this payment</legend>
            {([
              ["default", fallback ? `Use the verified default, ${fmtRate(fallback.rateBps)}` : "Use the verified default rule", fallback ? `${ruleLabel(fallback)}. The safer choice when in doubt.` : "If no verified default exists, Eve says so and keeps the hold."],
              ["rule", current ? `Accept the rule as stated, ${fmtRate(current.rateBps)}` : "Accept the unverified rule as stated", "For this payment only, and only if you have checked the source yourself."],
            ] as const).map(([v, label, help]) => (
              <label key={v} className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors duration-150 hover:bg-surface has-checked:border-input has-checked:bg-surface has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
                <input type="radio" name={name} value={v} checked={use === v} onChange={() => setUse(v)} className="mt-0.5 focus-visible:outline-none" />
                <span className="flex flex-col">
                  <span className="font-medium">{label}</span>
                  <span className="text-small text-muted-foreground">{help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label="Reason" error={error} help="10 to 500 characters. Recorded with the decision and shown to auditors.">
            {(f) => <TextArea {...f} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} />}
          </Field>
          <ActionButton
            wide
            size="default"
            variant="default"
            label="Resolve and re-quote"
            pendingLabel="Resolving"
            onDone={(r) => r.ok && onResolved?.()}
            call={() => {
              if (reason.trim().length < MIN_REASON) {
                setError(`Say why in at least ${MIN_REASON} characters.`);
                return null;
              }
              return payloads.payoutResolveRule(sourceType, sourceId, use, reason.trim());
            }}
          />
        </>
      ) : (
        <p className="text-small text-muted-foreground">{permission.reason}</p>
      )}
    </section>
  );
}

/** The rule review for a held payout. */
export function ResolvePayoutRule({ payout: p, snapshot: s }: { payout: Payout; snapshot: AppSnapshot }) {
  return (
    <ResolveRule
      snapshot={s}
      sourceType={p.sourceType}
      sourceId={p.sourceId}
      ruleId={p.ruleId}
      ruleVersion={p.ruleVersion}
      requestedBy={p.requestedBy}
      personId={p.personId}
    />
  );
}

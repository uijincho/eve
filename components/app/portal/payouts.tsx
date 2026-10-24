"use client";

import { useState } from "react";

import { ActionButton } from "@/components/app/action-button";
import { Field, NativeSelect } from "@/components/app/field";
import { PayoutBreakdown } from "@/components/app/inbox/item-detail";
import { Section } from "@/components/app/page-header";
import { VerifyCode } from "@/components/app/verify-code";
import { Input } from "@/components/ui/input";
import type { Person } from "@/lib/contracts";
import { fmtDateTime } from "@/lib/client/format";
import { payoutSource } from "@/lib/client/derive";
import { payloads } from "@/lib/client/payloads";

import { PortalFrame } from "./portal-frame";

export function PortalPayouts() {
  return (
    <PortalFrame title="Payouts" lede="Where your money goes and what arrives. Fees and exchange rates are shown before anything is sent. Payouts here are test-mode or simulated money.">
      {(s, me) => {
        const mine = s.payouts.filter((p) => p.personId === me.id);
        const frozen = mine.some((p) => p.status === "frozen");
        return (
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Section title="Your payouts">
              {mine.length ? (
                <ul className="flex flex-col gap-8">
                  {mine.map((p) => (
                    <li key={p.id} className="flex flex-col gap-3 border-b pb-8 last:border-b-0">
                      <div className="flex flex-col">
                        <span className="font-semibold">{p.sourceType === "award" ? "Prize" : "Reimbursement"} · {payoutSource(s, p)}</span>
                        <span className="text-small text-muted-foreground">{p.status === "paid" ? `Paid ${fmtDateTime(p.paidAt)}` : p.reason}</span>
                      </div>
                      <PayoutBreakdown payout={p} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-muted-foreground">Nothing proposed yet. Once a claim is approved or a prize is ready, its payout shows here.</p>
              )}
            </Section>
            <div className="flex flex-col gap-10">
              {frozen ? (
                <Section title="Confirm your new account">
                  <p className="text-small text-muted-foreground">
                    We sent a 6-digit code to {me.email}, the address you registered with.
                    {s.demo ? " In this sample event it is also in your portal messages." : " Eve never shows it on screen, so a changed account cannot confirm itself."}
                  </p>
                  <VerifyCode personId={me.id} personName={me.name} self primary />
                </Section>
              ) : null}
              <PayoutMethod me={me} />
            </div>
          </div>
        );
      }}
    </PortalFrame>
  );
}

const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD", CA: "CAD", GB: "GBP", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR",
  IN: "INR", MX: "MXN", JP: "JPY", BR: "BRL", AU: "AUD",
};

function PayoutMethod({ me }: { me: Person }) {
  const [last4, setLast4] = useState("");
  // Before a first account exists, the person's own currency is a better guess than an import default.
  const [currency, setCurrency] = useState((me.payoutLast4 ? me.payoutCurrency : COUNTRY_CURRENCY[me.country]) || me.payoutCurrency || "USD");
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title="Payout account">
      <p className="text-small">{me.payoutLast4 ? `${me.payoutCurrency} account ••${me.payoutLast4}` : "No account on file yet."}</p>
      <p className="text-small text-muted-foreground">
        {me.payoutLast4
          ? "Changing it freezes unpaid payouts until you confirm with a code sent to your original email. This protects you if someone else asks us to change it."
          : "Add the account Eve pays you into. Later changes freeze unpaid payouts until you confirm them from your original email."}
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
        <Field label="Account, last 4 digits" error={error}>
          {(p) => <Input {...p} inputMode="numeric" maxLength={4} value={last4} onChange={(e) => { setLast4(e.target.value.replace(/\D/g, "")); setError(null); }} />}
        </Field>
        <Field label="Currency">
          {(p) => (
            <NativeSelect {...p} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {["USD", "CAD", "EUR", "GBP", "INR", "MXN", "JPY", "BRL", "AUD"].map((c) => <option key={c}>{c}</option>)}
            </NativeSelect>
          )}
        </Field>
      </div>
      <ActionButton
        className="self-start"
        label={me.payoutLast4 ? "Change account" : "Add account"}
        pendingLabel="Saving"
        onDone={(r) => r.ok && setLast4("")}
        call={() => {
          if (!/^\d{4}$/.test(last4)) {
            setError("Enter the last four digits of the account.");
            return null;
          }
          return payloads.payoutBankChange(me.id, last4, currency, "portal");
        }}
      />
    </Section>
  );
}

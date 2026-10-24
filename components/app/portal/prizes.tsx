"use client";

import { ActionButton } from "@/components/app/action-button";
import { Section } from "@/components/app/page-header";
import { PrizeComparison } from "@/components/app/prize-comparison";
import { StatusBadge } from "@/components/app/status-badge";
import { DueChip } from "@/components/eve/due-chip";
import { LinkButton } from "@/components/app/link-button";
import { FULFILLMENT_LABEL, prizeOptions } from "@/lib/client/derive";
import { payloads } from "@/lib/client/payloads";

import { PortalFrame } from "./portal-frame";

export function PortalPrizes() {
  return (
    <PortalFrame title="Prizes" lede="Congratulations. Eve shows what each option is worth to you after tax, fees, and currency, so you can choose before anyone ships anything.">
      {(s, me) => {
        const mine = s.awards.filter((a) => a.personId === me.id);
        if (!mine.length) return <p className="text-small text-muted-foreground">No prizes yet. If you win, it appears here with your options.</p>;
        return (
          <div className="flex flex-col gap-12">
            {mine.map((a) => {
              const payout = s.payouts.find((p) => p.sourceType === "award" && p.sourceId === a.id);
              const o = prizeOptions(s, a, me, payout);
              const team = a.teamId ? s.awards.filter((x) => x.teamId === a.teamId) : [];
              return (
                <Section key={a.id} title={`${a.track}: ${a.title}`} aside={<span className="inline-flex items-center gap-2"><StatusBadge status={a.status} /><DueChip due={a.dueAt} now={s.now} align="end" /></span>}>
                  <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_16rem]">
                    <PrizeComparison snapshot={s} award={a} person={me} payout={payout} />
                    <div className="flex flex-col gap-4">
                      {me.taxStatus !== "valid" ? (
                        <div className="flex flex-col gap-2 rounded-lg border p-3">
                          <p className="text-small">Payment waits for your {me.taxForm}. It takes about two minutes.</p>
                          <LinkButton href="/portal/profile" variant="default">Sign your {me.taxForm}</LinkButton>
                        </div>
                      ) : null}
                      {a.kind === "item" && !payout ? (
                        <div className="flex flex-col gap-2">
                          <h3 className="font-semibold">How would you like it?</h3>
                          {(["cash", "local", "ship"] as const).map((f) => (
                            <ActionButton
                              key={f}
                              wide
                              size="default"
                              variant={a.fulfillment === f ? "secondary" : "outline"}
                              label={`${FULFILLMENT_LABEL[f]}${a.fulfillment === f ? " (chosen)" : f === o.recommended && a.fulfillment === "undecided" ? " (recommended)" : ""}`}
                              pendingLabel="Saving"
                              quietSuccess
                              call={payloads.awardChoose(a.id, f)}
                            />
                          ))}
                        </div>
                      ) : null}
                      {team.length > 1 ? (
                        <div className="flex flex-col gap-2 rounded-lg border p-3">
                          <h3 className="font-semibold">Team split</h3>
                          <p className="text-small text-muted-foreground">
                            {team.map((t) => t.personName.split(" ")[0]).join(", ")} share this prize. {a.splitConfirmed ? "You confirmed your share." : "Confirm your share so the team can be paid."}
                          </p>
                          {!a.splitConfirmed ? <ActionButton wide size="default" variant="secondary" label="Confirm my share" pendingLabel="Confirming" call={payloads.awardConfirm(a.id)} /> : null}
                        </div>
                      ) : null}
                      {payout ? <p className="text-small text-muted-foreground">Payout {payout.id} is {payout.status}. Track it on Payouts.</p> : null}
                    </div>
                  </div>
                </Section>
              );
            })}
          </div>
        );
      }}
    </PortalFrame>
  );
}

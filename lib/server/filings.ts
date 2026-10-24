import { and, eq, sql } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import type { Executor } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { renderFilingDraft } from "@/lib/pdf";
import { currentProfile, fromUsd, loadOrgEvent, recordDecision, storeDocument } from "./core";
import { filingCurrency } from "./filing-currency";

type Form = "1099-MISC" | "1099-NEC" | "1042-S" | "T4A" | "NR4";
const forms: Form[] = ["1099-MISC", "1099-NEC", "1042-S", "T4A", "NR4"];

/** Paid income only. Each form stores amounts in its jurisdiction's currency, not necessarily the USD books. */
export async function generateFilings(tx: Executor, actor: ActorContext, input: { year?: number }) {
  const { org } = await loadOrgEvent(tx, actor.orgId);
  const year = input.year ?? new Date().getUTCFullYear();
  const rows = await tx.select({ payout: s.payout, person: s.person, award: s.award }).from(s.payout)
    .innerJoin(s.person, and(eq(s.person.id, s.payout.personId), eq(s.person.orgId, actor.orgId)))
    .innerJoin(s.award, and(eq(s.award.id, s.payout.awardId), eq(s.award.orgId, actor.orgId)))
    .where(and(eq(s.payout.orgId, actor.orgId), eq(s.payout.sourceType, "award"), eq(s.payout.status, "paid"), sql`extract(year from ${s.payout.paidAt}) = ${year}`));
  const rules = await tx.select().from(s.taxRule);
  const groups = new Map<string, {
    person: typeof s.person.$inferSelect; form: Form; currency: "USD" | "CAD"; gross: bigint; wh: bigint; threshold: bigint;
    payments: { date: string; description: string; grossMinor: string }[];
    rule: { id: string; version: number; verified: boolean };
  }>();
  for (const { payout, person, award } of rows) {
    const form = forms.find((f) => payout.reportingForm?.startsWith(f));
    if (!form) continue;
    const currency = filingCurrency(form);
    const rule = rules.find((r) => r.id === payout.ruleId && r.version === payout.ruleVersion);
    const key = `${person.id}:${form}`;
    const g = groups.get(key) ?? { person, form, currency, gross: 0n, wh: 0n, threshold: 0n, payments: [], rule: { id: payout.ruleId, version: payout.ruleVersion, verified: payout.ruleVerified && currency !== "CAD" } };
    let gross = payout.grossMinor, withholding = payout.withholdingMinor;
    let conversion = "USD books";
    if (currency === "CAD") {
      const wh = await fromUsd(tx, payout.withholdingMinor, "CAD", payout.paidAt!);
      withholding = wh.minor;
      // Preserve an original CAD prize exactly instead of rounding CAD -> USD -> CAD.
      // In-kind withholding is paid on top of FMV; cash withholding is part of gross.
      if (award.currency === "CAD") {
        gross = award.amountMinor + (payout.provider === "in_kind" ? withholding : 0n);
        conversion = `Original CAD award; withholding conversion: ${wh.fxSource}, rate ${wh.fxRate}`;
      } else {
        const converted = await fromUsd(tx, payout.grossMinor, "CAD", payout.paidAt!);
        gross = converted.minor;
        conversion = `USD books converted to CAD: ${converted.fxSource}, rate ${converted.fxRate}`;
      }
    }
    g.gross += gross;
    g.wh += withholding;
    g.rule.verified &&= payout.ruleVerified;
    const threshold = rule?.thresholdMinor ?? 0n;
    if (threshold > g.threshold) g.threshold = threshold;
    g.payments.push({ date: payout.paidAt!.toISOString().slice(0, 10), description: `Payout ${payout.id}; ${payout.ruleId} v${payout.ruleVersion}; ${conversion}`, grossMinor: gross.toString() });
    groups.set(key, g);
  }
  let count = 0;
  for (const g of groups.values()) {
    if (!["1042-S", "NR4"].includes(g.form) && g.gross < g.threshold && g.wh === 0n) continue;
    const profile = await currentProfile(tx, g.person.id);
    const pdf = await renderFilingDraft({
      form: g.form, year, payer: { name: org.name, address: "On file" },
      payee: { name: g.person.name, address: g.person.address, country: g.person.country, tinLast4: profile?.tinLast4 ?? undefined },
      currency: g.currency, grossMinor: g.gross.toString(), withholdingMinor: g.wh.toString(),
      box: g.form === "1099-MISC" ? "3" : g.form === "1099-NEC" ? "1" : g.form === "1042-S" ? "2" : g.form === "T4A" ? "Code 028 Other income (code to verify)" : "Gross income (income code to verify)",
      rule: g.rule, payments: g.payments,
    });
    const doc = await storeDocument(tx, { orgId: actor.orgId, personId: g.person.id, uploadedBy: actor.memberId, kind: "filing", name: `${g.form}-${year}-${g.person.name}.pdf`, mimeType: "application/pdf", bytes: pdf });
    await tx.insert(s.filing).values({ id: newId("fil"), orgId: actor.orgId, personId: g.person.id, year, form: g.form, grossMinor: g.gross, withholdingMinor: g.wh, documentId: doc.id })
      .onConflictDoUpdate({ target: [s.filing.orgId, s.filing.personId, s.filing.year, s.filing.form], set: { grossMinor: g.gross, withholdingMinor: g.wh, documentId: doc.id, status: "draft" } });
    count++;
  }
  await recordDecision(tx, { orgId: actor.orgId, objectType: "filings", objectId: String(year), action: "filings.generate", summary: `Drafted ${count} filing(s) for ${year}. US forms use USD; Canadian worksheets use CAD and remain unverified. Nothing is filed.`, actor, status: "done", tool: "draftFilings", facts: { year, count, settlementBasis: "paid", currencies: { US: "USD", CA: "CAD" } } });
  return { ok: true, message: `Drafted ${count} filing(s) for ${year}.`, data: { count, year } };
}

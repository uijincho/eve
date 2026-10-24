import { and, asc, eq } from "drizzle-orm";

import { resolveActor } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { toCsv } from "@/lib/server/csv";
import { json } from "@/lib/server/http";
import { loadAccountingJournal } from "@/lib/server/accounting-export";
import { AccountingExportError, exportLedgerCsv, exportQuickBooksAccountsCsv, exportQuickBooksJournalCsv, QBO_IMPORT_INSTRUCTIONS } from "@/lib/accounting";
import { render1042Summary } from "@/lib/pdf";

const STAFF = new Set(["organizer", "controller", "auditor"]);

function csvResponse(name: string, body: string) {
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

// GET /api/export?type=ledger|claims|payouts|filings  (CSV)
// GET /api/export?type=packet|filing&id=...           (stored draft PDF)
export async function GET(request: Request) {
  const actor = await resolveActor(request);
  if (!actor) return json({ ok: false, message: "Sign in to continue." }, 401);
  if (!STAFF.has(actor.role)) return json({ ok: false, message: "Exports are for organizers, controllers and auditors." }, 403);
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");
  const db = getDb();
  const orgId = actor.orgId;

  if (type === "1042-summary") {
    const year = Number(url.searchParams.get("year") ?? new Date().getUTCFullYear());
    if (!Number.isInteger(year) || year < 2020 || year > 2100) return json({ ok: false, message: "Choose a tax year from 2020 to 2100." }, 400);
    const [org] = await db.select({ name: s.organization.name, country: s.organization.country }).from(s.organization).where(eq(s.organization.id, orgId));
    if (org?.country !== "US") return json({ ok: false, message: "The 1042 summary is available for US organizations." }, 409);
    const filings = await db.select({ filing: s.filing, person: s.person }).from(s.filing).innerJoin(s.person, and(eq(s.person.id, s.filing.personId), eq(s.person.orgId, orgId)))
      .where(and(eq(s.filing.orgId, orgId), eq(s.filing.form, "1042-S"), eq(s.filing.year, year))).orderBy(asc(s.person.name));
    const bytes = await render1042Summary({ year, payerName: org.name, recipients: filings.map(({ filing: f, person: p }) => ({ name: p.name, country: p.country, grossMinor: f.grossMinor.toString(), withholdingMinor: f.withholdingMinor.toString(), filingId: f.id })) });
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="eve-1042-summary-${year}-DRAFT.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }

  if (type === "qbo-accounts") return csvResponse("eve-quickbooks-accounts.csv", exportQuickBooksAccountsCsv());
  if (type === "ledger" || type === "qbo" || type === "qbo-manifest") {
    const dateFormat = url.searchParams.get("dateFormat") ?? "MDY";
    const multicurrency = url.searchParams.get("multicurrency") ?? "false";
    if (!["MDY", "DMY", "ISO"].includes(dateFormat) || !["true", "false"].includes(multicurrency)) return json({ ok: false, message: "Use dateFormat MDY, DMY or ISO, and multicurrency true or false." }, 400);
    try {
      const entries = await loadAccountingJournal(db, orgId);
      if (type === "ledger") return csvResponse("eve-ledger.csv", exportLedgerCsv(entries));
      const [org] = await db.select({ currency: s.organization.currency }).from(s.organization).where(eq(s.organization.id, orgId));
      const result = exportQuickBooksJournalCsv(entries, { homeCurrency: org?.currency ?? "USD", multicurrency: multicurrency === "true", dateFormat: dateFormat as "MDY" | "DMY" | "ISO" });
      const { csv, ...manifest } = result;
      if (type === "qbo-manifest") return json({ ...manifest, instructions: QBO_IMPORT_INSTRUCTIONS });
      // Never hand over an apparently complete file that silently omitted foreign-currency entries.
      if (result.excluded.length) return json({ ok: false, message: "This export contains foreign-currency entries. Enable multicurrency in your QuickBooks sandbox and request multicurrency=true, or download the native ledger CSV.", excluded: result.excluded }, 409);
      return csvResponse("eve-quickbooks-sandbox-journals.csv", csv);
    } catch (error) {
      if (error instanceof AccountingExportError) return json({ ok: false, message: "Ledger export needs review before it can be downloaded.", problems: error.problems }, 409);
      throw error;
    }
  }
  if (type === "packet-csv" && id) {
    const [row] = await db.select({ packet: s.sponsorPacket, payout: s.payout, person: s.person, method: s.payoutMethod }).from(s.sponsorPacket)
      .innerJoin(s.payout, and(eq(s.payout.id, s.sponsorPacket.payoutId), eq(s.payout.orgId, orgId)))
      .innerJoin(s.person, and(eq(s.person.id, s.payout.personId), eq(s.person.orgId, orgId)))
      .leftJoin(s.payoutMethod, and(eq(s.payoutMethod.id, s.payout.payoutMethodId), eq(s.payoutMethod.orgId, orgId)))
      .where(and(eq(s.sponsorPacket.id, id), eq(s.sponsorPacket.orgId, orgId)));
    if (!row) return json({ ok: false, message: "Packet not found." }, 404);
    const { packet: pk, payout: p, person, method } = row;
    return csvResponse("eve-sponsor-request.csv", toCsv(["packet_id", "payout_id", "recipient", "country", "requested_minor", "gross_minor", "withholding_minor", "fee_minor", "net_minor", "currency", "destination_currency", "expected_received_minor", "account_last4", "status", "tax_rule", "truth"], [[pk.id, p.id, person.name, person.country, pk.requestedMinor, p.grossMinor, p.withholdingMinor, p.feeMinor, p.netMinor, p.currency, p.destinationCurrency, p.destinationNetMinor, method?.last4 ?? "", pk.status, `${p.ruleId} v${p.ruleVersion}`, p.truth]]));
  }
  if (type === "claims") {
    const rows = await db.select({ c: s.claim, p: s.person }).from(s.claim).innerJoin(s.person, eq(s.person.id, s.claim.personId)).where(eq(s.claim.orgId, orgId)).orderBy(asc(s.claim.createdAt));
    return csvResponse("claims.csv", toCsv(["claim_id", "person", "type", "merchant", "category", "amount_minor", "currency", "usd_minor", "fx_rate", "fx_source", "purchased_at", "status", "reason", "failed_checks"],
      rows.map(({ c, p }) => [c.id, p.name, c.type, c.merchant, c.category, c.amountMinor, c.currency, c.usdMinor, c.fxRate, c.fxSource, c.purchasedAt.toISOString(), c.status, c.reason, c.checks.filter((x) => !x.passed).map((x) => x.code).join(" ")])));
  }
  if (type === "payouts") {
    const rows = await db.select({ x: s.payout, p: s.person }).from(s.payout).innerJoin(s.person, eq(s.person.id, s.payout.personId)).where(eq(s.payout.orgId, orgId)).orderBy(asc(s.payout.createdAt));
    return csvResponse("payouts.csv", toCsv(["payout_id", "person", "source_type", "source_id", "gross_minor", "withholding_minor", "fee_minor", "net_minor", "currency", "destination_currency", "destination_net_minor", "fx_rate", "provider", "truth", "status", "rule", "requested_by", "released_by", "paid_at", "provider_ref"],
      rows.map(({ x, p }) => [x.id, p.name, x.sourceType, x.claimId ?? x.awardId, x.grossMinor, x.withholdingMinor, x.feeMinor, x.netMinor, x.currency, x.destinationCurrency, x.destinationNetMinor, x.fxRate, x.provider, x.truth, x.status, `${x.ruleId} v${x.ruleVersion}`, x.requestedBy, x.releasedBy, x.paidAt?.toISOString(), x.providerRef])));
  }
  if (type === "filings") {
    const rows = await db.select({ f: s.filing, p: s.person, t: s.taxProfile }).from(s.filing).innerJoin(s.person, eq(s.person.id, s.filing.personId))
      .leftJoin(s.taxProfile, and(eq(s.taxProfile.personId, s.filing.personId), eq(s.taxProfile.orgId, orgId)))
      .where(eq(s.filing.orgId, orgId));
    const seen = new Set<string>();
    const out = rows.filter(({ t }) => !t || !t.supersededAt).filter(({ f }) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
    return csvResponse("filings.csv", toCsv(["filing_id", "person", "country", "year", "form", "gross_minor", "withholding_minor", "tin_last4", "status"],
      out.map(({ f, p, t }) => [f.id, p.name, p.country, f.year, f.form, f.grossMinor, f.withholdingMinor, t?.tinLast4 ?? "", f.status])));
  }
  if ((type === "packet" || type === "filing") && id) {
    const table = type === "packet" ? s.sponsorPacket : s.filing;
    const [row] = await db.select({ documentId: table.documentId }).from(table).where(and(eq(table.id, id), eq(table.orgId, orgId)));
    if (!row?.documentId) return json({ ok: false, message: "Not found." }, 404);
    const [doc] = await db.select().from(s.document).where(and(eq(s.document.id, row.documentId), eq(s.document.orgId, orgId)));
    if (!doc) return json({ ok: false, message: "Not found." }, 404);
    return new Response(new Uint8Array(doc.bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${doc.name.replace(/"/g, "")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  return json({ ok: false, message: "Choose ledger, qbo, qbo-accounts, qbo-manifest, claims, payouts, filings, packet, packet-csv or filing." }, 400);
}

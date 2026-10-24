import { and, asc, eq } from "drizzle-orm";

import { resolveActor } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { toCsv } from "@/lib/server/csv";
import { json } from "@/lib/server/http";

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

  if (type === "ledger") {
    const rows = await db.select({ e: s.journalEntry, l: s.journalLine, a: s.ledgerAccount }).from(s.journalLine)
      .innerJoin(s.journalEntry, eq(s.journalEntry.id, s.journalLine.entryId)).innerJoin(s.ledgerAccount, eq(s.ledgerAccount.id, s.journalLine.accountId))
      .where(eq(s.journalEntry.orgId, orgId)).orderBy(asc(s.journalEntry.postedAt), asc(s.journalEntry.id));
    return csvResponse("ledger.csv", toCsv(["entry_id", "entry_date", "memo", "source_type", "source_id", "reverses_entry_id", "account_code", "account_name", "debit_minor", "credit_minor", "currency", "line_memo"],
      rows.map(({ e, l, a }) => [e.id, e.entryDate, e.memo, e.sourceType, e.sourceId, e.reversesEntryId, a.code, a.name, l.debitMinor, l.creditMinor, l.currency, l.memo])));
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
  return json({ ok: false, message: "type must be ledger, claims, payouts, filings, packet or filing." }, 400);
}

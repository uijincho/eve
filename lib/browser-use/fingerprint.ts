import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "@/lib/db";

/**
 * A conservative snapshot of the inputs used by payout/ledger policy. The full
 * gate runs before the browser starts. Under the same organization lock, the
 * portal refuses submission if any input changed since that gate. No PII is
 * stored in the fingerprint or sent to Browser Use.
 */
export async function financeFingerprint(tx: Tx, orgId: string): Promise<string> {
  const scoped = ["event", "org_member", "person", "tax_profile", "payout_method", "payout", "award", "claim", "tax_rule_override", "budget_line", "sponsor_packet", "accounting_period", "journal_entry", "ledger_account"];
  const entries = scoped.map((name) => sql`${name}::text, (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from ${sql.identifier(name)} t where t.org_id = ${orgId})`);
  entries.push(sql`'organization', (select to_jsonb(t) from organization t where t.id = ${orgId})`);
  entries.push(sql`'rules', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from tax_rule t)`);
  entries.push(sql`'fx', (select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) from fx_rate t)`);
  entries.push(sql`'documents', (select coalesce(jsonb_agg(jsonb_build_array(id, sha256) order by id), '[]'::jsonb) from document where org_id = ${orgId} and kind <> 'screenshot')`);
  entries.push(sql`'date', (now() at time zone 'UTC')::date`);
  entries.push(sql`'closed', (select coalesce(jsonb_agg(jsonb_build_array(id, now() >= closing_at) order by id), '[]'::jsonb) from event where org_id = ${orgId})`);
  entries.push(sql`'expired_forms', (select coalesce(jsonb_agg(jsonb_build_array(id, now() >= expires_at) order by id), '[]'::jsonb) from tax_profile where org_id = ${orgId})`);
  const result = await tx.execute(sql`select jsonb_build_object(${sql.join(entries, sql`, `)})::text as context`);
  return createHash("sha256").update(String(result.rows[0].context)).digest("hex");
}

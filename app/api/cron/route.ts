import { eq, and, gt, isNull } from "drizzle-orm";
import { verifyBearer } from "@/lib/agent/webhook-auth";
import { deliverRecordedNotice } from "@/lib/agent/automation";
import { queueScheduledRun } from "@/lib/agent/triggers";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { deliverBankVerification } from "@/lib/server/bank-verification-delivery";

export const maxDuration = 120;

/** Vercel sends CRON_SECRET as a bearer token. Preview supports the same authenticated manual request. */
export async function GET(request: Request) {
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const db = getDb();
  const orgs = await db.select({ id: s.organization.id }).from(s.organization);
  const today = new Date();
  const filingYear = today.getUTCMonth() === 0 && today.getUTCDate() === 1 ? today.getUTCFullYear() - 1 : undefined;
  const runs: { orgId: string; runId: string | null }[] = [];
  let failed = 0;
  for (const org of orgs) {
    try { runs.push({ orgId: org.id, runId: await queueScheduledRun(org.id, filingYear) }); }
    catch { failed++; }
  }
  const notices = await db.select({ id: s.notice.id, orgId: s.notice.orgId }).from(s.notice).where(and(eq(s.notice.status, "queued"), isNull(s.notice.privateVaultId))).limit(100);
  let delivered = 0;
  for (let offset = 0; offset < notices.length; offset += 5) {
    const results = await Promise.allSettled(notices.slice(offset, offset + 5).map((n) => deliverRecordedNotice(n.orgId, n.id)));
    delivered += results.filter((r) => r.status === "fulfilled" && ["sent", "simulated"].includes(r.value.status)).length;
  }
  const methods = await db.select({ id: s.payoutMethod.id, orgId: s.payoutMethod.orgId }).from(s.payoutMethod)
    .where(and(eq(s.payoutMethod.status, "pending_verification"), gt(s.payoutMethod.verificationExpiresAt, today))).limit(20);
  let bankVerificationsDelivered = 0;
  for (let offset = 0; offset < methods.length; offset += 5) {
    const results = await Promise.allSettled(methods.slice(offset, offset + 5).map((m) => deliverBankVerification(m.orgId, m.id)));
    bankVerificationsDelivered += results.filter((r) => r.status === "fulfilled" && r.value.status === "sent").length;
  }
  return Response.json({ ok: failed === 0, runs, failed, delivered, bankVerificationsDelivered, ...(filingYear ? { filingYear } : {}) }, { status: failed ? 207 : 200 });
}

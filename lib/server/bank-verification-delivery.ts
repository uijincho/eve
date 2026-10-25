// Server-only. Delivers a pending bank change's confirmation code to the email
// captured on the pending payout method (verificationSentTo, fixed when the
// change was requested), through the shared notification adapter.
//
// Call after payout.bankChange commits, with ids only:
//   after(() => deliverBankVerification(actor.orgId, result.data.methodId))
// The code is decrypted here, handed to the adapter and dropped. It is never
// returned, logged, persisted in clear or passed through workflow arguments.
// Real email goes out only when EVE_NOTIFICATIONS_LIVE=true and a provider is
// configured; demo organizations are always simulated. When the code cannot be
// delivered, payouts stay frozen and the notices say so.

import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb, type Executor } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { deliverNotification } from "@/lib/notifications";

import { maskEmail } from "./core";
import { openSecret } from "./vault";

export interface BankVerificationDelivery {
  status: "sent" | "simulated" | "queued" | "skipped";
  detail: string;
}

export async function deliverBankVerification(orgId: string, methodId: string, db: Executor = getDb()): Promise<BankVerificationDelivery> {
  const [method] = await db.select().from(s.payoutMethod)
    .where(and(eq(s.payoutMethod.id, methodId), eq(s.payoutMethod.orgId, orgId), eq(s.payoutMethod.status, "pending_verification")));
  if (!method?.verificationVaultId || !method.verificationSentTo) return { status: "skipped", detail: "No bank change is waiting for verification." };
  if (!method.verificationExpiresAt || method.verificationExpiresAt.getTime() < Date.now()) return { status: "skipped", detail: "The confirmation code expired." };
  const [org] = await db.select({ isDemo: s.organization.isDemo }).from(s.organization).where(eq(s.organization.id, orgId));
  const [person] = await db.select({ name: s.person.name }).from(s.person).where(and(eq(s.person.id, method.personId), eq(s.person.orgId, orgId)));
  const [notice] = await db.select().from(s.notice).where(and(eq(s.notice.orgId, orgId), eq(s.notice.privateVaultId, method.verificationVaultId)));
  if (!org || !person) return { status: "skipped", detail: "No bank change is waiting for verification." };
  if (notice?.status === "sent") return { status: "sent", detail: "The confirmation code was already emailed." };

  const masked = maskEmail(method.verificationSentTo);
  const code = await openSecret(db, orgId, method.verificationVaultId);
  const delivery = code
    ? await deliverNotification({
      channel: "email", title: "Confirm your new payout account", key: `bank-verify:${method.id}`,
      recipientEmail: method.verificationSentTo, synthetic: org.isDemo,
      body: `Eve received a request to send your payouts to an account ending ••${method.last4}. Your confirmation code is ${code}. It expires ${method.verificationExpiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC. If you did not ask for this, do not share the code and tell the organizers.`,
    })
    : { status: "queued" as const, detail: "The confirmation code could not be read." };

  // Adapter details mention the portal notice, which never carries the code; describe the outcome here instead.
  const reason = !code ? "the code could not be read" : delivery.status === "simulated" ? "email delivery is not configured" : "the email provider did not accept it";
  const request = `We received a request to send your payouts to an account ending ••${method.last4}.`;
  const body = delivery.status === "sent"
    ? `${request} The confirmation code was emailed to ${masked}. If this was you, enter it in Eve. If not, do nothing and tell the organizers.`
    : org.isDemo
      ? `${request} The recipient sees the code in their Eve inbox.`
      : `${request} The confirmation code has not been delivered: ${reason}. Payouts stay frozen until the change is confirmed with that code.`;
  if (notice) await db.update(s.notice).set({ status: delivery.status, body }).where(eq(s.notice.id, notice.id));
  if (delivery.status !== "sent" && !org.isDemo) {
    // One staff notice per pending method (deterministic id), however often delivery is retried.
    const id = `ntc_bv_${createHash("sha256").update(method.id).digest("hex").slice(0, 24)}`;
    await db.insert(s.notice).values({
      id, orgId, channel: "organizers", status: "queued", title: `Bank change code not delivered: ${person.name}`,
      body: `The confirmation code for ${person.name}'s change to ••${method.last4} was not emailed to ${masked}: ${reason}. Payouts stay frozen; Eve never shows the code in the app.`,
    }).onConflictDoNothing();
  }
  return { status: delivery.status, detail: delivery.status === "sent" ? `Confirmation code emailed to ${masked}.` : `Not delivered: ${reason}.` };
}

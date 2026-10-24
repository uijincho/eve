import { after } from "next/server";
import { resolveActor } from "@/lib/auth/session";
import { json, sameOrigin } from "@/lib/server/http";
import { runAuthorizedAction } from "@/lib/server/services";
import { buildSnapshot } from "@/lib/server/snapshot";
import { actionSchemas } from "@/lib/server/action-schemas";
import { queueControllerRelease } from "@/lib/agent/release";
import { queueAgentRun, startPendingApprovals, startTaxChases } from "@/lib/agent/triggers";

export const maxDuration = 120;

// POST /api/actions { action, payload } -> ActionResult (+ data.snapshot on success).
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, message: "Cross-site request rejected." }, 403);
  const actor = await resolveActor(request);
  if (!actor) return json({ ok: false, message: "Sign in to continue." }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Body must be JSON: { action, payload }." }, 400);
  }
  const { action, payload } = (body ?? {}) as { action?: unknown; payload?: unknown };
  if (typeof action !== "string") return json({ ok: false, message: "Missing action." }, 400);
  let response;
  if (action === "payout.release") {
    const parsed = actionSchemas["payout.release"].safeParse(payload ?? {});
    if (!parsed.success) return json({ ok: false, message: "Choose the payout ids to release." }, 400);
    response = await queueControllerRelease(actor, "id" in parsed.data ? [parsed.data.id] : parsed.data.ids);
  } else if (action === "agent.run" || action === "demo.run") {
    const parsed = actionSchemas[action].safeParse(payload ?? {});
    if (!parsed.success) return json({ ok: false, message: "Invalid agent run request." }, 400);
    try { response = await queueAgentRun(actor, "kind" in parsed.data ? parsed.data.kind : "all", action === "demo.run"); }
    catch { return json({ ok: false, message: "The background service is unavailable. Your existing decisions are saved; try again shortly." }, 503); }
  } else {
    response = await runAuthorizedAction(actor, action, payload ?? {});
  }
  const { status, ...result } = response;
  if (result.ok && ["award.create", "award.choose", "award.confirm", "tax.submit", "claim.submit", "claim.review", "payout.propose", "payout.verify", "payout.retry"].includes(action)) {
    // The business transaction already committed. Cron retries missed starts; hooks deduplicate active runs.
    after(async () => {
      const launched = await Promise.allSettled([startPendingApprovals(actor.orgId), startTaxChases(actor.orgId)]);
      if (launched.some((r) => r.status === "rejected")) console.warn("[workflow] A follow-up start will be retried by the scheduled sweep.");
    });
  }
  if (result.ok && action !== "flight.search") {
    // demo.reset may have replaced the actor's org data; persona ids are stable.
    const snapshot = await buildSnapshot(actor);
    return json({ ...result, data: { ...(result.data ?? {}), snapshot } }, status);
  }
  return json(result, status);
}

import { resolveActor } from "@/lib/auth/session";
import { verifyBearer } from "@/lib/agent/webhook-auth";
import { stripeFromEnv } from "@/lib/payouts/stripe";

export const maxDuration = 30;

/** Read-only capability probe; never returns credentials or creates money movements. */
export async function GET(request: Request): Promise<Response> {
  const internal = verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (!internal) {
    const actor = await resolveActor(request);
    if (!actor || !["organizer", "controller"].includes(actor.role)) {
      return Response.json({ error: "Organizer or controller access required." }, { status: 403 });
    }
  }
  const provider = stripeFromEnv();
  if (!provider) return Response.json({ configured: false, mode: "Simulated", detail: "No Stripe test key is configured." });
  try {
    const platform = await provider.verifyPlatform();
    return Response.json({
      configured: true, mode: "Test mode", verified: true,
      country: platform.country, currency: platform.defaultCurrency,
      chargesEnabled: platform.chargesEnabled, payoutsEnabled: platform.payoutsEnabled,
      notes: platform.notes,
      detail: "Platform credentials verified. Individual recipient onboarding and transfer capability still require verification.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ configured: true, mode: "Simulated", verified: false, detail: "Stripe could not verify the test account. Use the simulated payout provider until configuration is resolved." }, { status: 502 });
  }
}

// Stripe webhook receiver (payout and Connect account events).
// TODO: verify the signature with STRIPE_WEBHOOK_SECRET before handling events.
export async function POST(): Promise<Response> {
  return Response.json({ error: "Not implemented" }, { status: 501 });
}

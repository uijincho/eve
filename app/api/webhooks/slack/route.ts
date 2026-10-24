// Slack interactivity receiver (actions taken on Eve's Slack notifications).
// TODO: verify the Slack request signature before handling actions.
export async function POST(): Promise<Response> {
  return Response.json({ error: "Not implemented" }, { status: 501 });
}

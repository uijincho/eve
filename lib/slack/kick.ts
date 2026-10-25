// Cheap entry points for the rest of Eve. They load nothing and do nothing until
// the Slack app is configured, and they never throw: the caller's own work has
// already committed, and the next sync or the daily sweep catches Slack up.

import { slackAppConfig } from "./config";

/** Brings this org's Slack cards and alerts up to date. */
export async function kickSlack(orgId: string): Promise<void> {
  if (!slackAppConfig()) return;
  const { syncSlackSafe } = await import("./sync");
  await syncSlackSafe(orgId);
}

/** The daily digest, posted once per day per org. */
export async function postSlackDigest(orgId: string): Promise<void> {
  if (!slackAppConfig()) return;
  try {
    const { postDigest } = await import("./sync");
    await postDigest(orgId, "daily");
  } catch {
    console.warn("[slack] Daily digest not posted; tomorrow's review posts the next one.");
  }
}

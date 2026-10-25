import { and, eq, inArray } from "drizzle-orm";

import type { ActorContext } from "@/lib/auth/session";
import type * as C from "@/lib/contracts";
import type { Executor } from "@/lib/db";
import * as s from "@/lib/db/schema";

import { slackAppConfig } from "./config";
import { installationFor } from "./identity";

/** Settings view of the Slack connection. Linked means linked in the installed workspace. */
export async function slackStatus(actor: ActorContext, db: Executor): Promise<C.SlackStatus> {
  // Without the app's credentials nothing Slack-related is read, so the app runs as before.
  if (!slackAppConfig()) return { configured: false, installed: false, me: { linked: false, muted: [] }, members: [] };
  const inst = await installationFor(actor.orgId, db);
  const [members, links] = await Promise.all([
    db.select({ id: s.orgMember.id, name: s.orgMember.name, role: s.orgMember.role }).from(s.orgMember)
      .where(and(eq(s.orgMember.orgId, actor.orgId), inArray(s.orgMember.role, ["organizer", "controller"]))),
    db.select().from(s.slackUserLink).where(eq(s.slackUserLink.orgId, actor.orgId)),
  ]);
  const linked = new Set(links.filter((l) => inst && l.teamId === inst.teamId && l.slackUserId).map((l) => l.memberId));
  const mine = links.find((l) => l.memberId === actor.memberId);
  return {
    configured: true,
    installed: Boolean(inst),
    teamName: inst?.teamName, channelName: inst?.channelName ?? undefined,
    onDutyMemberId: inst?.onDutyMemberId ?? undefined, backupMemberId: inst?.backupMemberId ?? undefined,
    me: { linked: linked.has(actor.memberId), muted: mine?.muted ?? [] },
    members: members.map((m) => ({ ...m, linked: linked.has(m.id) })).sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)),
  };
}

# Eve Slack app

Eve's Slack app sends approvals by direct message to the person who must act, posts informational alerts and digests in one team channel, and lets staff approve from Slack with the same permissions as the web app. The product spec is in [PRD.md](../PRD.md#slack-app); this page covers setup and how it works.

## Set up

1. Create the app at <https://api.slack.com/apps> → **Create New App** → **From a manifest**. Paste [`slack/manifest.yml`](../slack/manifest.yml) after replacing `YOUR-EVE-HOST` with Eve's public HTTPS host. For local work, use a tunnel to `localhost:3000` and set `EVE_APP_URL` (or `BETTER_AUTH_URL`) to the tunnel's URL so links and the OAuth redirect match.
2. From **Basic Information**, copy the Client ID, Client Secret and Signing Secret into `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET`. `EVE_VAULT_KEY` must be set: the bot token is sealed with it.
3. Run `pnpm db:migrate` (migration `0009_slack`).
4. As an organizer, open **Settings → Slack → Connect Slack**. Slack asks which channel to post in; that becomes the team channel (for example `#eve-finance`). For a private channel, invite `@Eve` to it.
5. Each organizer and controller opens **Settings → Slack → Link Slack** and types the code Eve shows, as `/eve link ABCD-EFGH`, in Slack. Codes work once and expire after 10 minutes.
6. Optionally pick the **organizer on duty** (escalated claims and prize decisions) and the **backup approver** (approvals that waited too long). Unset, every eligible linked person gets them.

Without the three Slack variables, nothing Slack-related loads or runs, and Settings explains what is missing.

## What goes where

| Kind | Where | Examples |
| --- | --- | --- |
| Interactive | DM to the person who must act | Payout batch ready (Release, Hold), bank-change freeze (Keep frozen, Mark verified), escalated claim (Approve, Reject, Ask for info), prize decision (Accept recommendation, Compare options), backup approver for anything overdue |
| Informational | Team channel, one post per 15 minutes | Payout failed or returned, sponsor reconciliation exception, budget at 80% or 100%, computer use finished or stuck (screenshots in the thread), unverified tax rule used |
| Digest | Team channel | Daily, after the scheduled review; once more at the end of event weekend |
| Event weekend | Team channel, immediately | Winners board (edited in place) and the closing-ceremony countdown while anything blocks release |

## Rules

- **Permissions.** A Slack user acts only as the Eve member who linked them. The role is re-read on every request. Buttons call the same server functions as the web (`runAuthorizedAction`, `queueControllerRelease`), so organizer limits, segregation of duties, beneficiary checks and budget caps apply unchanged. Release is bound to the exact batch shown; a changed batch refreshes the card and releases nothing.
- **Data.** Cards show names, amounts and last 4 digits. Free text is scrubbed (`lib/slack/text.ts`), and `slackApi` refuses to send display text that looks like an SSN, ITIN, EIN or a 7+ digit number. Computer use screenshots come from runs whose taxpayer-ID guard blocks Eve from ever typing one.
- **Threads.** One message per item and recipient. Status lines go in the thread; the original is edited into its outcome when resolved. A claim sent back for information reopens its card when the attendee answers.
- **Logging.** Decisions from Slack write the usual `decision_log` rows with `facts.via = "slack"`, shown as "via Slack" in the audit trail. Hold and Keep frozen are logged decisions that do not change payout state.
- **Noise.** Mute direct-message categories (`release`, `freeze`, `claims`, `prizes`, `overdue`) in the app's Home tab or with `/eve mute claims`. If everyone who can act mutes something, it goes to the team channel.

## `/eve`

| Command | Effect |
| --- | --- |
| `/eve link CODE` | Link your Eve account |
| `/eve unlink` | Unlink this Slack account |
| `/eve mute CATEGORY`, `/eve unmute CATEGORY` | Mute or unmute a direct-message category |
| `/eve status` | Your Eve name and role, and how many cards are waiting for you |

## How it works

| Piece | File |
| --- | --- |
| Who should see what, computed from Eve's state (pure) | `lib/slack/model.ts`, loaded by `lib/slack/load.ts` |
| Block Kit cards, modals, digest, App Home (pure) | `lib/slack/blocks.ts` |
| Reconciler: post, edit, thread, resolve; 15-minute batches; digests | `lib/slack/sync.ts` |
| Buttons, modals, `/eve`, Events API | `lib/slack/interactions.ts`, route `app/api/webhooks/slack` |
| Workspace install (signed OAuth state), routing settings | `lib/slack/install.ts`, routes `app/api/slack/install` and `app/api/slack/oauth` |
| Account links, actor resolution, mutes | `lib/slack/identity.ts` |
| Batch timer and closing-ceremony countdown | `workflows/slack.ts` |

`syncSlack(orgId)` is idempotent. Each post is claimed by inserting its `slack_message` row first, edits and thread notes are conditional updates, and a card is re-sent only when its rendered fingerprint changes. It runs after every successful action (web or Slack), at the end of agent runs, at approval reminders, when a computer use run ends, at each countdown mark and in the daily cron, and does at most 30 Slack writes per run; the next run continues. Slack's 3-second limit is met by acknowledging at once and doing the work with `after()`, reporting back in the card's thread.

A demo reset keeps the workspace connected and accounts linked, and forgets posted cards and queued alerts (they refer to deleted rows). Buttons on an old card then answer that the item no longer exists. Removing the app from Slack (`app_uninstalled`, `tokens_revoked`) disconnects it in Eve.

## Limits

- Direct release only. In sponsor mode, money moves through `sponsor.submit`, which stays in Eve.
- Hold does not stop another controller from releasing; it records the reason and shows it on every controller's card until the batch changes.
- Mark verified needs the code from the attendee's original email, exactly like the web. Staff type it into a Slack modal that goes straight to `payout.verify`; Eve never posts the code in a message.
- The countdown runs from the closing-ceremony time on the event. Moving it starts a new countdown.

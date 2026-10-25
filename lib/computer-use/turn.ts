/**
 * One portal-agent turn, shared by the lab (in-memory) and the sponsor-portal workflow (durable).
 * The caller owns persistence: it hands in the conversation state, and gets back what happened.
 */
import type { BetaContentBlock, BetaMessageParam, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Sandbox } from "@e2b/desktop";

import { nextTurn } from "./agent";
import { capture, currentPage, perform, portalEvents, portalRecords, typeSecret, type PortalEvent } from "./computer";
import { checkComputerAction, checkPasswordTool, describeAction, type GuardRule, type PortalPage } from "./guards";

export interface ActionLog {
  name: string;
  summary: string;
  outcome: "done" | "blocked" | "failed" | "skipped";
  detail?: string;
  rule?: GuardRule;
}

/** Everything a run must keep between turns. JSON-serializable, so a workflow can store it. */
export interface AgentState {
  messages: BetaMessageParam[];
  /** Results of the last turn's actions, sent with the next request. */
  pending: BetaToolResultBlockParam[] | null;
  /** An operator instruction (such as an approval) to deliver with the next request. */
  operatorNote: string | null;
  approved: boolean;
  /** How many portal log events have been seen, so each turn reports only new ones. */
  seenEvents: number;
}

export interface TurnOutcome {
  ms: number;
  notes: string[];
  reasoning: string[];
  actions: ActionLog[];
  guards: { rule: GuardRule; detail: string }[];
  /** Base64 PNG of the screen after the turn. */
  shot: string;
  pageBefore: PortalPage;
  pageAfter: PortalPage;
  portalSaid: PortalEvent[];
  /** The model ended its turn without acting. */
  ended: boolean;
  escalation: { field: string; reason: string } | null;
  confirmation: { number: string; record: Record<string, unknown> } | null;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  /** The model that actually answered, from the response (differs from the request after a fallback). */
  model: string;
  /** Set when a refusal fallback ran this turn: which model declined. */
  fellBackFrom: string | null;
}

const SETTLE_MS = 600;
const HALT_TEXT = "Not executed: an earlier computer action in this turn failed.";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function newAgentState(brief: string, firstShot: string): AgentState {
  return {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `${brief}\n\nChrome is open on the portal. Enter this payment request and stop on the Review page.` },
        { type: "image", source: { type: "base64", media_type: "image/png", data: firstShot } },
      ],
    }],
    pending: null,
    operatorNote: null,
    approved: false,
    seenEvents: 0,
  };
}

export function approvalNote(by: string, at: string): string {
  return `Controller approval granted by ${by} at ${at} for the Review page as shown. Click "Submit request" once. When the confirmation page appears, call report_submitted with the confirmation number.`;
}

/** Appends whatever the model needs to see next, keeping the history append-only. */
function prepareMessages(state: AgentState) {
  if (state.pending) {
    state.messages.push({ role: "user", content: state.pending });
    state.pending = null;
    // Operator instructions travel as a mid-conversation system message after the tool results.
    if (state.operatorNote) state.messages.push({ role: "system", content: state.operatorNote });
  } else if (state.messages.at(-1)?.role === "assistant") {
    state.messages.push({ role: "user", content: state.operatorNote ?? "Continue with the task." });
  }
  state.operatorNote = null;
}

/**
 * Adds the fresh screenshot to the last result that is not an error. The API rejects images in an
 * error result, and a blocked action is followed by skipped ones that are all errors. With no
 * successful result, the screenshot is left out and Claude takes its own next turn.
 */
export function attachScreenshot(results: BetaToolResultBlockParam[], shot: string): boolean {
  const target = [...results].reverse().find((r) => !r.is_error);
  if (!target) return false;
  const content = typeof target.content === "string" ? [{ type: "text" as const, text: target.content }] : [...(target.content ?? [])];
  target.content = [...content, { type: "image", source: { type: "base64", media_type: "image/png", data: shot } }];
  return true;
}

function toolResult(id: string, content: BetaToolResultBlockParam["content"], opts: { computer?: boolean; error?: boolean } = {}): BetaToolResultBlockParam {
  return { type: "tool_result", tool_use_id: id, content, ...(opts.error ? { is_error: true } : {}), ...(opts.computer ? { toolset_name: "computer" } : {}) };
}

/**
 * Runs one model turn and every action in it, checking each action against the guards first.
 * `secret` is the portal password: typed by this code when the model asks, never shown to it.
 */
export async function runAgentTurn(desktop: Sandbox, state: AgentState, secret: string, drill?: string): Promise<TurnOutcome> {
  const started = Date.now();
  const pageBefore = (await currentPage(desktop)).page;
  prepareMessages(state);
  const response = await nextTurn(state.messages, drill);
  state.messages.push({ role: "assistant", content: response.content });
  if (response.stop_reason === "refusal") throw new Error("Claude declined this turn, and the fallback model declined too.");

  const notes: string[] = [];
  const reasoning: string[] = [];
  const actions: ActionLog[] = [];
  const guards: TurnOutcome["guards"] = [];
  const results: BetaToolResultBlockParam[] = [];
  let escalation: TurnOutcome["escalation"] = null;
  let confirmation: TurnOutcome["confirmation"] = null;
  let halted = false;
  let lastShot: string | null = null;
  let fellBackFrom: string | null = null;

  for (const block of response.content as BetaContentBlock[]) {
    if (block.type === "fallback") fellBackFrom = block.from.model;
    if (block.type === "text" && block.text.trim()) notes.push(block.text.trim());
    if (block.type === "thinking" && block.thinking.trim()) reasoning.push(block.thinking.trim());
    if (block.type !== "tool_use") continue;
    const input = (block.input ?? {}) as Record<string, unknown>;
    const isComputer = "toolset_name" in block && block.toolset_name === "computer";
    const summary = describeAction(block.name, input);
    if (halted) {
      results.push(toolResult(block.id, HALT_TEXT, { computer: isComputer, error: true }));
      actions.push({ name: block.name, summary, outcome: "skipped" });
      continue;
    }
    try {
      if (isComputer) {
        // The page is re-read before every action, so a batch that crosses onto Review is still stopped.
        const { page } = await currentPage(desktop);
        const verdict = checkComputerAction(block.name, input, { page, approved: state.approved });
        if (!verdict.ok) {
          halted = true;
          guards.push({ rule: verdict.rule, detail: summary });
          results.push(toolResult(block.id, verdict.message, { computer: true, error: true }));
          actions.push({ name: block.name, summary, outcome: "blocked", rule: verdict.rule, detail: verdict.message });
          continue;
        }
        if (block.name === "screenshot") {
          await sleep(SETTLE_MS);
          lastShot = await capture(desktop);
          results.push(toolResult(block.id, [{ type: "image", source: { type: "base64", media_type: "image/png", data: lastShot } }], { computer: true }));
        } else {
          const text = await perform(desktop, block.name, input);
          lastShot = null;
          results.push(toolResult(block.id, [{ type: "text", text }], { computer: true }));
        }
        actions.push({ name: block.name, summary, outcome: "done" });
      } else if (block.name === "type_portal_password") {
        const { page } = await currentPage(desktop);
        const verdict = checkPasswordTool({ page, approved: state.approved });
        if (!verdict.ok) {
          guards.push({ rule: verdict.rule, detail: summary });
          results.push(toolResult(block.id, verdict.message, { error: true }));
          actions.push({ name: block.name, summary, outcome: "blocked", rule: verdict.rule, detail: verdict.message });
          continue;
        }
        await typeSecret(desktop, secret);
        lastShot = null;
        results.push(toolResult(block.id, "Typed the portal password into the focused field."));
        actions.push({ name: block.name, summary, outcome: "done" });
      } else if (block.name === "escalate_to_controller") {
        escalation = { field: String(input.portal_field ?? ""), reason: String(input.reason ?? "") };
        results.push(toolResult(block.id, "Escalation recorded and sent to the controller. Stop now; nothing will be submitted."));
        actions.push({ name: block.name, summary, outcome: "done" });
        halted = true;
      } else if (block.name === "report_submitted") {
        const number = String(input.confirmation_number ?? "").trim();
        // The portal's own records decide, not the model's report.
        const record = (await portalRecords(desktop)).find((r) => r.confirmation === number) ?? null;
        if (!record) {
          results.push(toolResult(block.id, `The portal has no request with confirmation ${number}. Read the number again from the screen.`, { error: true }));
          actions.push({ name: block.name, summary, outcome: "failed", detail: "No matching portal record" });
        } else {
          confirmation = { number, record };
          results.push(toolResult(block.id, "Recorded. The task is complete."));
          actions.push({ name: block.name, summary, outcome: "done" });
        }
      } else {
        results.push(toolResult(block.id, `Unknown tool ${block.name}.`, { error: true }));
        actions.push({ name: block.name, summary, outcome: "failed" });
      }
    } catch (error) {
      halted = true;
      const message = error instanceof Error ? error.message : String(error);
      results.push(toolResult(block.id, `Error: ${message}`, { computer: isComputer, error: true }));
      actions.push({ name: block.name, summary, outcome: "failed", detail: message });
    }
  }

  // Every turn ends with a fresh screenshot. When the batch did not end with one, it rides along
  // on a result so the model sees the same screen without another turn.
  await sleep(SETTLE_MS);
  const shot = lastShot ?? await capture(desktop);
  if (!lastShot) attachScreenshot(results, shot);
  const pageAfter = (await currentPage(desktop)).page;
  const events = await portalEvents(desktop);
  const portalSaid = events.slice(state.seenEvents);
  state.seenEvents = events.length;
  state.pending = results.length > 0 ? results : null;

  const usage = response.usage;
  return {
    ms: Date.now() - started, notes, reasoning, actions, guards, shot, pageBefore, pageAfter, portalSaid,
    ended: results.length === 0, escalation, confirmation, model: response.model, fellBackFrom,
    usage: {
      inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    },
  };
}

/**
 * The computer use lab: one live E2B desktop, one Claude agent, and the code that sits
 * between them. State lives in this Node process (pnpm dev or pnpm start), not in Postgres,
 * so the lab runs without the Eve database or sign-in.
 */
import { randomBytes, randomUUID } from "node:crypto";

import type { BetaContentBlock, BetaMessageParam, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import { checkReviewPage, EFFORT, MODEL, nextTurn, type ReviewCheck } from "./agent";
import { bootComputer, capture, currentPage, perform, portalEvents, portalRecords, typeSecret, type Computer, type PortalEvent } from "./computer";
import { packetDocuments } from "./documents";
import { checkComputerAction, checkPasswordTool, describeAction, GUARD_LABELS, type GuardRule, type PortalPage } from "./guards";
import { DEMO_PACKET, packetBrief, SCENARIOS, type ScenarioId } from "./packet";

export type LabStatus =
  | "starting" | "ready" | "running" | "paused" | "awaiting_approval"
  | "escalated" | "submitted" | "rejected" | "failed" | "stopped";

/** How far a run button goes before handing control back to the person at the lab. */
export type RunGoal = "action" | "page" | "review" | "submit";

export interface ActionLog {
  name: string;
  summary: string;
  outcome: "done" | "blocked" | "failed" | "skipped";
  detail?: string;
  rule?: GuardRule;
}

export interface TurnLog {
  n: number;
  at: string;
  ms: number;
  notes: string[];
  reasoning: string[];
  actions: ActionLog[];
  pageBefore: PortalPage;
  pageAfter: PortalPage;
  shot: number | null;
  portalSaid: PortalEvent[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface GuardEvent { at: string; turn: number; rule: GuardRule; detail: string }

export interface LabSession {
  id: string;
  scenario: ScenarioId;
  status: LabStatus;
  busy: boolean;
  goal: RunGoal | null;
  page: PortalPage;
  pagesVisited: PortalPage[];
  createdAt: string;
  progress: string[];
  streamUrl: string | null;
  sandboxId: string | null;
  offline: boolean;
  turns: TurnLog[];
  guards: GuardEvent[];
  portalSaid: PortalEvent[];
  reviewCheck: ReviewCheck[] | null;
  approval: { by: string; at: string } | null;
  escalation: { field: string; reason: string; at: string } | null;
  confirmation: string | null;
  portalRecord: Record<string, unknown> | null;
  error: string | null;
  totals: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  // Private to the server: never sent to the browser.
  computer: Computer | null;
  password: string;
  messages: BetaMessageParam[];
  pending: BetaToolResultBlockParam[] | null;
  operatorNote: string | null;
  stopRequested: boolean;
  shots: string[];
  seenEvents: number;
}

const MAX_TURNS = 60;
const SETTLE_MS = 600;
const HALT_TEXT = "Not executed: an earlier computer action in this turn failed.";
const TERMINAL: LabStatus[] = ["escalated", "submitted", "rejected", "failed", "stopped"];

type Store = { sessions: Map<string, LabSession>; activeId: string | null };
const g = globalThis as typeof globalThis & { __eveComputerUseLab?: Store };
const store: Store = (g.__eveComputerUseLab ??= { sessions: new Map(), activeId: null });

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function labConfigured(): { ok: true } | { ok: false; message: string } {
  if (!process.env.E2B_API_KEY) return { ok: false, message: "Set E2B_API_KEY in .env to create desktops." };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "Set ANTHROPIC_API_KEY in .env to call Claude." };
  return { ok: true };
}

export function getSession(id: string | null | undefined): LabSession | null {
  return (id && store.sessions.get(id)) || null;
}

export function activeSession(): LabSession | null {
  return getSession(store.activeId);
}

function visit(s: LabSession, page: PortalPage) {
  s.page = page;
  if (page !== "other" && s.pagesVisited.at(-1) !== page) s.pagesVisited.push(page);
}

/** Creates a desktop for the scenario and replaces any lab session already running. */
export async function startSession(scenario: ScenarioId): Promise<LabSession> {
  const previous = activeSession();
  if (previous) await stopSession(previous);
  const s: LabSession = {
    id: randomUUID(), scenario, status: "starting", busy: true, goal: null, page: "other", pagesVisited: [],
    createdAt: now(), progress: [], streamUrl: null, sandboxId: null, offline: true, turns: [], guards: [],
    portalSaid: [], reviewCheck: null, approval: null, escalation: null, confirmation: null, portalRecord: null,
    error: null, totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    computer: null, password: randomBytes(12).toString("base64url"), messages: [], pending: null,
    operatorNote: null, stopRequested: false, shots: [], seenEvents: 0,
  };
  store.sessions.set(s.id, s);
  store.activeId = s.id;
  void boot(s);
  return s;
}

async function boot(s: LabSession) {
  try {
    const computer = await bootComputer({
      strictSsn: SCENARIOS[s.scenario].strictSsn,
      password: s.password,
      documents: await packetDocuments(),
      onProgress: (m) => s.progress.push(m),
    });
    if (s.status === "stopped") { await computer.desktop.kill().catch(() => {}); return; }
    Object.assign(s, { computer, streamUrl: computer.streamUrl, sandboxId: computer.sandboxId, offline: computer.offline });
    visit(s, (await currentPage(computer.desktop)).page);
    const shot = await capture(computer.desktop);
    s.shots.push(shot);
    s.messages = [{
      role: "user",
      content: [
        { type: "text", text: `${packetBrief()}\n\nChrome is open on the portal. Enter this payment request and stop on the Review page.` },
        { type: "image", source: { type: "base64", media_type: "image/png", data: shot } },
      ],
    }];
    await syncPortal(s);
    s.progress.push("Ready");
    s.status = "ready";
  } catch (error) {
    s.status = "failed";
    s.error = error instanceof Error ? error.message : String(error);
  } finally {
    s.busy = false;
  }
}

async function syncPortal(s: LabSession): Promise<PortalEvent[]> {
  if (!s.computer) return [];
  const events = await portalEvents(s.computer.desktop);
  const fresh = events.slice(s.seenEvents);
  s.seenEvents = events.length;
  s.portalSaid.push(...fresh);
  return fresh;
}

function guard(s: LabSession, turn: number, rule: GuardRule, detail: string) {
  s.guards.push({ at: now(), turn, rule, detail });
}

/** Appends whatever the model needs to see next, keeping the history append-only. */
function prepareMessages(s: LabSession) {
  if (s.pending) {
    s.messages.push({ role: "user", content: s.pending });
    s.pending = null;
    // Operator instructions travel as a mid-conversation system message after the tool results.
    if (s.operatorNote) s.messages.push({ role: "system", content: s.operatorNote });
  } else if (s.messages.at(-1)?.role === "assistant") {
    s.messages.push({ role: "user", content: s.operatorNote ?? "Continue with the task." });
  }
  s.operatorNote = null;
}

function toolResult(id: string, content: BetaToolResultBlockParam["content"], opts: { computer?: boolean; error?: boolean } = {}): BetaToolResultBlockParam {
  return { type: "tool_result", tool_use_id: id, content, ...(opts.error ? { is_error: true } : {}), ...(opts.computer ? { toolset_name: "computer" } : {}) };
}

/** Runs one model turn and every action in it. Returns true when the model ended its turn without acting. */
async function runTurn(s: LabSession): Promise<boolean> {
  const computer = s.computer!;
  const desktop = computer.desktop;
  const started = Date.now();
  const n = s.turns.length + 1;
  const pageBefore = s.page;
  prepareMessages(s);
  const response = await nextTurn(s.messages);
  s.messages.push({ role: "assistant", content: response.content });
  if (response.stop_reason === "refusal") throw new Error("Claude declined this turn, and the fallback model declined too. Start a new run.");

  const notes: string[] = [];
  const reasoning: string[] = [];
  const actions: ActionLog[] = [];
  const results: BetaToolResultBlockParam[] = [];
  let halted = false;
  let lastShot: string | null = null;

  for (const block of response.content as BetaContentBlock[]) {
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
        visit(s, page);
        const verdict = checkComputerAction(block.name, input, { page, approved: !!s.approval });
        if (!verdict.ok) {
          halted = true;
          guard(s, n, verdict.rule, summary);
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
        const verdict = checkPasswordTool({ page, approved: !!s.approval });
        if (!verdict.ok) {
          guard(s, n, verdict.rule, summary);
          results.push(toolResult(block.id, verdict.message, { error: true }));
          actions.push({ name: block.name, summary, outcome: "blocked", rule: verdict.rule, detail: verdict.message });
          continue;
        }
        await typeSecret(desktop, s.password);
        lastShot = null;
        results.push(toolResult(block.id, "Typed the portal password into the focused field."));
        actions.push({ name: block.name, summary, outcome: "done" });
      } else if (block.name === "escalate_to_controller") {
        s.escalation = { field: String(input.portal_field ?? ""), reason: String(input.reason ?? ""), at: now() };
        results.push(toolResult(block.id, "Escalation recorded and sent to the controller. Stop now; nothing will be submitted."));
        actions.push({ name: block.name, summary, outcome: "done" });
        halted = true;
      } else if (block.name === "report_submitted") {
        const number = String(input.confirmation_number ?? "").trim();
        const record = (await portalRecords(desktop)).find((r) => r.confirmation === number) ?? null;
        if (!record) {
          results.push(toolResult(block.id, `The portal has no request with confirmation ${number}. Read the number again from the screen.`, { error: true }));
          actions.push({ name: block.name, summary, outcome: "failed", detail: "No matching portal record" });
        } else {
          s.confirmation = number;
          s.portalRecord = record;
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

  // Every turn ends with a fresh screenshot for the timeline. When the batch did not end with one,
  // it rides along on the last result so the model sees the same screen without another turn.
  await sleep(SETTLE_MS);
  const shot = lastShot ?? await capture(desktop);
  s.shots.push(shot);
  if (results.length > 0 && !lastShot) {
    const last = results[results.length - 1];
    const content = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : [...(last.content ?? [])];
    last.content = [...content, { type: "image", source: { type: "base64", media_type: "image/png", data: shot } }];
  }
  visit(s, (await currentPage(desktop)).page);
  const portalSaid = await syncPortal(s);
  s.pending = results.length > 0 ? results : null;

  const usage = response.usage;
  s.totals.inputTokens += usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  s.totals.outputTokens += usage.output_tokens;
  s.totals.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  s.turns.push({
    n, at: new Date(started).toISOString(), ms: Date.now() - started, notes, reasoning, actions,
    pageBefore, pageAfter: s.page, shot: s.shots.length - 1, portalSaid,
    inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  });
  return results.length === 0;
}

/** Runs turns in the background until the goal is reached or the run has to stop. */
export function run(s: LabSession, goal: RunGoal): { ok: boolean; message: string } {
  if (s.busy) return { ok: false, message: "Eve is already working. Wait or press Pause." };
  if (!s.computer) return { ok: false, message: "The desktop is not ready yet." };
  if (TERMINAL.includes(s.status)) return { ok: false, message: `This run has ended (${s.status}). Start a new one.` };
  if (s.status === "awaiting_approval" && goal !== "submit") return { ok: false, message: "Eve is waiting on the Review page. Approve or reject first." };
  s.busy = true;
  s.goal = goal;
  s.status = "running";
  s.stopRequested = false;
  void loop(s, goal);
  return { ok: true, message: "Running." };
}

async function loop(s: LabSession, goal: RunGoal) {
  const startPage = s.page;
  let lostTurns = 0;
  try {
    while (true) {
      if (s.turns.length >= MAX_TURNS) { s.status = "paused"; s.error = `Stopped after ${MAX_TURNS} turns. Start a new run.`; break; }
      const ended = await runTurn(s);
      lostTurns = s.page === "other" ? lostTurns + 1 : 0;
      if (lostTurns >= 3) { s.status = "paused"; s.error = "The portal window has not been visible for three turns. Check the live view, then continue or start a new run."; break; }
      if (s.escalation) { s.status = "escalated"; break; }
      if (s.confirmation) { s.status = "submitted"; break; }
      if (s.page === "review" && !s.approval) {
        s.status = "awaiting_approval";
        s.reviewCheck = await checkReviewPage(s.shots[s.shots.length - 1]).catch(() => null);
        break;
      }
      if (goal === "action" || s.stopRequested || (goal === "page" && s.page !== startPage)) { s.status = "paused"; break; }
      if (ended && goal !== "submit") { s.status = "paused"; break; }
    }
  } catch (error) {
    s.status = "failed";
    s.error = error instanceof Error ? error.message : String(error);
  } finally {
    s.busy = false;
    s.goal = null;
  }
}

export function pause(s: LabSession) {
  s.stopRequested = true;
}

/** Plays the controller: approval covers the Review page exactly as the lab showed it. */
export function approve(s: LabSession, by = "Controller (lab)"): { ok: boolean; message: string } {
  if (s.status !== "awaiting_approval") return { ok: false, message: "There is nothing waiting for approval." };
  s.approval = { by, at: now() };
  s.operatorNote = `Controller approval granted by ${by} at ${s.approval.at} for the Review page as shown. Click "Submit request" once. When the confirmation page appears, call report_submitted with the confirmation number.`;
  s.status = "paused";
  return run(s, "submit");
}

export function reject(s: LabSession): { ok: boolean; message: string } {
  if (s.status !== "awaiting_approval") return { ok: false, message: "There is nothing waiting for approval." };
  s.status = "rejected";
  return { ok: true, message: "Rejected. Nothing was submitted." };
}

export async function stopSession(s: LabSession) {
  s.stopRequested = true;
  s.status = "stopped";
  const computer = s.computer;
  s.computer = null;
  s.streamUrl = null;
  if (computer) await computer.desktop.kill().catch(() => {});
}

export function screenshot(s: LabSession, index: number): Buffer | null {
  const shot = s.shots[index];
  return shot ? Buffer.from(shot, "base64") : null;
}

/** What the browser may see. Passwords, history and raw screenshots stay on the server. */
export function publicState(s: LabSession) {
  return {
    id: s.id,
    scenario: SCENARIOS[s.scenario],
    status: s.status,
    busy: s.busy,
    goal: s.goal,
    page: s.page,
    pagesVisited: s.pagesVisited,
    createdAt: s.createdAt,
    progress: s.progress,
    streamUrl: s.streamUrl,
    sandboxId: s.sandboxId,
    offline: s.offline,
    model: MODEL,
    effort: EFFORT,
    turns: s.turns,
    shotCount: s.shots.length,
    guards: s.guards.map((e) => ({ ...e, label: GUARD_LABELS[e.rule] })),
    portalSaid: s.portalSaid,
    reviewCheck: s.reviewCheck,
    approval: s.approval,
    escalation: s.escalation,
    confirmation: s.confirmation,
    portalRecord: s.portalRecord,
    error: s.error,
    totals: s.totals,
    packet: DEMO_PACKET,
  };
}

export type LabState = ReturnType<typeof publicState>;

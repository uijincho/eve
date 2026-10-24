/**
 * The computer use lab: one live E2B desktop, one Claude agent, and the code that sits
 * between them. State lives in this Node process (pnpm dev or pnpm start), not in Postgres,
 * so the lab runs without the Eve database or sign-in. The product path is the
 * sponsor-portal workflow, which runs the same turns (./turn.ts) durably.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { checkReviewPage, EFFORT, MODEL, type ReviewCheck } from "./agent";
import { bootComputer, capture, currentPage, portalEvents, type Computer, type PortalEvent } from "./computer";
import { packetDocuments } from "./documents";
import { GUARD_LABELS, type GuardRule, type PortalPage } from "./guards";
import { DEMO_PACKET, packetBrief, SCENARIOS, type ScenarioId } from "./packet";
import { approvalNote, newAgentState, runAgentTurn, type ActionLog, type AgentState } from "./turn";

export type { ActionLog };

export type LabStatus =
  | "starting" | "ready" | "running" | "paused" | "awaiting_approval"
  | "escalated" | "submitted" | "rejected" | "failed" | "stopped";

/** How far a run button goes before handing control back to the person at the lab. */
export type RunGoal = "action" | "page" | "review" | "submit";

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
  /** The model that answered this turn, as the API reported it. */
  model: string;
  fellBackFrom: string | null;
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
  agent: AgentState | null;
  stopRequested: boolean;
  shots: string[];
}

const MAX_TURNS = 60;
const TERMINAL: LabStatus[] = ["escalated", "submitted", "rejected", "failed", "stopped"];

type Store = { sessions: Map<string, LabSession>; activeId: string | null };
const g = globalThis as typeof globalThis & { __eveComputerUseLab?: Store };
const store: Store = (g.__eveComputerUseLab ??= { sessions: new Map(), activeId: null });

const now = () => new Date().toISOString();

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
    computer: null, password: randomBytes(12).toString("base64url"), agent: null, stopRequested: false, shots: [],
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
      documents: await packetDocuments(DEMO_PACKET),
      onProgress: (m) => s.progress.push(m),
    });
    if (s.status === "stopped") { await computer.desktop.kill().catch(() => {}); return; }
    Object.assign(s, { computer, streamUrl: computer.streamUrl, sandboxId: computer.sandboxId, offline: computer.offline });
    visit(s, (await currentPage(computer.desktop)).page);
    const shot = await capture(computer.desktop);
    s.shots.push(shot);
    s.agent = newAgentState(packetBrief(DEMO_PACKET), shot);
    const events = await portalEvents(computer.desktop);
    s.agent.seenEvents = events.length;
    s.portalSaid.push(...events);
    s.progress.push("Ready");
    s.status = "ready";
  } catch (error) {
    s.status = "failed";
    s.error = error instanceof Error ? error.message : String(error);
  } finally {
    s.busy = false;
  }
}

/** Runs one model turn through the shared engine and records it for the page. */
async function runTurn(s: LabSession) {
  const out = await runAgentTurn(s.computer!.desktop, s.agent!, s.password, SCENARIOS[s.scenario].drill);
  const n = s.turns.length + 1;
  s.shots.push(out.shot);
  for (const g of out.guards) s.guards.push({ at: now(), turn: n, rule: g.rule, detail: g.detail });
  s.portalSaid.push(...out.portalSaid);
  visit(s, out.pageAfter);
  if (out.escalation) s.escalation = { ...out.escalation, at: now() };
  if (out.confirmation) { s.confirmation = out.confirmation.number; s.portalRecord = out.confirmation.record; }
  s.totals.inputTokens += out.usage.inputTokens;
  s.totals.outputTokens += out.usage.outputTokens;
  s.totals.cacheReadTokens += out.usage.cacheReadTokens;
  s.turns.push({
    n, at: new Date(Date.now() - out.ms).toISOString(), ms: out.ms, notes: out.notes, reasoning: out.reasoning, actions: out.actions,
    pageBefore: out.pageBefore, pageAfter: out.pageAfter, shot: s.shots.length - 1, portalSaid: out.portalSaid, ...out.usage,
    model: out.model, fellBackFrom: out.fellBackFrom,
  });
  return out.ended;
}

/** Runs turns in the background until the goal is reached or the run has to stop. */
export function run(s: LabSession, goal: RunGoal): { ok: boolean; message: string } {
  if (s.busy) return { ok: false, message: "Eve is already working. Wait or press Pause." };
  if (!s.computer || !s.agent) return { ok: false, message: "The desktop is not ready yet." };
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
        s.reviewCheck = await checkReviewPage(s.shots[s.shots.length - 1], DEMO_PACKET).catch(() => null);
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
  if (s.status !== "awaiting_approval" || !s.agent) return { ok: false, message: "There is nothing waiting for approval." };
  s.approval = { by, at: now() };
  s.agent.approved = true;
  s.agent.operatorNote = approvalNote(by, s.approval.at);
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
    servedBy: [...new Set(s.turns.map((t) => t.model))],
    fallbacks: s.turns.filter((t) => t.fellBackFrom).length,
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

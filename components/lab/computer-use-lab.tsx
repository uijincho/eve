"use client";

import { cn } from "cn";
import {
  BanIcon, CheckIcon, ChevronRightIcon, ChevronsRightIcon, LoaderCircleIcon, MinusIcon,
  PauseIcon, PlayIcon, StepForwardIcon, Trash2Icon, XIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@/components/app/page-header";
import { Money } from "@/components/eve/money";
import { TruthLabel } from "@/components/eve/truth-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GUARD_LABELS, PAGE_LABELS, PAGE_ORDER, type GuardRule } from "@/lib/computer-use/guards";
import type { LabState, TurnLog } from "@/lib/computer-use/lab";
import type { Scenario, ScenarioId } from "@/lib/computer-use/packet";

const API = "/api/lab/computer-use";

type LabResponse = { ok: boolean; configured: boolean; message: string | null; scenarios: Scenario[]; state: LabState | null };
type Op =
  | { op: "start"; scenario: ScenarioId }
  | { op: "run"; id: string; goal: "action" | "page" | "review" | "probe" }
  | { op: "pause" | "approve" | "reject" | "stop"; id: string };

const ENDED: LabState["status"][] = ["escalated", "submitted", "rejected", "failed", "stopped"];

const STATUS: Record<LabState["status"], { label: string; variant: "outline" | "secondary" | "positive" | "critical" }> = {
  starting: { label: "Starting", variant: "secondary" },
  ready: { label: "Ready", variant: "outline" },
  running: { label: "Working", variant: "secondary" },
  paused: { label: "Paused", variant: "outline" },
  awaiting_approval: { label: "Waiting for approval", variant: "outline" },
  escalated: { label: "Escalated", variant: "critical" },
  submitted: { label: "Submitted", variant: "positive" },
  rejected: { label: "Rejected", variant: "critical" },
  failed: { label: "Failed", variant: "critical" },
  stopped: { label: "Desktop deleted", variant: "secondary" },
};

const GOALS = { action: "Taking the next action", page: "Working until the portal moves to the next page", review: "Working until the Review page", submit: "Submitting after approval", probe: "Giving Claude one turn on Review without approval (drill)" };

function statusLine(s: LabState): string {
  switch (s.status) {
    case "starting": return `${s.progress.at(-1) ?? "Creating the desktop"}…`;
    case "ready": return "The portal is open on its sign-in page. Choose how far Eve should go.";
    case "running": return `${s.goal ? GOALS[s.goal] : "Working"}…`;
    case "paused": return s.error ?? `Paused on ${PAGE_LABELS[s.page]}. Continue when you are ready.`;
    case "awaiting_approval": return "Stopped on Review. Nothing is submitted until a controller approves.";
    case "escalated": return "Eve stopped and asked the controller to decide. Nothing was submitted.";
    case "submitted": return `Submitted. Westbrook's confirmation number is ${s.confirmation}.`;
    case "rejected": return "The controller rejected the request. Nothing was submitted.";
    case "failed": return s.error ?? "The run failed.";
    case "stopped": return "The desktop was deleted.";
  }
}

const HOW_IT_WORKS = [
  ["Eve hands Claude the packet", "Payee, amounts, account code and file paths. No tax IDs or bank numbers."],
  ["Claude looks, then acts", "Each turn it reads a screenshot and answers with clicks and keystrokes."],
  ["Eve's code checks every action", "Guardrails run before an action reaches the desktop, whatever the model says."],
  ["A person approves the submit", "Eve stops on Review until a controller says yes."],
] as const;

export function ComputerUseLab() {
  const [data, setData] = useState<LabResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ScenarioId>("w8ben-retry");
  const [pending, setPending] = useState<Op["op"] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const state = data?.state ?? null;
  const fast = !!state && (state.busy || state.status === "starting");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(API, { cache: "no-store" });
      const body = (await response.json()) as LabResponse;
      if (!response.ok) throw new Error(body.message ?? "The lab is unavailable.");
      setData(body);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The lab is unavailable.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (!cancelled) timer = setTimeout(tick, fast ? 1000 : 4000);
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [refresh, fast]);

  async function send(op: Op) {
    setPending(op.op);
    setNotice(null);
    try {
      const response = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(op) });
      const body = await response.json();
      if (!response.ok || !body.ok) setNotice(body.message ?? "That did not work.");
      if (body.state) setData((d) => (d ? { ...d, state: body.state } : d));
    } catch {
      setNotice("The lab server did not respond.");
    } finally {
      setPending(null);
      void refresh();
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Computer use lab"
        lede="University finance portals have no API, so a person retypes every sponsor packet. Here Eve's agent fills one on a live desktop while Eve's code enforces the rules. The portal is fictional and nothing is filed or paid."
        actions={<><TruthLabel kind="sample" /><TruthLabel kind="simulated" /></>}
      >
        <details className="text-small">
          <summary className="w-fit cursor-pointer rounded-sm font-medium">How a run works</summary>
          <ol className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="How a run works">
            {HOW_IT_WORKS.map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-medium tabular-nums">{i + 1}</span>
                <span className="flex flex-col">
                  <span className="font-medium">{title}</span>
                  <span className="text-small text-muted-foreground">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </details>
      </PageHeader>

      <main className="mx-auto grid w-full max-w-[96rem] items-start gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1" aria-label="Run controls">
          {loadError ? <p role="alert" className="text-small text-critical">{loadError}</p> : null}
          <Controls data={data} state={state} scenario={scenario} setScenario={setScenario} pending={pending} send={send} notice={notice} />
          {state?.status === "awaiting_approval" || (state?.approval && state.status !== "submitted") ? <Approval state={state} pending={pending} send={send} /> : null}
          {state?.escalation ? <Escalation state={state} /> : null}
          {state?.status === "submitted" ? <Submitted state={state} /> : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <Panel title="Sponsor portal" badge={<TruthLabel kind="simulated" />}>
            <PageTrail state={state} />
            <LiveView state={state} />
          </Panel>
          <Timeline state={state} />
        </div>

        <aside className="flex min-w-0 flex-col gap-4 lg:col-start-2" aria-label="Guardrails and packet evidence">
          <Guardrails state={state} />
          <Packet state={state} />
          <PortalSaid state={state} />
          <Usage state={state} />
        </aside>
      </main>
    </div>
  );
}

function Panel({ title, badge, children, className }: { title: string; badge?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border bg-surface p-5", className)} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-subheading">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

function PageTrail({ state }: { state: LabState | null }) {
  return (
    <nav aria-label="Portal pages">
      <ol className="flex flex-wrap items-center gap-1 text-small">
        {PAGE_ORDER.map((page, i) => {
          const current = state?.page === page;
          const visited = !!state?.pagesVisited.includes(page);
          return (
            <li key={page} className="flex items-center gap-1">
              {i > 0 ? <ChevronRightIcon aria-hidden className="size-3.5 text-faint" /> : null}
              <span
                aria-current={current ? "step" : undefined}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md px-2",
                  current ? "bg-surface-hover font-medium text-foreground" : visited ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {visited && !current ? <CheckIcon aria-hidden className="size-3.5 text-positive" /> : null}
                {PAGE_LABELS[page]}
              </span>
            </li>
          );
        })}
        {state?.page === "expired" ? <li className="ml-2"><Badge variant="critical">Portal session expired</Badge></li> : null}
      </ol>
    </nav>
  );
}

function LiveView({ state }: { state: LabState | null }) {
  if (state?.streamUrl) {
    return (
      <div className="flex flex-col gap-2">
        <div className="overflow-hidden rounded-xl border bg-background">
          <iframe src={state.streamUrl} title="Live view of the E2B desktop, view only" className="block aspect-[4/3] w-full" />
        </div>
        <p className="text-caption text-muted-foreground">
          Live view only. Sandbox {state.sandboxId}
          {state.offline ? " has no internet access; Chrome can open the portal and nothing else." : " has internet access."}
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-h-56 w-full lg:aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-input bg-background p-6 text-center">
      {state?.status === "starting" ? (
        <>
          <LoaderCircleIcon aria-hidden className="size-5 animate-spin text-muted-foreground" />
          <p className="font-semibold">Starting a desktop</p>
          <ul className="flex flex-col gap-0.5 text-small text-muted-foreground">
            {state.progress.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </>
      ) : (
        <>
          <p className="font-semibold">{state?.status === "stopped" ? "Desktop deleted" : "No desktop running"}</p>
          <p className="max-w-[48ch] text-small text-muted-foreground">
            Start a run and the E2B desktop appears here: a Linux machine with Chrome open on the Westbrook portal. Eve controls it; this view only watches.
          </p>
        </>
      )}
    </div>
  );
}

function Controls({ data, state, scenario, setScenario, pending, send, notice }: {
  data: LabResponse | null;
  state: LabState | null;
  scenario: ScenarioId;
  setScenario: (s: ScenarioId) => void;
  pending: Op["op"] | null;
  send: (op: Op) => void;
  notice: string | null;
}) {
  const ended = !state || ENDED.includes(state.status);
  const status = state ? STATUS[state.status] : null;
  return (
    <Panel title="Run" badge={status ? <Badge variant={status.variant}>{status.label}</Badge> : null}>
      {state ? <p aria-live="polite" className="text-small text-muted-foreground">{statusLine(state)}</p> : null}

      {ended ? (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-small font-medium">Scenario</legend>
            {(data?.scenarios ?? []).map((s) => (
              <label
                key={s.id}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors duration-150 ease-dusk",
                  scenario === s.id ? "border-input bg-surface-hover" : "border-transparent hover:bg-surface-hover",
                )}
              >
                <input type="radio" name="scenario" value={s.id} checked={scenario === s.id} onChange={() => setScenario(s.id)} className="mt-0.5 size-4 accent-foreground" />
                <span className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 font-medium">{s.label}{s.drill ? <Badge variant="outline">Drill</Badge> : null}</span>
                  {scenario === s.id ? <>
                    <span className="text-small text-muted-foreground">{s.summary}</span>
                    <span className="text-small text-muted-foreground">Expect: {s.expected}</span>
                  </> : null}
                </span>
              </label>
            ))}
          </fieldset>
          {data && !data.configured ? (
            <p className="text-small text-critical">{data.message}</p>
          ) : (
            <Button size="lg" className="w-full" aria-busy={pending === "start"} disabled={!data || pending !== null} onClick={() => send({ op: "start", scenario })}>
              {pending === "start" ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <PlayIcon aria-hidden />}
              {pending === "start" ? "Creating desktop" : "Start a desktop"}
            </Button>
          )}
          <p className="text-caption text-muted-foreground">Each run creates a fresh E2B desktop (about 30 seconds) and calls Claude once per turn. Starting a run deletes the previous desktop.</p>
          {state && state.status !== "stopped" && state.sandboxId ? (
            <Button variant="destructive" size="sm" className="self-start" disabled={pending !== null} onClick={() => send({ op: "stop", id: state.id })}>
              <Trash2Icon aria-hidden /> Delete desktop
            </Button>
          ) : null}
        </>
      ) : state.status === "starting" ? (
        <Button size="lg" className="w-full" disabled aria-busy>
          <LoaderCircleIcon aria-hidden className="animate-spin" /> Starting desktop
        </Button>
      ) : state.status === "awaiting_approval" || state.goal === "submit" ? (
        <Button variant="destructive" size="sm" className="self-start" disabled={pending !== null || state.busy} onClick={() => send({ op: "stop", id: state.id })}>
          <Trash2Icon aria-hidden /> Delete desktop
        </Button>
      ) : (
        <RunButtons state={state} pending={pending} send={send} />
      )}

      {notice ? <p role="alert" className="text-small text-critical">{notice}</p> : null}
    </Panel>
  );
}

function RunButtons({ state, pending, send }: { state: LabState; pending: Op["op"] | null; send: (op: Op) => void }) {
  const working = state.busy || pending !== null;
  const reasonId = `run-reason-${state.id}`;
  const blocked = working ? { "aria-describedby": reasonId } : {};
  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" className="w-full" disabled={working} focusableWhenDisabled {...blocked} onClick={() => send({ op: "run", id: state.id, goal: "review" })}>
        <ChevronsRightIcon aria-hidden /> Run to Review
      </Button>
      <div className="flex flex-wrap gap-2 [&>button]:flex-1">
        <Button variant="secondary" disabled={working} focusableWhenDisabled {...blocked} onClick={() => send({ op: "run", id: state.id, goal: "action" })}>
          <StepForwardIcon aria-hidden /> Next action
        </Button>
        <Button variant="secondary" disabled={working} focusableWhenDisabled {...blocked} onClick={() => send({ op: "run", id: state.id, goal: "page" })}>
          <ChevronRightIcon aria-hidden /> Finish this page
        </Button>
      </div>
      {working ? (
        <p id={reasonId} className="text-small text-muted-foreground">Eve is working. Pause to take back control after the current turn.</p>
      ) : (
        <p className="text-small text-muted-foreground">
          <span className="font-medium text-foreground">Next action</span> runs one Claude turn. <span className="font-medium text-foreground">Finish this page</span> runs until the portal leaves {PAGE_LABELS[state.page]}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" disabled={!state.busy || pending === "pause"} onClick={() => send({ op: "pause", id: state.id })}>
          <PauseIcon aria-hidden /> Pause
        </Button>
        <Button variant="destructive" size="sm" disabled={pending !== null} onClick={() => send({ op: "stop", id: state.id })}>
          <Trash2Icon aria-hidden /> Delete desktop
        </Button>
      </div>
    </div>
  );
}

function Approval({ state, pending, send }: { state: LabState; pending: Op["op"] | null; send: (op: Op) => void }) {
  const checks = state.reviewCheck;
  const mismatches = checks?.filter((c) => !c.ok).length ?? 0;
  if (state.approval) {
    return (
      <Panel title="Controller approval" badge={<Badge variant="positive">Approved</Badge>}>
        <p className="text-small text-muted-foreground">
          {state.approval.by} approved at {new Date(state.approval.at).toLocaleTimeString()}. Eve may now press Submit once.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Waiting for the controller" badge={<Badge variant="outline">Review page</Badge>} className="bg-surface">
      <p className="text-small text-muted-foreground">
        Eve stopped on Westbrook&apos;s Review page and read it back. Each value is compared with the packet before anyone is asked to approve.
      </p>
      {checks ? (
        <ul className="flex flex-col text-small">
          {checks.map((c) => (
            <li key={c.label} className="flex flex-col border-b py-1.5 last:border-b-0">
              <span className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">{c.label}</span>
                <span className="flex min-w-0 items-start gap-1.5 text-right [overflow-wrap:anywhere]">
                  {c.portal || "Not read"}
                  {c.ok
                    ? <CheckIcon className="size-4 shrink-0 text-positive" aria-label="Matches the packet" />
                    : <XIcon className="size-4 shrink-0 text-critical" aria-label="Differs from the packet" />}
                </span>
              </span>
              {!c.ok ? <span className="text-right text-caption text-critical [overflow-wrap:anywhere]">Packet: {c.packet}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-critical">Eve could not read the Review page back. Check the live view before approving.</p>
      )}
      {mismatches > 0 ? <p className="text-small text-critical">{mismatches} {mismatches === 1 ? "value differs" : "values differ"} from the packet. Reject unless you have checked the live view.</p> : null}
      <div className="flex flex-col gap-2">
        <Button size="lg" className="w-full" aria-busy={pending === "approve"} disabled={pending !== null} onClick={() => send({ op: "approve", id: state.id })}>
          {pending === "approve" ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <CheckIcon aria-hidden />}
          {pending === "approve" ? "Approving" : "Approve and submit"}
        </Button>
        <Button variant="destructive" disabled={pending !== null} onClick={() => send({ op: "reject", id: state.id })}>
          <XIcon aria-hidden /> Reject
        </Button>
      </div>
      {state.scenario.drill ? (
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <Button variant="secondary" disabled={pending !== null || state.busy} onClick={() => send({ op: "run", id: state.id, goal: "probe" })}>
            <StepForwardIcon aria-hidden /> Give Claude a turn anyway
          </Button>
          <p className="text-caption text-muted-foreground">Drill only. Eve normally gives Claude no turn on Review before approval. This hands it one, with the operator telling it to press Submit, so you can watch Eve&apos;s code block the click.</p>
        </div>
      ) : null}
      <p className="text-caption text-muted-foreground">You are playing the controller. In Eve, only a controller can approve, and never the person who requested the payout.</p>
    </Panel>
  );
}

function Escalation({ state }: { state: LabState }) {
  const e = state.escalation!;
  return (
    <Panel title="Eve asked the controller" badge={<Badge variant="critical">Escalated</Badge>} className="bg-surface">
      <dl className="flex flex-col gap-2 text-small">
        <div><dt className="text-muted-foreground">Portal field</dt><dd>{e.field}</dd></div>
        <div><dt className="text-muted-foreground">Eve&apos;s reason</dt><dd>{e.reason}</dd></div>
      </dl>
      <p className="text-small text-muted-foreground">Nothing was submitted. In Eve this lands in the controller&apos;s inbox with the screenshots attached.</p>
    </Panel>
  );
}

function Submitted({ state }: { state: LabState }) {
  const r = state.portalRecord ?? {};
  const rows: [string, React.ReactNode][] = [
    ["Payee", String(r.name ?? "")],
    ["Country", String(r.country ?? "")],
    ["Taxpayer ID sent", r.tinLast4 ? `Ending ${String(r.tinLast4)}` : "None"],
    ["Net payment", typeof r.netCents === "number" ? <Money amountMinor={r.netCents} /> : ""],
    ["Account code", String(r.accountLabel ?? "")],
    ["Payment method", String(r.method ?? "")],
    ["Documents", [r.supportingDocument, r.taxForm].filter(Boolean).join(", ")],
  ];
  return (
    <Panel title="Westbrook received it" badge={<Badge variant="positive">Submitted</Badge>} className="bg-surface">
      <p className="flex flex-col">
        <span className="text-small text-muted-foreground">Confirmation number</span>
        <span className="text-heading tabular-nums">{state.confirmation}</span>
      </p>
      <dl className="flex flex-col text-small">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b py-1.5 last:border-b-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 text-right [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-caption text-muted-foreground">Read from the portal&apos;s own records inside the sandbox, not from what Claude reported.</p>
    </Panel>
  );
}

function Guardrails({ state }: { state: LabState | null }) {
  const blocked = (rule: GuardRule) => state?.guards.filter((g) => g.rule === rule).length ?? 0;
  const typedPassword = state?.turns.some((t) => t.actions.some((a) => a.name === "type_portal_password" && a.outcome === "done")) ?? false;
  const armed = { label: "Armed", variant: "outline" as const };
  const rows: { name: string; how: string; badge: { label: string; variant: "outline" | "positive" | "critical" } }[] = [
    {
      name: GUARD_LABELS.review_gate,
      how: "Before every click, Eve's code reads which portal page is open. On Review, clicks and typing are refused until a controller approves.",
      badge: state?.approval ? { label: "Approved", variant: "positive" }
        : blocked("review_gate") ? { label: `Blocked ${blocked("review_gate")}`, variant: "critical" }
        : state?.status === "awaiting_approval" ? { label: "Holding", variant: "outline" } : armed,
    },
    {
      name: GUARD_LABELS.tax_id,
      how: "Typed text shaped like an SSN, ITIN or EIN is refused before it reaches the keyboard.",
      badge: blocked("tax_id") ? { label: `Blocked ${blocked("tax_id")}`, variant: "critical" } : armed,
    },
    {
      name: "Password stays with Eve",
      how: "Claude calls type_portal_password and Eve's code types the value. It never enters the conversation, and it only works on the sign-in page.",
      badge: blocked("password_scope") ? { label: `Blocked ${blocked("password_scope")}`, variant: "critical" } : typedPassword ? { label: "Typed by Eve", variant: "positive" } : armed,
    },
    {
      name: "No internet",
      how: "The sandbox has no outbound network, checked by a probe when it boots. Chrome's managed policy blocks every other address, even local ones.",
      badge: !state?.sandboxId ? armed : state.offline ? { label: "Enforced", variant: "positive" } : { label: "Internet on", variant: "critical" },
    },
  ];
  return (
    <Panel title="Guardrails in code">
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.name} className="flex flex-col gap-0.5 border-b py-2 first:pt-0 last:border-b-0 last:pb-0">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{r.name}</span>
              <Badge variant={r.badge.variant}>{r.badge.label}</Badge>
            </span>
            <span className="text-small text-muted-foreground">{r.how}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Packet({ state }: { state: LabState | null }) {
  if (!state) return null;
  const p = state.packet;
  const rows: [string, React.ReactNode][] = [
    ["Payee", `${p.payee.name}, ${p.payee.country}`],
    ["Tax status", "Foreign person, Form W-8BEN on file"],
    ["Gross", <Money key="g" amountMinor={p.grossCents} />],
    ["Withheld (30%)", <Money key="w" amountMinor={-p.withheldCents} />],
    ["Net to payee", <Money key="n" amountMinor={p.netCents} className="font-semibold" />],
    ["Account code", p.accountCode],
    ["Method", p.paymentMethod],
    ["Documents", "Award letter, Form W-8BEN"],
  ];
  return (
    <Panel title="Packet Eve handed over" badge={<TruthLabel kind="sample" />}>
      <dl className="flex flex-col text-small">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b py-1.5 last:border-b-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 text-right [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-caption text-muted-foreground">Packet {p.id}. Claude reads this as text. The portal password and any taxpayer ID are never in it.</p>
    </Panel>
  );
}

function PortalSaid({ state }: { state: LabState | null }) {
  const events = (state?.portalSaid ?? []).filter((e) => e.type !== "page" && e.type !== "started");
  if (!state?.sandboxId) return null;
  return (
    <Panel title="What the portal said">
      {events.length === 0 ? (
        <p className="text-small text-muted-foreground">Nothing yet. Validation errors and submissions from the portal appear here.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-small">
          {events.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-2">
              <span className="w-16 shrink-0 text-caption text-muted-foreground tabular-nums">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <span className={cn(e.type === "error" && "text-critical", e.type === "submitted" && "text-positive")}>
                {e.type === "submitted" ? `Accepted request ${e.detail}` : e.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Usage({ state }: { state: LabState | null }) {
  if (!state) return null;
  const cached = state.totals.inputTokens ? Math.round((state.totals.cacheReadTokens / state.totals.inputTokens) * 100) : 0;
  const rows: [string, string][] = [
    ["Model requested", `${state.model}, effort ${state.effort}`],
    ["Answered by", state.servedBy.length ? state.servedBy.join(", ") : "No turns yet"],
    ["Refusal fallbacks", String(state.fallbacks)],
    ["Claude turns", String(state.turns.length)],
    ["Input tokens", `${state.totals.inputTokens.toLocaleString()} (${cached}% from cache)`],
    ["Output tokens", state.totals.outputTokens.toLocaleString()],
  ];
  return (
    <Panel title="Usage">
      <dl className="flex flex-col text-small">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b py-1.5 last:border-b-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Timeline({ state }: { state: LabState | null }) {
  if (!state) return null;
  const turns = [...state.turns].reverse();
  return (
    <section aria-label="Step timeline" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-heading">Every step</h2>
        <span className="text-small text-muted-foreground">Newest first. Each turn keeps Claude&apos;s note, its actions and the screen after them.</span>
      </div>
      {turns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-input bg-surface p-5">
          <p className="font-semibold">No turns yet</p>
          <p className="text-small text-muted-foreground">When Eve starts working, each Claude turn appears here with what it saw and what it did.</p>
        </div>
      ) : (
        <ol className="flex flex-col rounded-2xl border bg-surface">
          {turns.map((t) => <TurnRow key={t.n} turn={t} sessionId={state.id} />)}
        </ol>
      )}
    </section>
  );
}

const OUTCOME_ICON = {
  done: <CheckIcon aria-label="Done" className="mt-0.5 size-4 shrink-0 text-positive" />,
  blocked: <BanIcon aria-label="Blocked" className="mt-0.5 size-4 shrink-0 text-critical" />,
  failed: <XIcon aria-label="Failed" className="mt-0.5 size-4 shrink-0 text-critical" />,
  skipped: <MinusIcon aria-label="Skipped" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />,
};

function TurnRow({ turn, sessionId }: { turn: TurnLog; sessionId: string }) {
  const shot = turn.shot === null ? null : `${API}?id=${sessionId}&shot=${turn.shot}`;
  const moved = turn.pageBefore !== turn.pageAfter;
  const errors = turn.portalSaid.filter((e) => e.type === "error");
  return (
    <li className="grid gap-4 border-b p-4 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)]">
      {shot ? (
        <a href={shot} target="_blank" rel="noreferrer" className="self-start overflow-hidden rounded-md border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {/* eslint-disable-next-line @next/next/no-img-element -- screenshots are served by the lab route, not next/image */}
          <img src={shot} alt={`Screen after turn ${turn.n}`} width={176} height={132} className="block aspect-[4/3] w-full bg-rail" loading="lazy" />
        </a>
      ) : <span />}
      <div className="flex min-w-0 flex-col gap-2 [overflow-wrap:anywhere]">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">Turn {turn.n}</span>
          <span className="text-caption text-muted-foreground tabular-nums">
            {(turn.ms / 1000).toFixed(1)} s{moved ? ` · ${PAGE_LABELS[turn.pageBefore]} → ${PAGE_LABELS[turn.pageAfter]}` : ` · ${PAGE_LABELS[turn.pageAfter]}`}
          </span>
          <span className="text-caption text-muted-foreground [overflow-wrap:anywhere]">{turn.model}</span>
        </div>
        {turn.fellBackFrom ? <p className="text-small text-muted-foreground">{turn.fellBackFrom} declined this turn; {turn.model} answered instead.</p> : null}
        {turn.notes.length > 0 ? <p className="max-w-[62ch]">{turn.notes.join(" ")}</p> : null}
        {turn.actions.length > 0 ? (
          <ul className="flex flex-col gap-1 text-small">
            {turn.actions.map((a, i) => (
              <li key={i} className="flex flex-col gap-0.5">
                <span className="flex items-start gap-2">
                  {OUTCOME_ICON[a.outcome]}
                  <span className={cn(a.outcome === "skipped" && "text-muted-foreground")}>{a.summary}</span>
                  {a.rule ? <Badge variant="critical">Blocked by Eve</Badge> : null}
                </span>
                {a.detail && a.outcome !== "done" ? <span className="pl-6 text-caption text-muted-foreground">{a.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="text-small text-muted-foreground">No actions. Claude ended its turn.</p>}
        {errors.map((e, i) => <p key={i} className="text-small text-critical">Portal: {e.detail}</p>)}
        {turn.reasoning.length > 0 ? (
          <details className="text-small">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Claude&apos;s reasoning, summarized</summary>
            <p className="mt-1 max-w-[72ch] whitespace-pre-wrap text-muted-foreground">{turn.reasoning.join("\n\n")}</p>
          </details>
        ) : null}
      </div>
    </li>
  );
}

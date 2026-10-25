// Reproducible sample-event benchmark through HTTP and durable workflows.
// --reset explicitly replaces only the fictional shared demo organization.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { and, eq } from "drizzle-orm";

loadEnvConfig(process.cwd());

async function main() {
  const base = process.env.EVE_LOCAL_URL ?? "http://localhost:3000";
  assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Run this benchmark against a local server only.");
  assert(process.env.EVE_DEMO_MODE === "true", "Demo mode must be enabled.");
  assert.equal(new Date().getUTCFullYear(), 2026, "The seeded acceptance scenarios describe 2026; update them before benchmarking another tax year.");
  const { getDb } = await import("../lib/db");
  const s = await import("../lib/db/schema");
  const { DEMO_ORG_ID: orgId } = await import("../lib/server/http");
  const { createDemoToken, DEMO_COOKIE } = await import("../lib/auth/session");
  const { resetDemoOrg, ensureDemoOrg } = await import("../lib/server/seed");
  const db = getDb();
  const started = Date.now();
  try {
    if (process.argv.includes("--reset")) {
      console.log("Resetting only the fictional shared event. Do not run while another demo is in progress.");
      await db.transaction((tx) => resetDemoOrg(tx, "benchmark"));
    } else await ensureDemoOrg(db, "benchmark");
    const members = await db.select().from(s.orgMember).where(and(eq(s.orgMember.orgId, orgId), eq(s.orgMember.demoPersona, true)));
    const organizer = members.find((m) => m.role === "organizer")!;
    const controller = members.find((m) => m.role === "controller")!;
    assert(organizer && controller, "Both approval roles must exist.");
    const action = async (memberId: string, name: string, payload: unknown = {}) => {
      const response = await fetch(`${base}/api/actions`, {
        method: "POST", headers: { "content-type": "application/json", origin: base, cookie: `${DEMO_COOKIE}=${createDemoToken(memberId, orgId)}` },
        body: JSON.stringify({ action: name, payload }), signal: AbortSignal.timeout(120_000),
      });
      const body = await response.json();
      assert(response.ok && body.ok, `${name}: HTTP ${response.status}: ${body.message}`);
      return body;
    };
    async function until<T>(read: () => Promise<T | null>, label: string): Promise<T> {
      const deadline = Date.now() + 6 * 60_000;
      while (Date.now() < deadline) {
        const value = await read();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error(`Timed out waiting for ${label}. Completed decisions remain saved.`);
    }
    async function review() {
      const result = await action(organizer.id, "demo.run");
      const id = result.data.runId as string;
      await until(async () => {
        const [row] = await db.select().from(s.agentRun).where(and(eq(s.agentRun.orgId, orgId), eq(s.agentRun.id, id)));
        if (row?.status === "failed") throw new Error(row.summary);
        return row?.status === "done" ? row : null;
      }, "the event's durable review");
    }
    console.log("Running the real event review. The agent can propose payments, but cannot release them.");
    await review();
    // The answer key is used only by this acceptance harness to choose the two
    // threshold cases. It is never an input to financial decisions or policies.
    const keys = await db.select().from(s.answerKey).where(and(eq(s.answerKey.orgId, orgId), eq(s.answerKey.expected, "reportable")));
    const payouts = await db.select().from(s.payout).where(eq(s.payout.orgId, orgId));
    const ids = payouts.filter((p) => keys.some((k) => k.objectId === p.personId) && p.status === "proposed").map((p) => p.id);
    if (ids.length) {
      console.log(`Controller explicitly approving ${ids.length} simulated threshold payments.`);
      await action(controller.id, "payout.release", { ids });
      await until(async () => {
        const rows = await db.select().from(s.payout).where(eq(s.payout.orgId, orgId));
        return ids.every((id) => rows.some((p) => p.id === id && p.status === "paid")) ? true : null;
      }, "controller settlement of the threshold cases");
    }
    // Generate filings from paid income, then re-evaluate the real result.
    await review();
    const result = await fetch(`${base}/api/app`, { headers: { cookie: `${DEMO_COOKIE}=${createDemoToken(organizer.id, orgId)}` } });
    assert.equal(result.status, 200);
    const snapshot = await result.json();
    const board = snapshot.scoreboard;
    assert(board, "Snapshot must contain the measured scoreboard.");
    const report = {
      measuredAt: new Date().toISOString(), commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      elapsedSeconds: Math.round((Date.now() - started) / 1000), reset: process.argv.includes("--reset"),
      truth: "Simulated money; real HTTP, Postgres, policy engine and Workflow execution",
      counts: { people: snapshot.people.length, claims: snapshot.claims.length, awards: snapshot.awards.length },
      controllerThresholdPaymentsReleased: ids.length, scoreboard: board,
    };
    await mkdir("docs", { recursive: true });
    await writeFile("docs/demo-benchmark.json", `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ counts: report.counts, caught: board.caught, total: board.total, falsePositives: board.falsePositives, wrongfulPayouts: board.wrongfulPayouts, elapsedSeconds: report.elapsedSeconds }));
    for (const item of board.results.filter((r: { passed: boolean }) => !r.passed)) console.log(`Missed: ${item.scenario}: ${item.actual}`);
    assert.equal(board.wrongfulPayouts, 0, "No wrongful payment is acceptable.");
    assert.equal(board.falsePositives, 0, "Investigate false positives.");
    assert.equal(board.caught, board.total, "Investigate missed planted cases.");
  } finally { await db.$pool.end(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Demo benchmark failed."); process.exitCode = 1; });

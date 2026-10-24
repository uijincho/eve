import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AppAction, AppSnapshot } from "@/lib/contracts";
import { fixtureSnapshot } from "@/lib/client/fixture";
import { canManage, canOrganize, isStipendTrack, type Permission } from "@/lib/client/derive";

type Actor = AppSnapshot["actor"];
import { ACTION_ROLES } from "@/lib/server/core";
import { paymentTypeFor } from "@/lib/server/engines";

const state = vi.hoisted(() => ({ snapshot: null as AppSnapshot | null, search: "" }));
vi.mock("@/lib/client/use-eve", () => ({
  useEve: () => ({ snapshot: state.snapshot, loading: false, error: null, act: vi.fn(), refresh: vi.fn() }),
  useAction: () => ({ state: { status: "idle" }, pending: false, run: vi.fn() }),
  useLivePolling: () => undefined,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/events/new",
}));

const s = fixtureSnapshot();
const persona = (role: Actor["role"]) => s.personas.find((p) => p.role === role)!;
const staff = ["organizer", "controller", "auditor"] as const;

// Each staff-side button gate, paired with the server action it calls. The
// client helper must allow exactly the roles core.ts lets through, so no
// persona sees an enabled button that answers 403.
const GATES: [AppAction, (a: Actor) => Permission][] = [
  ["org.update", canOrganize],
  ["event.update", canOrganize],
  ["budget.update", canOrganize],
  ["people.import", canOrganize],
  ["person.update", canOrganize],
  ["award.create", canOrganize],
  ["award.choose", canOrganize],
  ["award.split", canOrganize],
  ["payout.propose", canOrganize],
  ["payout.bankChange", canOrganize],
  ["claim.submit", canOrganize],
  ["sponsor.create", canOrganize],
  ["payout.verify", canManage],
  ["demo.run", canManage],
  ["demo.reset", canManage],
  ["filings.generate", canManage],
];

describe("staff permission gates match the server role map", () => {
  for (const [action, gate] of GATES) {
    it(`${action} → ${gate.name}`, () => {
      for (const role of staff) expect(gate(persona(role)).allowed, role).toBe(ACTION_ROLES[action].includes(role));
    });
  }

  it("canOrganize explains why a controller or auditor is blocked", () => {
    expect(canOrganize(persona("organizer"))).toEqual({ allowed: true });
    expect(canOrganize(persona("controller"))).toMatchObject({ allowed: false, reason: "Only an organizer can do this." });
    expect(canOrganize(persona("auditor"))).toMatchObject({ allowed: false, reason: "Auditors have read-only access." });
  });
});

describe("organizer-only screens for a controller", () => {
  it("hides prize entry and locks settings with an organizer reason", async () => {
    const { PrizesView } = await import("@/components/app/views/prizes-view");
    const { SettingsView } = await import("@/components/app/views/settings-view");
    state.snapshot = { ...fixtureSnapshot(), actor: persona("controller") };
    expect(renderToStaticMarkup(createElement(PrizesView))).not.toContain("Enter a winner");
    expect(renderToStaticMarkup(createElement(SettingsView))).toContain("Only an organizer can do this. Fields are shown for reference");
  });
});

describe("event setup tab deep link", () => {
  it("opens the tab named in ?tab=", async () => {
    const { EventSetupView } = await import("@/components/app/views/event-setup-view");
    state.snapshot = fixtureSnapshot();
    state.search = "tab=import";
    const html = renderToStaticMarkup(createElement(EventSetupView));
    expect(html).toMatch(/id="tab-import"[^>]*aria-selected="true"/);
    expect(html).toMatch(/id="tab-basics"[^>]*aria-selected="false"/);
    expect(html).toContain('id="panel-import"');
  });

  it("falls back to Basics for a missing or unknown tab", async () => {
    const { EventSetupView } = await import("@/components/app/views/event-setup-view");
    state.snapshot = fixtureSnapshot();
    state.search = "tab=nope";
    expect(renderToStaticMarkup(createElement(EventSetupView))).toMatch(/id="tab-basics"[^>]*aria-selected="true"/);
  });
});

describe("judge stipend choice", () => {
  it("classifies tracks the same way the server taxes them", () => {
    for (const track of ["Judge stipend", "Mentor stipend", "Speaker honorarium", "First Overall", "Best Hardware Hack"]) {
      expect(isStipendTrack(track), track).toBe(paymentTypeFor({ kind: "award", awardKind: "cash", track, fulfillment: "cash" }) === "stipend");
    }
  });
});

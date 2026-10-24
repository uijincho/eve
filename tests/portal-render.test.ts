import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AppSnapshot } from "@/lib/contracts";
import { fixtureSnapshot } from "@/lib/client/fixture";
import { PortalPrizes } from "@/components/app/portal/prizes";
import { PortalTravel } from "@/components/app/portal/travel";

const state = vi.hoisted(() => ({ snapshot: null as AppSnapshot | null }));
vi.mock("@/lib/client/use-eve", () => ({
  useEve: () => ({ snapshot: state.snapshot, loading: false, error: null, act: vi.fn(), refresh: vi.fn() }),
  useAction: () => ({ state: { status: "idle" }, pending: false, run: vi.fn() }),
  useLivePolling: () => undefined,
}));

function attendeeSnapshot() {
  const s = fixtureSnapshot();
  s.actor = s.personas.find((p) => p.role === "attendee")!;
  s.people = s.people.filter((p) => p.id === s.actor.personId);
  s.awards = s.awards.filter((a) => a.personId === s.actor.personId);
  s.payouts = [];
  s.claims = [];
  return s;
}

describe("attendee-scoped portal rendering", () => {
  it("offers team confirmation with only the attendee's own share in the snapshot", () => {
    const s = attendeeSnapshot();
    s.awards[0] = { ...s.awards[0], teamId: "private-team", splitConfirmed: false };
    state.snapshot = s;
    expect(s.awards).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(PortalPrizes));
    expect(html).toContain("Confirm my share");
    expect(html).toContain("This is a team prize.");
    expect(html).not.toContain("Jordan Okafor");
  });

  it("labels the unconverted travel cap in the organization's currency", () => {
    const s = attendeeSnapshot();
    s.org.country = "CA";
    s.org.currency = "CAD";
    s.event.travelCapMinor = "60000";
    state.snapshot = s;
    const html = renderToStaticMarkup(createElement(PortalTravel));
    expect(html).toContain("CA$600.00");
    expect(html).not.toContain("US$600.00");
  });
});

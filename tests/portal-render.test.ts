import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AppSnapshot } from "@/lib/contracts";
import { fixtureSnapshot } from "@/lib/client/fixture";
import { PortalPrizes } from "@/components/app/portal/prizes";
import { PortalProfile } from "@/components/app/portal/profile";
import { PortalTravel } from "@/components/app/portal/travel";
import { startingRules } from "@/lib/tax";

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

  it("words the residency declaration as a confirmation, not a US perjury statement", () => {
    const s = attendeeSnapshot();
    s.people[0] = { ...s.people[0], taxForm: "Residency declaration", taxStatus: "valid" };
    state.snapshot = s;
    const html = renderToStaticMarkup(createElement(PortalProfile));
    expect(html).toContain("I confirm that my residency information is true, correct, and complete.");
    expect(html).not.toContain("penalties of perjury");
  });

  it("keeps the perjury certification on W-9 and W-8 forms", () => {
    for (const taxForm of ["W-9", "W-8BEN"] as const) {
      const s = attendeeSnapshot();
      s.people[0] = { ...s.people[0], taxForm, taxStatus: "valid" };
      state.snapshot = s;
      const html = renderToStaticMarkup(createElement(PortalProfile));
      expect(html).toContain("I certify under penalties of perjury");
      expect(html).not.toContain("demo-grade");
    }
  });

  it("puts the official W-8BEN Part III text behind a collapsed disclosure", () => {
    const s = attendeeSnapshot();
    s.people[0] = { ...s.people[0], taxForm: "W-8BEN", taxStatus: "missing" };
    state.snapshot = s;
    const html = renderToStaticMarkup(createElement(PortalProfile));
    expect(html).toMatch(/<details[^>]*><summary[^>]*>What you&#x27;re certifying<\/summary>/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain("Under penalties of perjury, I declare that I have examined the information on this form");
    expect(html).toContain("The person named on line 1 of this form is not a U.S. person;");
    expect(html).toContain("I certify that I have the capacity to sign for the person identified on line 1 of this form.");
    expect(html).toContain("Not legally required in my country.");
    expect(html).not.toContain("The form claims");
  });

  it("tells a treaty claimant the line 10 rate the form will print", () => {
    const s = attendeeSnapshot();
    s.people[0] = { ...s.people[0], country: "CA", taxForm: "W-8BEN", taxStatus: "missing" };
    s.rules = [...s.rules, startingRules.find((r) => r.id === "us-ca-prize-treaty")!];
    state.snapshot = s;
    expect(renderToStaticMarkup(createElement(PortalProfile))).toContain("The form claims 0%.");
  });

  it("offers the signed W-8BEN only once a document exists", () => {
    const s = attendeeSnapshot();
    s.people[0] = { ...s.people[0], taxForm: "W-8BEN", taxStatus: "valid" };
    state.snapshot = s;
    expect(renderToStaticMarkup(createElement(PortalProfile))).not.toContain("View W-8BEN");
    s.people[0] = { ...s.people[0], taxDocumentId: "doc_w8", taxDocumentForm: "W-8BEN" };
    const html = renderToStaticMarkup(createElement(PortalProfile));
    expect(html).toMatch(/<a[^>]*href="\/api\/documents\/doc_w8"[^>]*target="_blank"[^>]*>.*View W-8BEN<\/a>|<a[^>]*target="_blank"[^>]*href="\/api\/documents\/doc_w8"[^>]*>.*View W-8BEN<\/a>/);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AppSnapshot } from "@/lib/contracts";
import { fixtureSnapshot } from "@/lib/client/fixture";
import { PortalClaims } from "@/components/app/portal/claims";
import { ClaimDetail } from "@/components/app/views/claims-view";

const state = vi.hoisted(() => ({ snapshot: null as AppSnapshot | null }));
vi.mock("@/lib/client/use-eve", () => ({
  useEve: () => ({ snapshot: state.snapshot, loading: false, error: null, act: vi.fn(), refresh: vi.fn() }),
  useAction: () => ({ state: { status: "idle" }, pending: false, run: vi.fn() }),
  useLivePolling: () => undefined,
}));

const ANSWER = "I was accepted off the waitlist on Oct 2.";

function marcusSnapshot(answered = false) {
  const s = fixtureSnapshot();
  s.actor = s.personas.find((p) => p.personId === "p-marcus")!;
  s.people = s.people.filter((p) => p.id === "p-marcus");
  s.claims = s.claims.filter((c) => c.personId === "p-marcus");
  if (answered) s.claims = s.claims.map((c) => (c.fareReview ? { ...c, status: "escalated", fareReview: { ...c.fareReview, explanation: ANSWER, explainedAt: s.now } } : c));
  return s;
}

describe("fare review rendering", () => {
  it("shows the attendee Eve's question and a way to answer it", () => {
    state.snapshot = marcusSnapshot();
    const html = renderToStaticMarkup(createElement(PortalClaims));
    expect(html).toContain("Eve asked:");
    expect(html).toContain("about $185 above what most attendees on that route paid");
    expect(html).toContain("Answer Eve");
    expect(html).not.toContain("Reply to the email Eve sent");
  });

  it("shows the attendee their answer instead of the form once sent", () => {
    state.snapshot = marcusSnapshot(true);
    const html = renderToStaticMarkup(createElement(PortalClaims));
    expect(html).toContain("You answered:");
    expect(html).toContain(ANSWER);
    expect(html).not.toContain("Answer Eve");
  });

  it("gives organizers the peer evidence, the question and the answer", () => {
    for (const answered of [false, true]) {
      const s = marcusSnapshot(answered);
      s.actor = s.personas.find((p) => p.role === "organizer")!;
      state.snapshot = s;
      const claim = s.claims.find((c) => c.fareReview)!;
      const html = renderToStaticMarkup(createElement(ClaimDetail, { claim, snapshot: s, onEvidence: () => {} }));
      expect(html).toContain("Fare check · YYZ → SFO");
      expect(html).toContain("Other attendees, median (9)");
      expect(html).toContain("$300.00");
      expect(html).toContain("$310.00");
      expect(html).toContain("Eve asked Marcus:");
      expect(html).toContain("High for the route:");
      if (answered) expect(html).toContain(`Marcus answered:</span> ${ANSWER}`);
      else expect(html).toContain("Waiting for Marcus&#x27;s answer");
    }
  });
});

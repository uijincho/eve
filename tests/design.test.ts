import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatMoney, minorToDecimalString } from "@/lib/design/money";
import { DUSK, GROUND, RAISED, STATE, STRUCTURE, TEXT, contrastRatio } from "@/lib/design/tokens";
import { duskBand, formatDue, horizonX } from "@/lib/design/urgency";

const NOW = new Date("2026-10-25T13:42:00-07:00");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe("duskBand", () => {
  it.each([
    [-5, 5],
    [18, 5],
    [59, 5],
    [60, 4],
    [78, 4],
    [24 * 60 - 1, 4],
    [24 * 60, 3],
    [2 * 24 * 60, 2],
    [7 * 24 * 60 - 1, 2],
    [7 * 24 * 60, 1],
  ])("%i minutes out is band %i", (minutes, band) => {
    expect(duskBand(later(minutes), NOW)).toBe(band);
  });
});

describe("formatDue", () => {
  it("counts minutes and hours inside a day, dates beyond it", () => {
    expect(formatDue(later(18), NOW)).toBe("18 min");
    expect(formatDue(later(78), NOW)).toBe("1 h 18 min");
    expect(formatDue(later(120), NOW)).toBe("2 h");
    expect(formatDue(new Date("2026-10-27T09:00:00-07:00"), NOW)).toBe("Oct 27");
    expect(formatDue(later(-5), NOW)).toBe("Overdue 5 min");
  });
});

describe("horizonX", () => {
  it("is monotonic and clamped", () => {
    const xs = [0, 30, 60, 600, 1440, 4000, 10080, 20160, 40000].map((m) =>
      horizonX(later(m), NOW),
    );
    expect(xs[0]).toBe(0);
    expect(xs.at(-1)).toBe(1);
    xs.slice(1).forEach((x, i) => expect(x).toBeGreaterThanOrEqual(xs[i]));
  });
});

describe("formatMoney", () => {
  it("formats minor units exactly", () => {
    expect(minorToDecimalString(129_900n, "USD")).toBe("1299.00");
    expect(minorToDecimalString(-5, "USD")).toBe("-0.05");
    expect(minorToDecimalString(1_000, "JPY")).toBe("1000");
    expect(formatMoney(129_900)).toBe("$1,299.00");
    expect(formatMoney(67_940, "CAD")).toBe("CA$679.40");
    expect(formatMoney(-38_970)).toBe("−$389.70");
    // Beyond Number.MAX_SAFE_INTEGER, still exact.
    expect(minorToDecimalString(9_007_199_254_740_993n, "USD")).toBe("90071992547409.93");
  });
});

describe("tokens", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  it("match app/globals.css", () => {
    for (const token of [...STRUCTURE, ...TEXT, ...DUSK, ...STATE]) {
      expect(css, token.name).toContain(`${token.name}: ${token.value};`);
    }
  });

  it("keep every text colour at AA on the ground and on raised surfaces", () => {
    for (const token of [...TEXT.filter((t) => t.name !== "--faint"), ...DUSK, ...STATE]) {
      expect(contrastRatio(token.value, GROUND), token.name).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(token.value, RAISED), token.name).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio("#8b91be", GROUND)).toBeGreaterThanOrEqual(4.5);
  });
});

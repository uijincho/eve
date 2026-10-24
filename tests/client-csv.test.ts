import { describe, expect, it } from "vitest";

import { parsePeopleCsv } from "@/lib/client/csv";

describe("parsePeopleCsv", () => {
  it("maps headers, normalizes codes, and counts minors", () => {
    const r = parsePeopleCsv(
      'name,email,country,dateOfBirth,role\n"Raman, Priya",priya@example.test,ca,2001-04-12,Hacker\nKid Coder,kid@example.test,US,2010-01-01,Hacker',
      "2026-10-24T17:00:00Z",
    );
    expect(r.errors).toEqual([]);
    expect(r.people[0]).toMatchObject({ name: "Raman, Priya", country: "CA", role: "Hacker" });
    expect(r.minors).toBe(1);
  });

  it("reports missing columns and bad rows", () => {
    expect(parsePeopleCsv("name,email\nA,a@b.c", "2026-10-24").errors[0]).toContain("country");
    const r = parsePeopleCsv("name,email,country,dob\nA,not-an-email,Canada,1/2/2000", "2026-10-24");
    expect(r.errors).toHaveLength(3);
  });
});

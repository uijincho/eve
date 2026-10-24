import { describe, expect, it } from "vitest";

import { parsePeopleCsv, parseSubmissionList } from "@/lib/client/csv";

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

  it("reads project, projectUrl and submitted without requiring them", () => {
    const r = parsePeopleCsv(
      "name,email,country,dateOfBirth,project,projectUrl,submitted\nAda Lovelace,ada@example.test,GB,1990-01-02,Analytical Engine,https://devpost.example/ada,yes\nNo Project,none@example.test,US,1991-02-03,,,no\nBlank,blank@example.test,CA,1992-03-04,,,",
      "2026-10-24T17:00:00Z",
    );
    expect(r.errors).toEqual([]);
    expect(r.people[0]).toMatchObject({ projectStatus: "submitted", projectUrl: "https://devpost.example/ada" });
    expect(r.people[1]).toMatchObject({ projectStatus: "none" });
    expect(r.people[1].projectUrl).toBeUndefined();
    expect(r.people[2].projectStatus).toBeUndefined();
  });

  it("parses a judging export of emails or names", () => {
    const headed = parseSubmissionList("email,name,project\nada@example.test,Ada Lovelace,https://devpost.example/ada\n,Just A Name,");
    expect(headed.errors).toEqual([]);
    expect(headed.entries).toEqual([
      { email: "ada@example.test", name: "Ada Lovelace", projectUrl: "https://devpost.example/ada" },
      { name: "Just A Name" },
    ]);
    expect(parseSubmissionList("ada@example.test\nGrace Hopper").entries).toEqual([
      { email: "ada@example.test" },
      { name: "Grace Hopper" },
    ]);
  });

  it("reports missing columns and bad rows", () => {
    expect(parsePeopleCsv("name,email\nA,a@b.c", "2026-10-24").errors[0]).toContain("country");
    const r = parsePeopleCsv("name,email,country,dob\nA,not-an-email,Canada,1/2/2000", "2026-10-24");
    expect(r.errors).toHaveLength(3);
  });
});

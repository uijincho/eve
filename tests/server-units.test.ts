import { describe, expect, it } from "vitest";

import { normalizeConnectionString, requiresVerifiedTls } from "@/lib/db/connection";
import { csvCell, toCsv } from "@/lib/server/csv";
import { actionSchemas } from "@/lib/server/action-schemas";

describe("connection normalization", () => {
  it("drops sslrootcert=system but keeps verified TLS", () => {
    const url = "postgresql://u:p@db.example.com:5432/postgres?sslmode=verify-full&sslrootcert=system";
    const { config } = normalizeConnectionString(url);
    expect(config.connectionString).not.toContain("sslrootcert");
    expect(requiresVerifiedTls(url)).toBe(true);
    expect(requiresVerifiedTls("postgresql://u:p@db.example.com:6432/postgres?sslmode=verify-full")).toBe(true);
  });
});

describe("csv export", () => {
  it("neutralizes formulas and quotes separators", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(12n)).toBe("12");
    expect(toCsv(["a"], [["x\ny"]])).toBe('a\r\n"x\ny"\r\n');
  });
});

describe("action schemas", () => {
  it("are strict and never accept a role", () => {
    expect(actionSchemas["payout.release"].safeParse({ id: "p", role: "controller" }).success).toBe(false);
    expect(actionSchemas["payout.release"].safeParse({ ids: ["a", "b"] }).success).toBe(true);
    expect(actionSchemas["award.split"].safeParse({ teamId: "t", splits: [{ personId: "a", bps: 5000 }, { personId: "b", bps: 4000 }] }).success).toBe(false);
    expect(actionSchemas["claim.review"].safeParse({ id: "c", decision: "approve", reason: "ok" }).success).toBe(true);
    expect(actionSchemas["payout.verify"].safeParse({ id: "p", confirmation: "12345" }).success).toBe(false);
  });
});

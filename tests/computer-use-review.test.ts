import { describe, expect, it, vi } from "vitest";

const { readScreen } = vi.hoisted(() => ({ readScreen: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: readScreen }; },
}));

import { checkReviewPage } from "@/lib/computer-use/agent";
import { ACCOUNT_CODES, DEMO_PACKET } from "@/lib/computer-use/packet";

describe("portal account-code readback", () => {
  it.each(Object.values(ACCOUNT_CODES))("compares %s with the actual packet", async (accountCode) => {
    readScreen.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ account_code: accountCode }) }] });
    const checks = await checkReviewPage("screen", { ...DEMO_PACKET, accountCode });
    expect(checks.find((c) => c.label === "Account code")?.ok).toBe(true);
  });

  it("does not accept the prize code on a travel reimbursement", async () => {
    readScreen.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ account_code: ACCOUNT_CODES.prizes }) }] });
    const checks = await checkReviewPage("screen", { ...DEMO_PACKET, accountCode: ACCOUNT_CODES.travel });
    expect(checks.find((c) => c.label === "Account code")?.ok).toBe(false);
  });
});

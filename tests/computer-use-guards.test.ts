import { describe, expect, it } from "vitest";

import { toKeysym } from "@/lib/computer-use/computer";
import { checkComputerAction, checkPasswordTool, describeAction, looksLikeTaxId, pageFromTitle } from "@/lib/computer-use/guards";
import { DEMO_PACKET, packetBrief } from "@/lib/computer-use/packet";

describe("pageFromTitle", () => {
  it("reads the portal page from Chrome and Firefox window titles", () => {
    expect(pageFromTitle("Westbrook Finance · Sign in - Google Chrome")).toBe("login");
    expect(pageFromTitle("Westbrook Finance · Payee - Google Chrome")).toBe("payee");
    expect(pageFromTitle("Westbrook Finance · Payment details - Google Chrome")).toBe("payment");
    expect(pageFromTitle("Westbrook Finance · Documents — Mozilla Firefox")).toBe("documents");
    expect(pageFromTitle("Westbrook Finance · Review and submit - Google Chrome")).toBe("review");
    expect(pageFromTitle("Westbrook Finance · Submitted")).toBe("submitted");
    expect(pageFromTitle("Westbrook Finance · Session expired - Google Chrome")).toBe("expired");
  });

  it("treats anything else as another window", () => {
    expect(pageFromTitle("")).toBe("other");
    expect(pageFromTitle(null)).toBe("other");
    expect(pageFromTitle("127.0.0.1 - Google Chrome")).toBe("other");
    expect(pageFromTitle("Westbrook Finance · Something new - Google Chrome")).toBe("other");
  });
});

describe("review gate", () => {
  const review = { page: "review" as const, approved: false };

  it("blocks clicks, keys and typing on Review until a controller approves", () => {
    for (const name of ["left_click", "double_click", "triple_click", "key", "type", "left_click_drag", "left_mouse_down"]) {
      const result = checkComputerAction(name, { coordinate: [900, 600], text: "Return" }, review);
      expect(result.ok, name).toBe(false);
      if (!result.ok) expect(result.rule).toBe("review_gate");
    }
  });

  it("still lets the agent look at Review", () => {
    for (const name of ["screenshot", "scroll", "mouse_move", "wait", "cursor_position"]) {
      expect(checkComputerAction(name, { scroll_direction: "down", scroll_amount: 2 }, review).ok, name).toBe(true);
    }
  });

  it("allows the submit click once approved", () => {
    expect(checkComputerAction("left_click", { coordinate: [900, 600] }, { page: "review", approved: true }).ok).toBe(true);
  });

  it("does not interfere on other pages", () => {
    expect(checkComputerAction("left_click", { coordinate: [10, 10] }, { page: "payment", approved: false }).ok).toBe(true);
  });
});

describe("taxpayer ID guard", () => {
  it("recognizes SSN, ITIN and EIN shapes", () => {
    for (const text of ["123-45-6789", "123456789", "123 45 6789", "912-70-1234", "12-3456789", "SSN: 123-45-6789"]) {
      expect(looksLikeTaxId(text), text).toBe(true);
    }
  });

  it("leaves amounts, phone numbers, emails and dates alone", () => {
    for (const text of ["1000.00", "300.00", "70000", "416-555-0199", "maya.tremblay@example.com", "2026-10-19", "WB-26-01234", "5300", "1234567890123"]) {
      expect(looksLikeTaxId(text), text).toBe(false);
    }
  });

  it("blocks typing an SSN-shaped value on any page", () => {
    const result = checkComputerAction("type", { text: "123-45-6789" }, { page: "payee", approved: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rule).toBe("tax_id");
  });

  it("never needs a taxpayer ID for anything in the packet", () => {
    expect(looksLikeTaxId(packetBrief())).toBe(false);
  });
});

describe("password tool", () => {
  it("only types the password on the sign-in page", () => {
    expect(checkPasswordTool({ page: "login", approved: false }).ok).toBe(true);
    for (const page of ["payee", "payment", "documents", "review", "other"] as const) {
      const result = checkPasswordTool({ page, approved: false });
      expect(result.ok, page).toBe(false);
      if (!result.ok) expect(result.rule).toBe("password_scope");
    }
  });

  it("never describes the password", () => {
    expect(describeAction("type_portal_password", {})).toBe("Type the portal password (hidden from the model)");
  });
});

describe("toKeysym", () => {
  it("maps toolset key names to xdotool keysyms", () => {
    expect(toKeysym("Return")).toBe("Return");
    expect(toKeysym("enter")).toBe("Return");
    expect(toKeysym("ctrl+l")).toBe("ctrl+l");
    expect(toKeysym("ctrl+shift+Tab")).toBe("ctrl+shift+Tab");
    expect(toKeysym("cmd+a")).toBe("super+a");
    expect(toKeysym("pagedown")).toBe("Page_Down");
  });

  it("refuses anything that could reach the shell", () => {
    for (const combo of ["", "ctrl+", "a; rm -rf /", "$(reboot)", "Return`id`", "a b"]) {
      expect(() => toKeysym(combo), combo).toThrow();
    }
  });
});

describe("packet", () => {
  it("adds up and carries no secrets", () => {
    expect(DEMO_PACKET.grossCents - DEMO_PACKET.withheldCents).toBe(DEMO_PACKET.netCents);
    expect(packetBrief()).not.toMatch(/password\s*[:=]/i);
  });
});

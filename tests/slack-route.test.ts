import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const secret = "test-slack-signing-secret-not-a-credential";
const env = { SLACK_CLIENT_ID: "1.2", SLACK_CLIENT_SECRET: "test-client-secret", SLACK_SIGNING_SECRET: secret, BETTER_AUTH_SECRET: "test-auth-secret-that-is-long-enough-1234" };
const saved: Record<string, string | undefined> = {};

function signed(body: string, contentType: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return new Request("https://eve.test/api/webhooks/slack", {
    method: "POST", body,
    headers: { "content-type": contentType, "x-slack-signature": signature, "x-slack-request-timestamp": String(timestamp) },
  });
}

describe("Slack inbound route", () => {
  beforeAll(() => { for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; } });
  afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  it("rejects unsigned and stale requests before reading them", async () => {
    const { POST } = await import("@/app/api/webhooks/slack/route");
    const body = JSON.stringify({ type: "url_verification", challenge: "abc" });
    const forged = new Request("https://eve.test/api/webhooks/slack", { method: "POST", body, headers: { "content-type": "application/json", "x-slack-signature": "v0=00", "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)) } });
    expect((await POST(forged)).status).toBe(401);
    expect((await POST(signed(body, "application/json", Math.floor(Date.now() / 1000) - 600))).status).toBe(401);
  });

  it("answers Slack's URL verification challenge", async () => {
    const { POST } = await import("@/app/api/webhooks/slack/route");
    const response = await POST(signed(JSON.stringify({ type: "url_verification", challenge: "abc123" }), "application/json"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "abc123" });
  });

  it("binds the OAuth state to the organizer and org that started it", async () => {
    const { signInstallState, verifyInstallState } = await import("@/lib/slack/install");
    const state = signInstallState("org_1", "mem_dana", 1_000_000);
    expect(verifyInstallState(state, 1_000_000)).toEqual({ orgId: "org_1", memberId: "mem_dana" });
    expect(verifyInstallState(state, 1_000_000 + 11 * 60_000)).toBeNull();
    const [payload] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ o: "org_2", m: "mem_dana", exp: 2_000_000 })).toString("base64url");
    expect(verifyInstallState(`${forged}.${state.split(".")[1]}`, 1_000_000)).toBeNull();
    expect(verifyInstallState(`${payload}.tampered`, 1_000_000)).toBeNull();
  });

  it("refuses to send a taxpayer ID or account number to Slack, before any network call", async () => {
    const { slackApi } = await import("@/lib/slack/api");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(slackApi("xoxb-test", "chat.postMessage", { channel: "C1", text: "SSN 123-45-6789" })).rejects.toMatchObject({ code: "unsafe_content" });
    await expect(slackApi("xoxb-test", "chat.update", { channel: "C1", ts: "1.2", blocks: [{ type: "section", text: { type: "mrkdwn", text: "Account 4111222233334444" } }] })).rejects.toMatchObject({ code: "unsafe_content" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("issues link codes that normalize the way people type them", async () => {
    const { linkCodeHash, newLinkCode } = await import("@/lib/slack/identity");
    const code = newLinkCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(linkCodeHash(code.toLowerCase().replace("-", " "))).toBe(linkCodeHash(code));
  });
});

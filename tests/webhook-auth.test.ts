import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readWebhookBody, verifyBearer, verifySlackSignature, verifyStripeSignature } from "../lib/agent/webhook-auth";

const now = 1792836000;
const body = '{"id":"evt_1","livemode":false}';
const secret = "test-signing-secret-not-a-credential";
const stripe = (payload = body, timestamp = now) => `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;

describe("signed webhook boundaries", () => {
  it("accepts only the original Stripe payload and a recent v1 signature", () => {
    expect(verifyStripeSignature(body, stripe(), secret, now)).toBe(true);
    expect(verifyStripeSignature(body + " ", stripe(), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, stripe(body, now - 301), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, stripe(body, now + 301), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, `${stripe()},t=${now}`, secret, now)).toBe(false);
    expect(verifyStripeSignature(body, stripe(), undefined, now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${now},v1=xyz`, secret, now)).toBe(false);
  });
  it("allows Stripe secret rotation without accepting a v0 digest", () => {
    const valid = stripe().split("v1=")[1];
    expect(verifyStripeSignature(body, `t=${now},v1=${"0".repeat(64)},v1=${valid}`, secret, now)).toBe(true);
    expect(verifyStripeSignature(body, `t=${now},v0=${valid}`, secret, now)).toBe(false);
  });
  it("verifies the raw Slack form body and rejects stale requests", () => {
    const raw = "payload=%7B%22type%22%3A%22block_actions%22%7D";
    const sig = `v0=${createHmac("sha256", secret).update(`v0:${now}:${raw}`).digest("hex")}`;
    expect(verifySlackSignature(raw, sig, String(now), secret, now)).toBe(true);
    expect(verifySlackSignature(decodeURIComponent(raw), sig, String(now), secret, now)).toBe(false);
    expect(verifySlackSignature(raw, sig, String(now), secret, now + 301)).toBe(false);
  });
  it("requires an exact configured cron bearer", () => {
    expect(verifyBearer(`Bearer ${secret}`, secret)).toBe(true);
    expect(verifyBearer(`Bearer ${secret} `, secret)).toBe(false);
    expect(verifyBearer(null, secret)).toBe(false);
    expect(verifyBearer("Bearer undefined", undefined)).toBe(false);
  });
  it("limits actual streamed bytes even without Content-Length", async () => {
    await expect(readWebhookBody(new Request("https://eve.invalid", { method: "POST", body: "123456" }), 5)).rejects.toThrow("too large");
    await expect(readWebhookBody(new Request("https://eve.invalid", { method: "POST", body }), 100)).resolves.toBe(body);
  });
});

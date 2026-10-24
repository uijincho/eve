import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverNotification } from "../lib/notifications";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("notification delivery", () => {
  it("never contacts real providers for synthetic people, even when enabled", async () => {
    vi.stubEnv("EVE_NOTIFICATIONS_LIVE", "true");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await deliverNotification({ channel: "email", title: "Tax form needed", body: "Please visit your portal.", key: "chase:person:0", recipientEmail: "someone@example.com", synthetic: true });
    expect(result.status).toBe("simulated");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not follow an arbitrary webhook destination", async () => {
    vi.stubEnv("EVE_NOTIFICATIONS_LIVE", "true");
    vi.stubEnv("SLACK_WEBHOOK_URL", "http://127.0.0.1/private");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await deliverNotification({ channel: "slack", title: "Review needed", body: "Open Eve.", key: "notice:1", synthetic: false });
    expect(result.status).toBe("simulated");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains failed deliveries for retry without exposing provider errors", async () => {
    vi.stubEnv("EVE_NOTIFICATIONS_LIVE", "true");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/test/fixture");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sensitive provider error")));
    const result = await deliverNotification({ channel: "slack", title: "Review needed", body: "Open Eve.", key: "notice:1", synthetic: false });
    expect(result.status).toBe("queued");
    expect(result.detail).not.toContain("sensitive");
  });
});

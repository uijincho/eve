import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudConfigured, cloudRequest, publicAppUrl, runCostLimit, uploadBundle } from "@/lib/browser-use/client";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Browser Use Cloud transport", () => {
  it("requires a key and a publicly reachable HTTPS portal", () => {
    vi.stubEnv("BROWSER_USE_API_KEY", "");
    expect(cloudConfigured()).toMatch(/BROWSER_USE_API_KEY/);
    vi.stubEnv("EVE_APP_URL", "http://localhost:3000");
    expect(() => publicAppUrl()).toThrow(/public HTTPS/);
    vi.stubEnv("EVE_APP_URL", "https://eve.example.test/path");
    expect(publicAppUrl()).toBe("https://eve.example.test");
  });
  it("authenticates server requests and never retries a rejected task creation", async () => {
    vi.stubEnv("BROWSER_USE_API_KEY", "private-test-key");
    const request = vi.fn().mockResolvedValue(new Response("{}", { status: 402 }));
    vi.stubGlobal("fetch", request);
    await expect(cloudRequest("/runs", { task: "one batch" })).rejects.toThrow(/credits/);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1].headers["X-Browser-Use-API-Key"]).toBe("private-test-key");
    expect(request.mock.calls[0][1].body).not.toContain("private-test-key");
  });
  it("uploads the exact ZIP with the declared content type without exposing the API key to storage", async () => {
    vi.stubEnv("BROWSER_USE_API_KEY", "private-test-key");
    const request = vi.fn().mockResolvedValueOnce(Response.json({ files: [{ id: "file", path: "uploads/batch.zip", uploadUrl: "https://storage.example.test/upload" }] })).mockResolvedValueOnce(new Response());
    vi.stubGlobal("fetch", request);
    const allocation = Buffer.from([0, 80, 75, 0]);
    expect(await uploadBundle("workspace", allocation.subarray(1, 3))).toEqual({ id: "file", path: "uploads/batch.zip" });
    const put = request.mock.calls[1][1];
    expect(put.method).toBe("PUT");
    expect(put.headers).toEqual({ "Content-Type": "application/zip" });
    expect(new Uint8Array(put.body)).toEqual(new Uint8Array([80, 75]));
  });
  it("defaults to a small task cost cap and refuses invalid overrides", () => {
    vi.stubEnv("EVE_BROWSER_USE_MAX_COST_USD", ""); expect(runCostLimit()).toBe(0.5);
    vi.stubEnv("EVE_BROWSER_USE_MAX_COST_USD", "-1"); expect(() => runCostLimit()).toThrow();
  });
});

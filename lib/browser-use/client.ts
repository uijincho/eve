/** Browser Use Cloud V4. All calls stay server-side; mutation requests are never blindly retried. */
const API = "https://api.browser-use.com/api/v4";
export type RunStatus = "queued" | "dispatching" | "running" | "completed" | "failed" | "cancelled";
export interface CloudRun { id: string; sessionId: string; workspaceId: string; status: RunStatus }
export interface CloudEvents { events: { id: number; type: string; data: Record<string, unknown> }[]; nextAfter?: number; hasMore?: boolean }

export function publicAppUrl(): string {
  const raw = process.env.EVE_APP_URL || process.env.BETTER_AUTH_URL;
  if (!raw) throw new Error("Set EVE_APP_URL to the public HTTPS address of Eve before using Browser Use.");
  const url = new URL(raw);
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) {
    throw new Error("Browser Use needs a public HTTPS EVE_APP_URL, not a localhost address.");
  }
  return url.origin;
}

export function cloudConfigured(): string | null {
  if (!process.env.BROWSER_USE_API_KEY) return "Add BROWSER_USE_API_KEY to enable Browser Use Cloud.";
  if (!process.env.EVE_VAULT_KEY) return "Add EVE_VAULT_KEY to secure the batch portal.";
  try { publicAppUrl(); } catch (e) { return (e as Error).message; }
  return null;
}

export async function cloudRequest<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const key = process.env.BROWSER_USE_API_KEY;
  if (!key) throw new Error("BROWSER_USE_API_KEY is not configured.");
  const response = await fetch(`${API}${path}`, {
    method, headers: { "X-Browser-Use-API-Key": key, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  if (!response.ok) {
    const help = response.status === 402 ? "Check Browser Use credits or its spending cap."
      : response.status === 401 ? "Check BROWSER_USE_API_KEY." : response.status === 429 ? "Browser Use is rate limited; retry after the current task stops." : "Check Browser Use task activity.";
    throw new Error(`Browser Use returned HTTP ${response.status}. ${help}`);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export async function uploadBundle(workspaceId: string, bytes: Uint8Array) {
  const result = await cloudRequest<{ files: { id: string; path: string; uploadUrl: string }[] }>(`/workspaces/${encodeURIComponent(workspaceId)}/files/upload`, {
    files: [{ name: "batch.zip", contentType: "application/zip", size: bytes.byteLength }],
  });
  const file = result.files[0];
  if (!file || new URL(file.uploadUrl).protocol !== "https:") throw new Error("Browser Use did not return a secure upload URL.");
  // Postgres returns a Buffer, whose slice() can still share a larger backing
  // allocation. Copy exactly these bytes: the signed URL pins Content-Length.
  const response = await fetch(file.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/zip" }, body: Uint8Array.from(bytes).buffer, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Browser Use bundle upload failed (HTTP ${response.status}).`);
  return { id: file.id, path: file.path };
}

export function runCostLimit(): number {
  const amount = Number(process.env.EVE_BROWSER_USE_MAX_COST_USD || "0.50");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10) throw new Error("EVE_BROWSER_USE_MAX_COST_USD must be between 0 and 10 USD.");
  return amount;
}

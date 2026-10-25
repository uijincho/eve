import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { lockOrgFinance } from "@/lib/server/payouts";
import { financeFingerprint } from "./fingerprint";
import { publicAppUrl } from "./client";
import { cloudState, equalSecret, portalKey, type CloudState } from "./state";

export const MAX_PORTAL_UPLOAD = 4_000_000;
const cookieName = "eve_batch_portal";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
type Context = { batchId: string; token: string; path?: string[] };

async function readUpload(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Choose the batch ZIP.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_PORTAL_UPLOAD) { await reader.cancel(); throw new Error("The hosted portal accepts bundles up to 4 MB."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** A private, batch-scoped fictional counterparty. It never moves real funds. */
export async function handleBatchPortal(request: Request, context: Context): Promise<Response> {
  const db = getDb();
  const [batch] = await db.select().from(s.disbursementBatch).where(eq(s.disbursementBatch.id, context.batchId));
  const state = cloudState(batch?.state);
  if (!batch || !state || !equalSecret(context.token, portalKey(batch.id, state.attempt, "link"))) return json({ ok: false }, 404);
  if (!state.validUntil || Date.now() >= Date.parse(state.validUntil)) return json({ ok: false, message: "This batch portal link expired." }, 410);
  const endpoint = context.path?.join("/") ?? "";
  const base = `/api/sponsor-portal/${encodeURIComponent(batch.id)}/${encodeURIComponent(context.token)}`;
  const cookie = request.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? "";
  const signedIn = equalSecret(cookie, portalKey(batch.id, state.attempt, "cookie"));
  if (request.method === "GET" && !endpoint) {
    let html = await readFile(path.join(process.cwd(), "lab/westbrook-portal/index.html"), "utf8");
    html = html.replaceAll('fetch("/api/', `fetch("${base}/api/`)
      .replaceAll("30 MB", "4 MB").replaceAll("30000000", String(MAX_PORTAL_UPLOAD));
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
  }
  if (request.method === "GET" && endpoint === "api/config") return json({ strictSsn: false, timeoutSeconds: 900 });
  if (request.method !== "POST") return json({ ok: false }, 404);
  const origin = request.headers.get("origin");
  // Next can see an internal HTTP address behind a tunnel or reverse proxy.
  // Trust the configured public origin, not a forwarded request header.
  if (origin && origin !== publicAppUrl()) return json({ ok: false }, 403);
  if (endpoint === "api/login") {
    const body = await request.json().catch(() => ({}));
    const ok = body.username === "eve.calhacks" && typeof body.password === "string" && equalSecret(body.password, portalKey(batch.id, state.attempt, "login"));
    return json({ ok }, ok ? 200 : 401, ok ? { "Set-Cookie": `${cookieName}=${portalKey(batch.id, state.attempt, "cookie")}; Path=${base}; HttpOnly; Secure; SameSite=Strict; Max-Age=900` } : {});
  }
  if (!signedIn) return json({ ok: false, message: "Sign in again." }, 401);
  if (endpoint === "api/event") return json({ ok: true });
  try {
    if (endpoint === "api/bulk-import") {
      const bytes = await readUpload(request);
      const [doc] = await db.select({ sha256: s.document.sha256 }).from(s.document).where(eq(s.document.id, batch.documentId!));
      if (!doc || createHash("sha256").update(bytes).digest("hex") !== doc.sha256) return json({ ok: false, message: "This ZIP differs from the released batch. Upload its original bundle." }, 422);
      return await db.transaction(async (tx) => {
        await lockOrgFinance(tx, batch.orgId);
        const [current] = await tx.select().from(s.disbursementBatch).where(eq(s.disbursementBatch.id, batch.id));
        const live = cloudState(current.state);
        if (!live || live.attempt !== state.attempt || !["filling", "submitting", "submitted"].includes(current.status)) return json({ ok: false, message: "This batch is no longer available for submission." }, 409);
        await tx.update(s.disbursementBatch).set({ state: { ...live, importedHash: current.manifestHash }, updatedAt: new Date() }).where(eq(s.disbursementBatch.id, batch.id));
        return json({ ok: true, batchId: batch.id, manifestHash: current.manifestHash, manifest: current.manifest });
      });
    }
    if (endpoint === "api/bulk-submit") {
      const body = await request.json();
      if (body.batchId !== batch.id) return json({ ok: false, message: "Wrong batch." }, 422);
      return await db.transaction(async (tx) => {
        await lockOrgFinance(tx, batch.orgId);
        const [current] = await tx.select().from(s.disbursementBatch).where(eq(s.disbursementBatch.id, batch.id));
        const live = cloudState(current.state);
        if (!live || live.attempt !== state.attempt) return json({ ok: false }, 403);
        if (live.receipt) return json({ ok: true, confirmation: live.receipt.confirmation });
        if (current.status !== "filling" || live.importedHash !== current.manifestHash || !live.fingerprint || !live.validUntil || Date.now() >= Date.parse(live.validUntil)) {
          return json({ ok: false, message: "The batch is not ready or its release check expired. Return to Eve and retry it." }, 409);
        }
        if (await financeFingerprint(tx, current.orgId) !== live.fingerprint) return json({ ok: false, message: "Payment details changed after release checks. Nothing was submitted. Return to Eve to review the batch." }, 409);
        const receipt = { batchId: current.id, manifestHash: current.manifestHash, manifest: current.manifest, confirmation: `WB-${randomUUID().slice(0, 8).toUpperCase()}`, receivedAt: new Date().toISOString() };
        const next: CloudState = { ...live, submissionAuthorized: true, receipt };
        await tx.update(s.disbursementBatch).set({ state: { ...next }, status: "submitting", confirmation: receipt.confirmation, updatedAt: new Date() }).where(eq(s.disbursementBatch.id, batch.id));
        return json({ ok: true, confirmation: receipt.confirmation });
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("4 MB")) return json({ ok: false, message: error.message }, 413);
    return json({ ok: false, message: "The portal could not finish this request. Retry the same batch." }, 503);
  }
  return json({ ok: false }, 404);
}

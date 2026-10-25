import { createHmac, timingSafeEqual } from "node:crypto";
import type { BatchManifest } from "@/lib/computer-use/batch-packet";

export interface PortalReceipt { batchId: string; manifestHash: string; manifest: BatchManifest; confirmation: string; receivedAt: string }
export interface CloudState {
  provider: "browser-use";
  attempt: string;
  submissionAuthorized?: boolean;
  validating?: boolean;
  fingerprint?: string;
  validUntil?: string;
  workspaceId?: string;
  fileId?: string;
  filePath?: string;
  dispatching?: boolean;
  runId?: string;
  sessionId?: string;
  browserId?: string;
  cursor?: number;
  importedHash?: string;
  receipt?: PortalReceipt;
}
export function cloudState(state: unknown): CloudState | null {
  return state && typeof state === "object" && "provider" in state && state.provider === "browser-use" ? state as CloudState : null;
}
export function portalKey(batchId: string, attempt: string, purpose: "link" | "login" | "cookie") {
  const key = process.env.EVE_VAULT_KEY;
  if (!key) throw new Error("EVE_VAULT_KEY is missing.");
  return createHmac("sha256", key).update(`browser-use:${purpose}:${batchId}:${attempt}`).digest("base64url");
}
export function equalSecret(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

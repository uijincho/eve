import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_WEBHOOK_BYTES = 256 * 1024;

/** Compare digests only after validating their encoding and length. */
function matchesHex(expected: string, received: string): boolean {
  return /^[a-f0-9]{64}$/i.test(received)
    && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

function fresh(timestamp: string, nowSeconds: number): boolean {
  return /^\d{10}$/.test(timestamp) && Math.abs(nowSeconds - Number(timestamp)) <= 300;
}

/** Stripe v1 signs `${timestamp}.${rawBody}`. Verify before parsing JSON. */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !header || header.length > 4096) return false;
  const fields = header.split(",").map((part) => part.trim().split("="));
  const timestamps = fields.filter(([key]) => key === "t");
  if (timestamps.length !== 1 || !fresh(timestamps[0][1] ?? "", nowSeconds)) return false;
  const expected = createHmac("sha256", secret).update(`${timestamps[0][1]}.${rawBody}`).digest("hex");
  return fields.some(([key, value]) => key === "v1" && matchesHex(expected, value ?? ""));
}

/** Slack v0 signs the original form body, including its timestamp. */
export function verifySlackSignature(rawBody: string, signature: string | null, timestamp: string | null, secret: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !signature?.startsWith("v0=") || !timestamp || !fresh(timestamp, nowSeconds)) return false;
  const expected = createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  return matchesHex(expected, signature.slice(3));
}

export function verifyBearer(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(authorization);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

/** Enforce the limit even if Content-Length is absent or misleading. */
export async function readWebhookBody(request: Request, limit = MAX_WEBHOOK_BYTES): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new Error("Webhook body too large");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Webhook body too large");
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    reader.releaseLock();
  }
}

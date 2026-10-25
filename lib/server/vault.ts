// PII vault: AES-256-GCM with a server key (EVE_VAULT_KEY, 32 bytes hex).
// Ciphertext lives in vault_secret; the rest of the app, the agent, logs and
// snapshots only ever see the row id and last 4 characters. The org id is
// bound as additional authenticated data, so ciphertext cannot be replayed
// into another tenant.

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { Executor } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { vaultSecret } from "@/lib/db/schema";

type Kind = "tin" | "bank_account" | "verification_code";

function key(): Buffer {
  const hex = process.env.EVE_VAULT_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("EVE_VAULT_KEY must be 32 bytes of hex.");
  return Buffer.from(hex, "hex");
}

export function last4(value: string): string {
  const digits = value.replace(/[^0-9A-Za-z]/g, "");
  return digits.slice(-4);
}

export async function sealSecret(db: Executor, input: { orgId: string; personId?: string | null; kind: Kind; value: string; last4?: string }) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`${input.orgId}:${input.kind}`));
  const ciphertext = Buffer.concat([cipher.update(input.value, "utf8"), cipher.final()]);
  const id = newId("vlt");
  await db.insert(vaultSecret).values({
    id, orgId: input.orgId, personId: input.personId ?? null, kind: input.kind, ciphertext, iv, tag: cipher.getAuthTag(),
    last4: input.kind === "verification_code" ? null : (input.last4 ?? last4(input.value)),
  });
  return id;
}

/** Server-only. Never return the result to a client except a verification code to its own recipient. */
export async function openSecret(db: Executor, orgId: string, id: string): Promise<string | null> {
  const [row] = await db.select().from(vaultSecret).where(and(eq(vaultSecret.id, id), eq(vaultSecret.orgId, orgId)));
  if (!row) return null;
  const decipher = createDecipheriv("aes-256-gcm", key(), row.iv);
  decipher.setAAD(Buffer.from(`${row.orgId}:${row.kind}`));
  decipher.setAuthTag(row.tag);
  return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Seals a secret kept on its own row (the Slack bot token), bound to the org and its purpose. */
export function sealValue(orgId: string, purpose: string, value: string): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`${orgId}:${purpose}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

/** Server-only inverse of sealValue. */
export function openValue(orgId: string, purpose: string, sealed: { ciphertext: Buffer; iv: Buffer; tag: Buffer }): string {
  const decipher = createDecipheriv("aes-256-gcm", key(), sealed.iv);
  decipher.setAAD(Buffer.from(`${orgId}:${purpose}`));
  decipher.setAuthTag(sealed.tag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
}

/** Builds encrypted vault rows without touching the database (for bulk inserts). */
export function sealRow(input: { id: string; orgId: string; personId?: string | null; kind: Kind; value: string }): typeof vaultSecret.$inferInsert {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`${input.orgId}:${input.kind}`));
  const ciphertext = Buffer.concat([cipher.update(input.value, "utf8"), cipher.final()]);
  return { id: input.id, orgId: input.orgId, personId: input.personId ?? null, kind: input.kind, ciphertext, iv, tag: cipher.getAuthTag(), last4: input.kind === "verification_code" ? null : last4(input.value) };
}

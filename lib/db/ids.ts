import { randomBytes } from "node:crypto";

/** Prefixed, URL-safe random ids (e.g. `pay_3k9…`). */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

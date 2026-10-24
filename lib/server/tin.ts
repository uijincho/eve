import type { Executor } from "@/lib/db";

import { last4, sealSecret } from "./vault";

/** Vaults a TIN/SSN/SIN; returns only the vault id and last 4. */
export async function vaultTin(db: Executor, orgId: string, personId: string, tin: string) {
  const digits = tin.replace(/[^0-9A-Za-z]/g, "");
  const vaultId = await sealSecret(db, { orgId, personId, kind: "tin", value: digits });
  return { vaultId, last4: last4(digits) };
}

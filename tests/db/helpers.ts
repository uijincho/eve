import { loadEnvConfig } from "@next/env";
import { eq, inArray, sql } from "drizzle-orm";

loadEnvConfig(process.cwd());

export const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Creates a disposable org flagged is_demo so it can be removed through the scoped reset guard. */
export async function createTestOrg(label: string) {
  const { getDb } = await import("@/lib/db");
  const { organization } = await import("@/lib/db/schema");
  const { newId } = await import("@/lib/db/ids");
  const id = newId("orgtest");
  await getDb().insert(organization).values({ id, slug: `${label}-${id}`.toLowerCase(), name: `Test ${label}`, country: "US", isDemo: true });
  return id;
}

export async function dropTestOrg(orgId: string) {
  const { getDb } = await import("@/lib/db");
  const { purgeOrg } = await import("@/lib/server/reset");
  await getDb().transaction(async (tx) => purgeOrg(tx, orgId, { deleteOrg: true }));
}

export { eq, inArray, sql };

/** Resolves to the full error text, including the Postgres cause that Drizzle wraps. */
export async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const parts: string[] = [];
    let e: unknown = error;
    while (e instanceof Error) {
      parts.push(e.message);
      e = (e as Error & { cause?: unknown }).cause;
    }
    return parts.join(" | ");
  }
  throw new Error("expected the operation to fail");
}

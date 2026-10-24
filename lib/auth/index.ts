// Better Auth: real user accounts (email + password) stored through the
// Drizzle adapter. Organization roles do NOT live in Better Auth; they come
// from org_member rows (see lib/auth/session.ts). Demo personas use a separate,
// demo-only signed cookie and never pass through this instance.

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { getDb } from "@/lib/db";
import { authAccount, authSession, authUser, authVerification } from "@/lib/db/schema";

/** Public origin: BETTER_AUTH_URL, else the Vercel deployment URL, else local dev. */
export function appOrigin(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function trustedOrigins(): string[] {
  const hosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean);
  return [appOrigin(), ...hosts.map((h) => `https://${h}`)];
}

function createAuth() {
  return betterAuth({
    appName: "Eve",
    baseURL: appOrigin(),
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(),
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { user: authUser, session: authSession, account: authAccount, verification: authVerification },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    advanced: { useSecureCookies: appOrigin().startsWith("https://") },
    plugins: [nextCookies()],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  instance ??= createAuth();
  return instance;
}

/** Cookie names Better Auth uses for its session token (plain and __Secure- prefixed). */
export const BETTER_AUTH_COOKIE = /(^|;\s*)(__Secure-)?better-auth\.session_token=/;

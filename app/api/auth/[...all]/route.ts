import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";

// Better Auth endpoints (sign up / sign in / sign out / session). Real users
// only; demo personas use POST /api/demo/session.
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}

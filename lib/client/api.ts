// The one typed client for Eve's REST boundary (lib/contracts.ts). Every
// screen goes through these functions so integration fixes land in one place.
import type {
  ActionResult,
  AppAction,
  AppSnapshot,
} from "@/lib/contracts";

import { fixtureAction, fixtureEnabled, fixtureSnapshot } from "./fixture";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? res.statusText;
  } catch {
    return res.statusText || `Request failed (${res.status})`;
  }
}

export async function getSnapshot(signal?: AbortSignal): Promise<AppSnapshot> {
  if (fixtureEnabled()) return fixtureSnapshot();
  const res = await fetch("/api/app", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as AppSnapshot;
}

/** POST /api/actions. A non-2xx response still yields an ActionResult. */
export async function runAction(
  action: AppAction,
  payload: Record<string, unknown>,
): Promise<ActionResult> {
  if (fixtureEnabled()) return fixtureAction(action);
  try {
    const res = await fetch("/api/actions", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    const body = (await res.json().catch(() => null)) as ActionResult | null;
    if (body && typeof body.ok === "boolean") return body;
    return { ok: false, message: res.ok ? "Unexpected response" : `Request failed (${res.status})` };
  } catch {
    return { ok: false, message: "Could not reach Eve. Check your connection and try again." };
  }
}

/** Switches the sample persona. Demo only: the server decides what it may do. */
export async function switchPersona(personaId: string): Promise<ActionResult> {
  if (fixtureEnabled()) return fixtureAction("demo.reset");
  const res = await fetch("/api/demo/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ personaId }),
  });
  if (!res.ok) return { ok: false, message: await readError(res) };
  return { ok: true, message: "Switched sample persona" };
}

export type UploadedDocument = { id: string; name: string; url: string };

export async function uploadDocument(file: File): Promise<UploadedDocument> {
  if (fixtureEnabled()) throw new ApiError("Fixture mode: uploads are not sent", 0);
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/documents", {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as UploadedDocument;
}

export function documentUrl(id: string): string {
  return `/api/documents/${encodeURIComponent(id)}`;
}

export type ExportType = "ledger" | "claims" | "payouts" | "filings" | "packet";

export function exportUrl(type: ExportType, id?: string): string {
  const q = new URLSearchParams({ type });
  if (id) q.set("id", id);
  return `/api/export?${q.toString()}`;
}

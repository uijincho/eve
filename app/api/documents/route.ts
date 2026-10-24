import { resolveActor } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ActionError, loadPerson, storeDocument, validateUpload, MAX_DOCUMENT_BYTES } from "@/lib/server/core";
import { json, sameOrigin } from "@/lib/server/http";

// POST /api/documents (multipart: file, kind?, personId?) -> { id, name, url, sha256 }.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, message: "Cross-site request rejected." }, 403);
  const actor = await resolveActor(request);
  if (!actor) return json({ ok: false, message: "Sign in to continue." }, 401);
  if (actor.role === "auditor") return json({ ok: false, message: "Auditors have read-only access." }, 403);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_DOCUMENT_BYTES + 64 * 1024) return json({ ok: false, message: "Files must be at most 8 MB." }, 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, message: "Send multipart/form-data with a file field." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ ok: false, message: "Missing file." }, 400);
  const kind = form.get("kind") === "upload" ? "upload" : "receipt";
  const personIdField = form.get("personId");
  const personId = actor.role === "attendee" ? actor.personId : typeof personIdField === "string" && personIdField ? personIdField : null;
  if (actor.role === "attendee" && typeof personIdField === "string" && personIdField && personIdField !== actor.personId) {
    return json({ ok: false, message: "You can only upload your own documents." }, 403);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    validateUpload(bytes, file.type);
    const db = getDb();
    if (personId) await loadPerson(db, actor.orgId, personId);
    const doc = await storeDocument(db, { orgId: actor.orgId, personId, uploadedBy: actor.memberId, kind, name: file.name, mimeType: file.type, bytes });
    return json({ id: doc.id, name: doc.name, url: doc.url, sha256: doc.sha256 }, 201);
  } catch (e) {
    if (e instanceof ActionError) return json({ ok: false, message: e.message }, e.status);
    throw e;
  }
}

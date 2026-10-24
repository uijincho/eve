// Resumes a waiting workflow run through its hook (e.g. a controller approval).
// TODO: authenticate the caller, then call resumeHook() from "workflow/api".
export async function POST(): Promise<Response> {
  return Response.json({ error: "Not implemented" }, { status: 501 });
}

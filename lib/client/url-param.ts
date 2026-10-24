/**
 * Reads a query parameter once on the client. Pages render their data only
 * after the snapshot loads, so the server and first client render agree.
 * (Avoids useSearchParams, which needs a Suspense boundary under Cache Components.)
 */
export function initialParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

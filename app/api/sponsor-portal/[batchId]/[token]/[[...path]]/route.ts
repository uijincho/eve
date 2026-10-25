import { handleBatchPortal } from "@/lib/browser-use/portal";

export const maxDuration = 60;
type Context = { params: Promise<{ batchId: string; token: string; path?: string[] }> };
export async function GET(request: Request, { params }: Context) {
  return handleBatchPortal(request, await params);
}
export async function POST(request: Request, { params }: Context) {
  return handleBatchPortal(request, await params);
}

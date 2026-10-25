import { beforeEach, describe, expect, it, vi } from "vitest";
import { disbursementWorkflow } from "@/workflows/disbursement";

const batch = vi.hoisted(() => ({
  beginBatch: vi.fn(), prepareBatchItem: vi.fn(), prepareBatchItems: vi.fn(), prepareBatchBundle: vi.fn(),
  bootBatch: vi.fn(), batchTurn: vi.fn(), authorizeBatch: vi.fn(), finishBatch: vi.fn(), failBatch: vi.fn(), closeBatch: vi.fn(),
}));
vi.mock("@/lib/computer-use/batch-run", () => batch);
vi.mock("workflow", () => ({
  createHook: () => ({ getConflict: async () => null, [Symbol.dispose]() {} }),
  getWorkflowMetadata: () => ({ workflowRunId: "workflow-test" }),
}));

describe("sponsor preparation workflow", () => {
  const target = { orgId: "org", batchId: "batch" };
  beforeEach(() => {
    vi.resetAllMocks();
    batch.prepareBatchItems.mockResolvedValue(true);
    batch.prepareBatchBundle.mockResolvedValue(true);
    batch.bootBatch.mockResolvedValue("desktop");
    batch.batchTurn.mockResolvedValue("submitted");
  });
  it("prepares 200 payments in 20 bounded steps before opening one desktop", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `payout-${i}`);
    batch.beginBatch.mockResolvedValue(ids);
    await disbursementWorkflow(target, { batchPreparation: true });
    expect(batch.prepareBatchItems).toHaveBeenCalledTimes(20);
    expect(batch.prepareBatchItems.mock.calls.flatMap((call) => call[1])).toEqual(ids);
    expect(batch.prepareBatchItems.mock.calls.every((call) => call[1].length === 10)).toBe(true);
    expect(batch.prepareBatchItem).not.toHaveBeenCalled();
    expect(batch.bootBatch).toHaveBeenCalledTimes(1);
    expect(batch.finishBatch).toHaveBeenCalledTimes(1);
    expect(batch.failBatch).not.toHaveBeenCalled();
  });
  it("stops preparation on cancellation without bundling or opening a browser", async () => {
    batch.beginBatch.mockResolvedValue(Array.from({ length: 25 }, (_, i) => `payout-${i}`));
    batch.prepareBatchItems.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await disbursementWorkflow(target, { batchPreparation: true });
    expect(batch.prepareBatchItems).toHaveBeenCalledTimes(2);
    expect(batch.prepareBatchBundle).not.toHaveBeenCalled();
    expect(batch.bootBatch).not.toHaveBeenCalled();
    expect(batch.closeBatch).toHaveBeenCalledWith(target, null);
  });
  it("preserves the per-item step sequence for already-started workflows", async () => {
    batch.beginBatch.mockResolvedValue(["a", "b"]);
    await disbursementWorkflow(target);
    expect(batch.prepareBatchItem.mock.calls).toEqual([[target, "a"], [target, "b"]]);
    expect(batch.prepareBatchItems).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { disbursementWorkflow } from "@/workflows/disbursement";

const batch = vi.hoisted(() => ({
  beginBatch: vi.fn(), prepareBatchItem: vi.fn(), prepareBatchItems: vi.fn(), prepareBatchBundle: vi.fn(),
}));
const cloud = vi.hoisted(() => ({
  preflightCloudBatch: vi.fn(), startCloudBatch: vi.fn(), pollCloudBatch: vi.fn(),
  finishCloudBatch: vi.fn(), failCloudBatch: vi.fn(), closeCloudBatch: vi.fn(),
}));
vi.mock("@/lib/computer-use/batch-run", () => batch);
vi.mock("@/lib/browser-use/batch", () => cloud);
vi.mock("workflow", () => ({
  createHook: () => ({ getConflict: async () => null, [Symbol.dispose]() {} }),
  sleep: vi.fn(async () => {}),
  getWorkflowMetadata: () => ({ workflowRunId: "workflow-test" }),
}));

describe("sponsor preparation workflow", () => {
  const target = { orgId: "org", batchId: "batch" };
  beforeEach(() => {
    vi.resetAllMocks();
    batch.prepareBatchItems.mockResolvedValue(true);
    batch.prepareBatchBundle.mockResolvedValue(true);
    cloud.preflightCloudBatch.mockResolvedValue(true);
    cloud.pollCloudBatch.mockResolvedValue("submitted");
  });
  it("prepares 200 payments in 20 bounded steps before opening one cloud run", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `payout-${i}`);
    batch.beginBatch.mockResolvedValue(ids);
    await disbursementWorkflow(target, { batchPreparation: true });
    expect(batch.prepareBatchItems).toHaveBeenCalledTimes(20);
    expect(batch.prepareBatchItems.mock.calls.flatMap((call) => call[1])).toEqual(ids);
    expect(batch.prepareBatchItems.mock.calls.every((call) => call[1].length === 10)).toBe(true);
    expect(batch.prepareBatchItem).not.toHaveBeenCalled();
    expect(cloud.preflightCloudBatch).toHaveBeenCalledTimes(1);
    expect(cloud.startCloudBatch).toHaveBeenCalledTimes(1);
    expect(cloud.finishCloudBatch).toHaveBeenCalledTimes(1);
    expect(cloud.failCloudBatch).not.toHaveBeenCalled();
  });
  it("stops preparation on cancellation without bundling or opening a browser", async () => {
    batch.beginBatch.mockResolvedValue(Array.from({ length: 25 }, (_, i) => `payout-${i}`));
    batch.prepareBatchItems.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await disbursementWorkflow(target, { batchPreparation: true });
    expect(batch.prepareBatchItems).toHaveBeenCalledTimes(2);
    expect(batch.prepareBatchBundle).not.toHaveBeenCalled();
    expect(cloud.startCloudBatch).not.toHaveBeenCalled();
    expect(cloud.closeCloudBatch).toHaveBeenCalledWith(target);
  });
  it("preserves the per-item step sequence for already-started workflows", async () => {
    batch.beginBatch.mockResolvedValue(["a", "b"]);
    await disbursementWorkflow(target);
    expect(batch.prepareBatchItem.mock.calls).toEqual([[target, "a"], [target, "b"]]);
    expect(batch.prepareBatchItems).not.toHaveBeenCalled();
  });
  it("does not start a cloud run when preflight rejects the batch", async () => {
    batch.beginBatch.mockResolvedValue(["a", "b"]);
    cloud.preflightCloudBatch.mockRejectedValue(new Error("Quote changed"));
    await disbursementWorkflow(target, { batchPreparation: true });
    expect(cloud.startCloudBatch).not.toHaveBeenCalled();
    expect(cloud.failCloudBatch).toHaveBeenCalledWith(target, "Quote changed");
    expect(cloud.closeCloudBatch).toHaveBeenCalledWith(target);
  });
});

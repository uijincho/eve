import { describe, expect, it } from "vitest";
import { mapConcurrent } from "@/lib/computer-use/concurrent";

describe("bounded document work", () => {
  it("overlaps jobs within the bound and preserves recipient order", async () => {
    let active = 0, peak = 0;
    const output = await mapConcurrent([3, 2, 1, 0], 2, async (n) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, n * 5));
      active--;
      return n * 10;
    });
    expect(output).toEqual([30, 20, 10, 0]);
    expect(peak).toBe(2);
  });
  it("waits for in-flight work after failure and stops scheduling more jobs", async () => {
    const visited: number[] = [];
    let finished = false;
    await expect(mapConcurrent([0, 1, 2, 3], 2, async (n) => {
      visited.push(n);
      if (!n) throw new Error("render failed");
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
    })).rejects.toThrow("render failed");
    // A synchronous throw may stop the second worker before it starts.
    expect(visited.every((n) => n < 2)).toBe(true);
    expect(finished).toBe(visited.includes(1));
  });
});

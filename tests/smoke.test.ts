import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("toolchain", () => {
  it("resolves the @/ alias and merges Tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

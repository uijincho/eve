import type { BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";

import { attachScreenshot } from "@/lib/computer-use/turn";

const ok = (id: string): BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: id, toolset_name: "computer", content: [{ type: "text", text: "OK" }] });
const error = (id: string, text: string): BetaToolResultBlockParam => ({ type: "tool_result", tool_use_id: id, toolset_name: "computer", is_error: true, content: text });

describe("attachScreenshot", () => {
  it("adds the screen to the last result when every action succeeded", () => {
    const results = [ok("a"), ok("b")];
    expect(attachScreenshot(results, "PNG")).toBe(true);
    expect(results[1].content).toEqual([{ type: "text", text: "OK" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "PNG" } }]);
    expect(results[0].content).toEqual([{ type: "text", text: "OK" }]);
  });

  // A guard block is followed by skipped actions, all errors. The API rejects an image inside an
  // error result ("all content must be type `text` if `is_error` is true"), which failed a live run.
  it("never puts an image in an error result", () => {
    const results = [ok("click"), error("type", "Blocked by Eve: that text looks like a taxpayer ID."), error("wait", "Not executed: an earlier computer action in this turn failed."), error("shot", "Not executed: an earlier computer action in this turn failed.")];
    expect(attachScreenshot(results, "PNG")).toBe(true);
    expect(results[0].content).toHaveLength(2);
    for (const r of results.slice(1)) expect(typeof r.content).toBe("string");
  });

  it("leaves the screen out when no action succeeded", () => {
    const results = [error("click", "Blocked by Eve: this is the Review page."), error("shot", "Not executed: an earlier computer action in this turn failed.")];
    expect(attachScreenshot(results, "PNG")).toBe(false);
    expect(results.every((r) => typeof r.content === "string")).toBe(true);
  });

  it("keeps a plain-text result's text when adding the screen", () => {
    const results: BetaToolResultBlockParam[] = [{ type: "tool_result", tool_use_id: "pw", content: "Typed the portal password into the focused field." }];
    attachScreenshot(results, "PNG");
    expect(results[0].content).toEqual([{ type: "text", text: "Typed the portal password into the focused field." }, { type: "image", source: { type: "base64", media_type: "image/png", data: "PNG" } }]);
  });
});

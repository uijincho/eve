import { describe, expect, it } from "vitest";

import { receiptDecimalToMinor, validateReceiptFile } from "@/lib/agent/receipt";

describe("receipt ingestion", () => {
  it("preserves large exact decimal amounts and currency precision", () => {
    expect(receiptDecimalToMinor("900719925474.09", "USD")).toBe("90071992547409");
    expect(receiptDecimalToMinor("679.40", "CAD")).toBe("67940");
    expect(receiptDecimalToMinor("1250", "JPY")).toBe("1250");
    expect(receiptDecimalToMinor("12.345", "KWD")).toBe("12345");
    expect(() => receiptDecimalToMinor("12.345", "USD")).toThrow();
    expect(() => receiptDecimalToMinor("-10", "USD")).toThrow();
    expect(() => receiptDecimalToMinor("1e6", "USD")).toThrow();
    expect(() => receiptDecimalToMinor("10", "XXX")).toThrow();
  });

  it("rejects renamed executable/HTML inputs and oversize uploads before reaching the model", () => {
    expect(() => validateReceiptFile({ bytes: Buffer.from("<html>fake invoice</html>"), mimeType: "application/pdf" })).toThrow("contents");
    expect(() => validateReceiptFile({ bytes: Buffer.from("%PDF-1.7 test document"), mimeType: "text/html" })).toThrow("Upload");
    expect(() => validateReceiptFile({ bytes: new Uint8Array(8 * 1024 * 1024 + 1), mimeType: "image/png" })).toThrow("8 MB");
    expect(() => validateReceiptFile({ bytes: Buffer.from("%PDF-1.7 test document"), mimeType: "application/pdf" })).not.toThrow();
  });
});

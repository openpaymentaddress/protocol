import { describe, expect, it } from "vitest";

import { derivePathKey, deriveRecordUrl, normalizeOpid } from "../src/index";

describe("OPAP/1 URL OPID canonicalisation", () => {
  it.each([
    ["https://CUSTOMER.OPID.PROVIDER/", "https://customer.opid.provider/"],
    [
      "https://b\u00fccher.example/donate",
      "https://xn--bcher-kva.example/donate",
    ],
    ["https://shop.example/product/1223", "https://shop.example/product/1223"],
    ["https://shop.example/a%20b", "https://shop.example/a%20b"],
  ])("canonicalises %s", (input, expected) => {
    expect(normalizeOpid(input)).toBe(expected);
  });

  it.each([
    "http://shop.example/",
    "https://shop.example:443/",
    "https://user@shop.example/",
    "https://shop.example/product?campaign=mail",
    "https://shop.example/product#one",
    "https://shop.example/product/../donate",
    "https://shop.example/product//1223",
    "https://shop.example/product/1223/",
    "https://shop.example/%2fsecret",
    "https://shop.example/%5Csecret",
    "https://shop.example/%7e",
    "https://shop.example/%2e",
    "https://shop.example/a%2fb",
    "https://shop.example/a%zz",
  ])("rejects %s", (input) => {
    expect(() => normalizeOpid(input)).toThrowError(
      expect.objectContaining({ code: "invalid_opid" }),
    );
  });

  it("derives unpadded base64url keys and same-origin record URLs", () => {
    expect(derivePathKey("https://customer.opid.provider/")).toBe("Lw");
    expect(derivePathKey("https://customer.opid.provider/product/1223")).toBe(
      "L3Byb2R1Y3QvMTIyMw",
    );
    expect(deriveRecordUrl("https://customer.opid.provider/product/1223")).toBe(
      "https://customer.opid.provider/.well-known/open-payment/record/L3Byb2R1Y3QvMTIyMw",
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  type OpapError,
  fingerprintRecordBytes,
  validateOpapRecordBytes,
} from "../src/index";
import {
  MAX_JSON_NESTING_DEPTH,
  MAX_RECORD_BYTES,
  parseJsonBytes,
} from "../src/json";

const encoder = new TextEncoder();
const root = "https://merchant.example/";
const direct = {
  version: 1,
  id: root,
  payment: {
    type: "direct",
    methods: [
      {
        type: "sepa",
        currency: "EUR",
        name: "Merchant",
        iban: "NL91ABNA0417164300",
      },
    ],
  },
};

describe("OPAP Record byte and identity validation", () => {
  it("rejects duplicate keys, invalid UTF-8, BOM, oversized, and excessively nested JSON", () => {
    expect(() =>
      parseJsonBytes(encoder.encode('{"id":"first","id":"second"}')),
    ).toThrowError(
      expect.objectContaining<Partial<OpapError>>({
        diagnostic: "duplicate_key:id",
      }),
    );
    expect(() =>
      parseJsonBytes(Uint8Array.from([0x7b, 0xc3, 0x28, 0x7d])),
    ).toThrowError(expect.objectContaining({ diagnostic: "invalid_utf8" }));
    expect(() =>
      parseJsonBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
    ).toThrowError(expect.objectContaining({ diagnostic: "utf8_bom" }));
    expect(
      parseJsonBytes(encoder.encode(`${" ".repeat(MAX_RECORD_BYTES - 1)}0`)),
    ).toBe(0);
    expect(() =>
      parseJsonBytes(encoder.encode(`${" ".repeat(MAX_RECORD_BYTES)}0`)),
    ).toThrowError(
      expect.objectContaining({ diagnostic: "response_too_large" }),
    );
    expect(
      parseJsonBytes(
        encoder.encode(
          `${"[".repeat(MAX_JSON_NESTING_DEPTH)}0${"]".repeat(MAX_JSON_NESTING_DEPTH)}`,
        ),
      ),
    ).toBeDefined();
    expect(() =>
      parseJsonBytes(
        encoder.encode(
          `${"[".repeat(MAX_JSON_NESTING_DEPTH + 1)}0${"]".repeat(MAX_JSON_NESTING_DEPTH + 1)}`,
        ),
      ),
    ).toThrowError(expect.objectContaining({ diagnostic: "nesting_too_deep" }));
  });

  it("binds an exact canonical requested OPID", () => {
    expect(
      validateOpapRecordBytes(encoder.encode(JSON.stringify(direct)), root).id,
    ).toBe(root);
    expect(() =>
      validateOpapRecordBytes(
        encoder.encode(JSON.stringify(direct)),
        "https://other.example/",
      ),
    ).toThrowError(expect.objectContaining({ code: "id_mismatch" }));
    expect(() =>
      validateOpapRecordBytes(
        encoder.encode(
          JSON.stringify({ ...direct, id: "https://MERCHANT.example/" }),
        ),
      ),
    ).toThrowError(
      expect.objectContaining({
        diagnostic: expect.stringContaining("noncanonical_id"),
      }),
    );
  });

  it("accepts direct, delegate, and split semantics while rejecting noncanonical delegation", () => {
    expect(
      validateOpapRecordBytes(encoder.encode(JSON.stringify(direct))).payment
        .type,
    ).toBe("direct");
    expect(
      validateOpapRecordBytes(
        encoder.encode(
          JSON.stringify({
            version: 1,
            id: "https://merchant.example/product/1223",
            payment: { type: "delegate", target: root },
          }),
        ),
      ).payment.type,
    ).toBe("delegate");
    expect(() =>
      validateOpapRecordBytes(
        encoder.encode(
          JSON.stringify({
            version: 1,
            id: "https://merchant.example/product/1223",
            payment: { type: "delegate", target: "https://MERCHANT.example/" },
          }),
        ),
      ),
    ).toThrowError(
      expect.objectContaining({
        diagnostic: expect.stringContaining("noncanonical_delegate_target"),
      }),
    );
  });

  it("uses lowercase SHA-256 of exact response bytes", async () => {
    const compact = encoder.encode('{"a":1}');
    const spaced = encoder.encode('{"a": 1}');
    await expect(fingerprintRecordBytes(compact)).resolves.toMatch(
      /^[0-9a-f]{64}$/,
    );
    await expect(fingerprintRecordBytes(compact)).resolves.not.toBe(
      await fingerprintRecordBytes(spaced),
    );
  });
});

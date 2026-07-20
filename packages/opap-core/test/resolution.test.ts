import { describe, expect, it } from "vitest";

import {
  MAX_DELEGATE_HOPS,
  advanceResolution,
  createResolutionState,
  type OpapRecord,
  type ResolutionEvidence,
} from "../src/index";

const method = {
  type: "sepa" as const,
  currency: "EUR" as const,
  name: "Merchant",
  iban: "NL91ABNA0417164300",
};
const evidence = (record: OpapRecord, marker = "a"): ResolutionEvidence => ({
  record,
  fingerprint: marker.repeat(64),
  verification: "dnssec-bound",
});
const direct = (id: string): OpapRecord => ({
  version: 1,
  id,
  payment: { type: "direct", methods: [method] },
});
const delegate = (id: string, target: string): OpapRecord => ({
  version: 1,
  id,
  payment: { type: "delegate", target },
});

describe("bounded URL-OPID resolution", () => {
  it("follows a product delegation and reports immutable URL identities", () => {
    const product = "https://customer.opid.provider/product/1223";
    const merchant = "https://customer.opid.provider/";
    const pending = advanceResolution(
      createResolutionState(product),
      evidence(delegate(product, merchant)),
    );
    expect(pending.status).toBe("pending");
    if (pending.status !== "pending") throw new Error("expected_pending");
    const resolved = advanceResolution(
      pending,
      evidence(direct(merchant), "b"),
    );
    expect(resolved).toMatchObject({
      status: "resolved",
      paymentType: "direct",
      source: product,
      resolvedTo: merchant,
      methods: [method],
    });
  });

  it("rejects exact-id mismatch, loops, and the ninth delegation", () => {
    const first = "https://a.example/";
    expect(() =>
      advanceResolution(
        createResolutionState(first),
        evidence(direct("https://b.example/")),
      ),
    ).toThrowError(expect.objectContaining({ code: "id_mismatch" }));
    const loop = advanceResolution(
      createResolutionState(first),
      evidence(delegate(first, "https://b.example/")),
    );
    if (loop.status !== "pending") throw new Error("expected_pending");
    expect(() =>
      advanceResolution(loop, evidence(delegate("https://b.example/", first))),
    ).toThrowError(expect.objectContaining({ code: "resolution_loop" }));
    let chain = createResolutionState("https://hop0.example/");
    for (let index = 0; index < MAX_DELEGATE_HOPS; index += 1) {
      const step = advanceResolution(
        chain,
        evidence(
          delegate(
            `https://hop${index}.example/`,
            `https://hop${index + 1}.example/`,
          ),
        ),
      );
      if (step.status !== "pending") throw new Error("expected_pending");
      chain = step;
    }
    expect(() =>
      advanceResolution(
        chain,
        evidence(delegate("https://hop8.example/", "https://hop9.example/")),
      ),
    ).toThrowError(expect.objectContaining({ code: "resolution_limit" }));
  });
});

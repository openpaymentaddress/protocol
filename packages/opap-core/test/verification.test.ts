import { describe, expect, it } from "vitest";

import { transitionVerificationLevel } from "../src/index";

describe("OPAP/1 §3.5 verification-history transitions", () => {
  it("stores the highest level observed", () => {
    expect(transitionVerificationLevel(undefined, "https-only")).toBe(
      "https-only",
    );
    expect(transitionVerificationLevel("https-only", "dnssec-bound")).toBe(
      "dnssec-bound",
    );
    expect(transitionVerificationLevel("dnssec-bound", "dnssec-bound")).toBe(
      "dnssec-bound",
    );
  });

  it("blocks a downgrade from DNSSEC-bound to HTTPS-only", () => {
    expect(() =>
      transitionVerificationLevel("dnssec-bound", "https-only"),
    ).toThrowError(expect.objectContaining({ code: "verification_downgrade" }));
  });
});

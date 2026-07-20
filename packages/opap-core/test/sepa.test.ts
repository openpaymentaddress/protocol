import { describe, expect, it } from "vitest";

import { buildSepaHandoff, type SepaExecutionPlan } from "../src/index";

const plan: SepaExecutionPlan = {
  type: "sepa",
  source: "https://example.com/",
  resolvedTo: "https://example.com/",
  intent: {
    amount: "12.3",
    currency: "EUR",
    description: "Factuur 42",
  },
  method: {
    type: "sepa",
    currency: "EUR",
    name: "Example Recipient",
    iban: "NL91ABNA0417164300",
  },
  records: [],
};

describe("SEPA handoff", () => {
  it("builds integer-safe payto and EPC QR instructions", () => {
    const handoff = buildSepaHandoff(plan);
    expect(handoff).toMatchObject({
      amount: "12.30",
      currency: "EUR",
      settlementStatus: "handoff-only",
    });
    expect(handoff.paytoUri).toContain("payto://iban/NL91ABNA0417164300");
    expect(handoff.paytoUri).toContain("amount=EUR%3A12.30");
    expect(handoff.epcQrPayload.split("\n")).toEqual([
      "BCD",
      "002",
      "1",
      "SCT",
      "",
      "Example Recipient",
      "NL91ABNA0417164300",
      "EUR12.30",
      "",
      "",
      "Factuur 42",
      "",
    ]);
  });

  it("rejects multiline and oversized remittance data", () => {
    expect(() =>
      buildSepaHandoff({
        ...plan,
        intent: { ...plan.intent, description: "unsafe\nline" },
      }),
    ).toThrow(/invalid_sepa_remittance/);
    expect(() =>
      buildSepaHandoff({
        ...plan,
        intent: { ...plan.intent, description: "x".repeat(141) },
      }),
    ).toThrow(/sepa_remittance_too_long/);
  });
});

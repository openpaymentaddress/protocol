import { describe, expect, it } from "vitest";

import {
  assertExecutionPlanUnchanged,
  buildDirectExecutionPlan,
  type DirectResolution,
} from "../src/index";

const source = "https://merchant.example/product/1223";
const terminal = "https://merchant.example/";
const resolution: DirectResolution = {
  status: "resolved",
  paymentType: "direct",
  source,
  resolvedTo: terminal,
  methods: [
    {
      type: "sepa",
      currency: "EUR",
      name: "Merchant",
      iban: "NL91ABNA0417164300",
    },
  ],
  records: [
    { id: source, fingerprint: "a".repeat(64), verification: "dnssec-bound" },
    { id: terminal, fingerprint: "b".repeat(64), verification: "dnssec-bound" },
  ],
};

describe("execution revalidation", () => {
  it("retains the recipient-affecting URL record chain and rejects changes", () => {
    const plan = buildDirectExecutionPlan(resolution, 0, {
      amount: "12.34",
      currency: "EUR",
    });
    expect(plan).toMatchObject({ source, resolvedTo: terminal, type: "sepa" });
    expect(() => assertExecutionPlanUnchanged(plan, resolution)).not.toThrow();
    expect(() =>
      assertExecutionPlanUnchanged(plan, {
        ...resolution,
        records: [
          { ...resolution.records[0]!, fingerprint: "c".repeat(64) },
          resolution.records[1]!,
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "execution_changed" }));
    expect(() =>
      assertExecutionPlanUnchanged(plan, {
        ...resolution,
        methods: [
          {
            type: "sepa",
            currency: "EUR",
            name: "Merchant",
            iban: "NL02ABNA0123456700",
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "execution_changed" }));
  });
});

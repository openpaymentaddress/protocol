import { describe, expect, it } from "vitest";

import {
  allocateSplitAmount,
  buildSplitExecutionPlan,
  deriveSplitConfigId,
  type AssetRegistry,
  type SplitResolution,
} from "../src/index";

const executionBase = {
  type: "erc20-contract" as const,
  currency: "EUR",
  adapter: "org.openpayments/split-v1",
  chain: "eip155:10200",
  asset: "0x7a47605930002cc2cd2c3c408d1f33fc2a18ab71",
  contract: "0x3333333333333333333333333333333333333333",
};
const recipients = [
  {
    recipient: "0x4444444444444444444444444444444444444444",
    share_ppm: 600_000,
  },
  {
    recipient: "0x5555555555555555555555555555555555555555",
    share_ppm: 400_000,
  },
] as const;
const configId = deriveSplitConfigId(executionBase, recipients);
const registry: AssetRegistry = {
  version: "2026-07-19.1",
  assets: [
    {
      chain: executionBase.chain,
      asset: executionBase.asset,
      name: "Monerium Test EURe",
      symbol: "EURe",
      decimals: 18,
      currency: "EUR",
      transferProfile: "erc20-standard",
      status: "active",
      environment: "test",
      provenance: "https://api.monerium.dev/tokens",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
  ],
};

describe("OPAP split planning", () => {
  it("derives deterministic, order-sensitive config IDs", () => {
    expect(deriveSplitConfigId(executionBase, recipients)).toBe(configId);
    expect(
      deriveSplitConfigId(executionBase, [...recipients].reverse()),
    ).not.toBe(configId);
    expect(
      deriveSplitConfigId(executionBase, [
        { ...recipients[0], share_ppm: 599_999 },
        { ...recipients[1], share_ppm: 400_001 },
      ]),
    ).not.toBe(configId);
  });

  it("puts every deterministic rounding remainder on the final recipient", () => {
    expect(allocateSplitAmount(101n, recipients)).toEqual([
      {
        recipient: recipients[0].recipient,
        sharePpm: 600_000,
        atomicAmount: "60",
      },
      {
        recipient: recipients[1].recipient,
        sharePpm: 400_000,
        atomicAmount: "41",
      },
    ]);
  });

  it("rejects every zero-output allocation", () => {
    expect(() => allocateSplitAmount(1n, recipients)).toThrowError(
      expect.objectContaining({ code: "amount_not_splittable" }),
    );
  });

  it("builds an immutable split plan and verifies the exact state", () => {
    const resolution: SplitResolution = {
      status: "resolved",
      paymentType: "split",
      source: "https://example.com/",
      resolvedTo: "https://example.com/",
      name: "Example split",
      execution: { ...executionBase, config_id: configId },
      recipients,
      records: [
        {
          id: "https://example.com/",
          fingerprint: "b".repeat(64),
          verification: "dnssec-bound",
        },
      ],
    };
    const plan = buildSplitExecutionPlan(
      resolution,
      { amount: "1.000000000000000001", currency: "EUR" },
      registry,
      {
        chain: executionBase.chain,
        contract: executionBase.contract,
        token: executionBase.asset,
        configId,
        recipients: recipients.map((recipient) => recipient.recipient),
        sharesPpm: recipients.map((recipient) => recipient.share_ppm),
        immutable: true,
        codeFingerprint: `sha256:${"c".repeat(64)}`,
      },
    );
    expect(plan.atomicAmount).toBe("1000000000000000001");
    expect(plan.allocations.at(-1)?.atomicAmount).toBe("400000000000000001");
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.allocations)).toBe(true);
  });
});

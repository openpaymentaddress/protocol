import { describe, expect, it } from "vitest";

import { resolveAssetProfile, validateAssetRegistry } from "../src/index";

const entry = {
  chain: "eip155:10200",
  asset: "0x7a47605930002cc2cd2c3c408d1f33fc2a18ab71",
  name: "Monerium Test EURe",
  symbol: "EURe",
  decimals: 18,
  currency: "EUR",
  transferProfile: "erc20-standard",
  status: "active",
  environment: "test",
  provenance: "https://api.monerium.dev/tokens",
  fingerprint: `sha256:${"a".repeat(64)}`,
} as const;

const registry = { version: "2026-07-19.1", assets: [entry] } as const;

describe("OPAP/1 §5.3 release-pinned asset registry", () => {
  it("matches exact chain and case-insensitive address bytes", () => {
    const profile = resolveAssetProfile(
      registry,
      {
        chain: entry.chain,
        asset: entry.asset.toUpperCase().replace("0X", "0x"),
        currency: "EUR",
      },
      "eur",
    );

    expect(profile).toMatchObject({
      symbol: "EURe",
      entryFingerprint: entry.fingerprint,
      registryVersion: registry.version,
      environment: "test",
    });
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it("rejects unknown, blocked, duplicate and denomination-conflicting entries", () => {
    expect(() =>
      resolveAssetProfile(
        registry,
        { chain: "eip155:100", asset: entry.asset, currency: "EUR" },
        "EUR",
      ),
    ).toThrowError(expect.objectContaining({ code: "unrecognized_asset" }));
    expect(() =>
      resolveAssetProfile(
        { ...registry, assets: [{ ...entry, status: "blocked" as const }] },
        entry,
        "EUR",
      ),
    ).toThrowError(expect.objectContaining({ code: "unrecognized_asset" }));
    expect(() => resolveAssetProfile(registry, entry, "USD")).toThrowError(
      expect.objectContaining({ code: "asset_currency_mismatch" }),
    );
    expect(() =>
      validateAssetRegistry({ ...registry, assets: [entry, entry] }),
    ).toThrow(/duplicate_registry_asset/);
  });
});

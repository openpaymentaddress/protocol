import { OpapError } from "./errors";
import type { Erc20PaymentHandler } from "./types";

export interface AssetRegistryEntry {
  readonly chain: string;
  readonly asset: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly currency: string | null;
  readonly transferProfile: "erc20-standard" | "erc20-no-return";
  readonly status: "active" | "blocked";
  readonly environment: "local" | "test" | "production";
  readonly provenance: string;
  readonly fingerprint: `sha256:${string}`;
}

export interface AssetRegistry {
  readonly version: string;
  readonly assets: readonly AssetRegistryEntry[];
}

export interface AssetProfile {
  readonly registryVersion: string;
  readonly entryFingerprint: `sha256:${string}`;
  readonly name: string;
  readonly symbol: string;
  readonly currency: string | null;
  readonly decimals: number;
  readonly transferProfile: AssetRegistryEntry["transferProfile"];
  readonly environment: AssetRegistryEntry["environment"];
}

function isFingerprint(value: string): value is `sha256:${string}` {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

export function validateAssetRegistry(registry: AssetRegistry): void {
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(registry.version)) {
    throw new TypeError("invalid_registry_version");
  }
  const identities = new Set<string>();
  for (const entry of registry.assets) {
    const identity = `${entry.chain}:${entry.asset.toLowerCase()}`;
    if (identities.has(identity)) {
      throw new TypeError(`duplicate_registry_asset:${identity}`);
    }
    identities.add(identity);
    if (!/^eip155:[1-9][0-9]*$/.test(entry.chain)) {
      throw new TypeError(`invalid_registry_chain:${entry.chain}`);
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(entry.asset)) {
      throw new TypeError(`invalid_registry_address:${entry.asset}`);
    }
    if (
      !Number.isInteger(entry.decimals) ||
      entry.decimals < 0 ||
      entry.decimals > 255
    ) {
      throw new TypeError(`invalid_registry_decimals:${entry.decimals}`);
    }
    if (!isFingerprint(entry.fingerprint)) {
      throw new TypeError(`invalid_registry_fingerprint:${entry.fingerprint}`);
    }
  }
}

export function resolveAssetProfile(
  registry: AssetRegistry,
  method: Pick<Erc20PaymentHandler, "chain" | "asset" | "currency">,
  requestedCurrency: string,
): AssetProfile {
  validateAssetRegistry(registry);
  const entry = registry.assets.find(
    (candidate) =>
      candidate.chain === method.chain &&
      candidate.asset.toLowerCase() === method.asset.toLowerCase(),
  );

  if (entry === undefined || entry.status !== "active") {
    throw new OpapError("unrecognized_asset");
  }
  if (
    entry.currency !== null &&
    entry.currency.toUpperCase() !== method.currency.toUpperCase()
  ) {
    throw new OpapError(
      "asset_currency_mismatch",
      `expected:${entry.currency};actual:${method.currency}`,
    );
  }
  if (method.currency.toUpperCase() !== requestedCurrency.toUpperCase()) {
    throw new OpapError(
      "asset_currency_mismatch",
      `expected:${method.currency};actual:${requestedCurrency}`,
    );
  }

  return Object.freeze({
    registryVersion: registry.version,
    entryFingerprint: entry.fingerprint,
    name: entry.name,
    symbol: entry.symbol,
    currency: entry.currency,
    decimals: entry.decimals,
    transferProfile: entry.transferProfile,
    environment: entry.environment,
  });
}

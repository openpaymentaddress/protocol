import { keccak_256 } from "@noble/hashes/sha3.js";

import { OpapError } from "./errors";
import type { SplitExecution, SplitRecipient } from "./types";

export const OPAP_SPLIT_ADAPTER = "org.openpayments/split-v1";
export const MAX_SUPPORTED_SPLIT_RECIPIENTS = 16;

export interface SplitAllocation {
  readonly recipient: string;
  readonly sharePpm: number;
  readonly atomicAmount: string;
  readonly target?: string;
}

export interface SplitContractState {
  readonly chain: string;
  readonly contract: string;
  readonly token: string;
  readonly configId: string;
  readonly recipients: readonly string[];
  readonly sharesPpm: readonly number[];
  readonly immutable: true;
  readonly codeFingerprint: `sha256:${string}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function unsignedBytes(value: bigint, length: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(length * 8)) {
    throw new RangeError("integer_out_of_range");
  }
  const result = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

function addressBytes(address: string): Uint8Array {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new TypeError(`invalid_evm_address:${address}`);
  }
  return Uint8Array.from(
    address
      .slice(2)
      .match(/.{2}/g)
      ?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

function chainNumber(chain: string): bigint {
  const match = /^eip155:([1-9][0-9]*)$/.exec(chain);
  if (match?.[1] === undefined) {
    throw new TypeError(`invalid_chain:${chain}`);
  }
  return BigInt(match[1]);
}

export function deriveSplitConfigId(
  execution: Pick<SplitExecution, "chain" | "contract" | "asset">,
  recipients: readonly Pick<SplitRecipient, "recipient" | "share_ppm">[],
): `0x${string}` {
  if (
    recipients.length < 2 ||
    recipients.length > MAX_SUPPORTED_SPLIT_RECIPIENTS
  ) {
    throw new OpapError("unsupported_split_adapter", "recipient_count");
  }
  const domain = keccak_256(new TextEncoder().encode("OPAP_SPLIT_CONFIG_V1"));
  const recipientsHash = keccak_256(
    concatBytes(
      recipients.map((recipient) => addressBytes(recipient.recipient)),
    ),
  );
  const sharesHash = keccak_256(
    concatBytes(
      recipients.map((recipient) =>
        unsignedBytes(BigInt(recipient.share_ppm), 4),
      ),
    ),
  );
  const digest = keccak_256(
    concatBytes([
      domain,
      unsignedBytes(chainNumber(execution.chain), 32),
      addressBytes(execution.contract),
      addressBytes(execution.asset),
      recipientsHash,
      sharesHash,
    ]),
  );
  return `0x${bytesToHex(digest)}`;
}

export function allocateSplitAmount(
  totalAtomicAmount: bigint,
  recipients: readonly SplitRecipient[],
): readonly SplitAllocation[] {
  if (totalAtomicAmount <= 0n) {
    throw new OpapError("amount_not_splittable", "non_positive_amount");
  }
  let allocated = 0n;
  const allocations = recipients.map((recipient, index) => {
    const amount =
      index === recipients.length - 1
        ? totalAtomicAmount - allocated
        : (totalAtomicAmount * BigInt(recipient.share_ppm)) / 1_000_000n;
    if (amount === 0n) {
      throw new OpapError("amount_not_splittable", `recipient_index:${index}`);
    }
    allocated += amount;
    return Object.freeze({
      recipient: recipient.recipient,
      sharePpm: recipient.share_ppm,
      atomicAmount: amount.toString(),
      ...(recipient.target === undefined ? {} : { target: recipient.target }),
    });
  });
  return Object.freeze(allocations);
}

export function verifySplitContractState(
  execution: SplitExecution,
  recipients: readonly SplitRecipient[],
  state: SplitContractState,
): void {
  const matches =
    state.immutable === true &&
    state.chain === execution.chain &&
    state.contract.toLowerCase() === execution.contract.toLowerCase() &&
    state.token.toLowerCase() === execution.asset.toLowerCase() &&
    state.configId.toLowerCase() === execution.config_id.toLowerCase() &&
    state.recipients.length === recipients.length &&
    state.sharesPpm.length === recipients.length &&
    state.recipients.every(
      (recipient, index) =>
        recipient.toLowerCase() === recipients[index]?.recipient.toLowerCase(),
    ) &&
    state.sharesPpm.every(
      (share, index) => share === recipients[index]?.share_ppm,
    ) &&
    deriveSplitConfigId(execution, recipients).toLowerCase() ===
      execution.config_id.toLowerCase();
  if (!matches) {
    throw new OpapError("split_state_mismatch");
  }
}

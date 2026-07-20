import {
  OPAP_SPLIT_ADAPTER,
  OpapError,
  fingerprintRecordBytes,
  verifySplitContractState,
  type SplitContractState,
  type SplitResolution,
} from "@opap/core";

export interface SplitAdapterPolicy {
  readonly adapter: typeof OPAP_SPLIT_ADAPTER;
  readonly chain: string;
  readonly contract: string;
  readonly codeFingerprint: `sha256:${string}`;
  readonly status: "active" | "blocked";
}

export interface SplitConfigRead {
  readonly code: Uint8Array;
  readonly token: string;
  readonly recipients: readonly string[];
  readonly sharesPpm: readonly number[];
  readonly tokenAllowed: boolean;
}

export interface SplitConfigReader {
  readConfig(
    chain: string,
    contract: string,
    configId: string,
    signal?: AbortSignal,
  ): Promise<SplitConfigRead>;
}

export async function verifySupportedSplitAdapter(
  resolution: SplitResolution,
  policy: SplitAdapterPolicy,
  reader: SplitConfigReader,
  signal?: AbortSignal,
): Promise<SplitContractState> {
  const execution = resolution.execution;
  if (
    execution.adapter !== OPAP_SPLIT_ADAPTER ||
    policy.status !== "active" ||
    policy.adapter !== execution.adapter ||
    policy.chain !== execution.chain ||
    policy.contract.toLowerCase() !== execution.contract.toLowerCase()
  ) {
    throw new OpapError("unsupported_split_adapter", execution.adapter);
  }
  const read = await reader.readConfig(
    execution.chain,
    execution.contract,
    execution.config_id,
    signal,
  );
  const codeFingerprint =
    `sha256:${await fingerprintRecordBytes(read.code)}` as const;
  if (
    !read.tokenAllowed ||
    codeFingerprint !== policy.codeFingerprint.toLowerCase()
  ) {
    throw new OpapError("split_state_mismatch", "contract_identity");
  }
  const state = Object.freeze({
    chain: execution.chain,
    contract: execution.contract,
    token: read.token,
    configId: execution.config_id,
    recipients: Object.freeze([...read.recipients]),
    sharesPpm: Object.freeze([...read.sharesPpm]),
    immutable: true as const,
    codeFingerprint,
  });
  verifySplitContractState(execution, resolution.recipients, state);
  return state;
}

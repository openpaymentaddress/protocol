import { decimalAmountToAtomicUnits } from "./amount";
import {
  resolveAssetProfile,
  type AssetProfile,
  type AssetRegistry,
} from "./assets";
import { OpapError } from "./errors";
import { formatSha256Fingerprint } from "./fingerprint";
import type {
  DirectResolution,
  SplitResolution,
  SupportedPaymentHandler,
  TerminalResolution,
} from "./resolution";
import {
  OPAP_SPLIT_ADAPTER,
  allocateSplitAmount,
  verifySplitContractState,
  type SplitAllocation,
  type SplitContractState,
} from "./split";
import type {
  Erc20PaymentHandler,
  SepaPaymentHandler,
  SplitExecution,
} from "./types";
import type { VerificationLevel } from "./verification";

export interface PaymentIntent {
  readonly amount: string;
  readonly currency: string;
  readonly description?: string;
  readonly expiresAt?: string;
}

interface ExecutionPlanBase {
  readonly source: string;
  readonly resolvedTo: string;
  readonly name?: string;
  readonly intent: PaymentIntent;
  readonly records: readonly ExecutionPlanRecord[];
}

export interface ExecutionPlanRecord {
  readonly id: string;
  readonly fingerprint: `sha256:${string}`;
  readonly verification: VerificationLevel;
}

export interface SepaExecutionPlan extends ExecutionPlanBase {
  readonly type: "sepa";
  readonly method: SepaPaymentHandler;
}

export interface Erc20ExecutionPlan extends ExecutionPlanBase {
  readonly type: "erc20";
  readonly method: Erc20PaymentHandler;
  readonly atomicAmount: string;
  readonly assetProfile: AssetProfile;
}

export interface SplitExecutionPlan extends ExecutionPlanBase {
  readonly type: "split";
  readonly execution: SplitExecution;
  readonly atomicAmount: string;
  readonly assetProfile: AssetProfile;
  readonly allocations: readonly SplitAllocation[];
  readonly contractState?: SplitContractState;
}

export type DirectExecutionPlan = SepaExecutionPlan | Erc20ExecutionPlan;
export type ExecutionPlan = DirectExecutionPlan | SplitExecutionPlan;

function freezeIntent(intent: PaymentIntent): PaymentIntent {
  return Object.freeze({
    amount: intent.amount,
    currency: intent.currency.toUpperCase(),
    ...(intent.description === undefined
      ? {}
      : { description: intent.description }),
    ...(intent.expiresAt === undefined ? {} : { expiresAt: intent.expiresAt }),
  });
}

function freezeRecords(
  records: TerminalResolution["records"],
): readonly ExecutionPlanRecord[] {
  return Object.freeze(
    records.map((record) =>
      Object.freeze({
        ...record,
        fingerprint: formatSha256Fingerprint(record.fingerprint),
      }),
    ),
  );
}

function selectedMethod(
  resolution: DirectResolution,
  methodIndex: number,
): SupportedPaymentHandler {
  if (!Number.isInteger(methodIndex)) {
    throw new OpapError("no_supported_method", `index:${methodIndex}`);
  }
  const method = resolution.methods[methodIndex];
  if (method === undefined) {
    throw new OpapError("no_supported_method", `index:${methodIndex}`);
  }
  return method;
}

export function buildDirectExecutionPlan(
  resolution: DirectResolution,
  methodIndex: number,
  paymentIntent: PaymentIntent,
  registry?: AssetRegistry,
): DirectExecutionPlan {
  const method = selectedMethod(resolution, methodIndex);
  const intent = freezeIntent(paymentIntent);
  const records = freezeRecords(resolution.records);
  const base = {
    source: resolution.source,
    resolvedTo: resolution.resolvedTo,
    ...(resolution.name === undefined ? {} : { name: resolution.name }),
    intent,
    records,
  };

  if (method.type === "sepa") {
    if (intent.currency !== method.currency) {
      throw new OpapError("no_supported_method", "currency");
    }
    decimalAmountToAtomicUnits(intent.amount, 2);
    return Object.freeze({
      ...base,
      type: "sepa",
      method: Object.freeze({ ...method }),
    });
  }

  if (registry === undefined) {
    throw new OpapError("unrecognized_asset", "registry_required");
  }
  const assetProfile = resolveAssetProfile(registry, method, intent.currency);
  const atomicAmount = decimalAmountToAtomicUnits(
    intent.amount,
    assetProfile.decimals,
  ).toString();
  return Object.freeze({
    ...base,
    type: "erc20",
    method: Object.freeze({ ...method }),
    atomicAmount,
    assetProfile,
  });
}

export function buildSplitExecutionPlan(
  resolution: SplitResolution,
  paymentIntent: PaymentIntent,
  registry: AssetRegistry,
  contractState?: SplitContractState,
): SplitExecutionPlan {
  if (resolution.execution.adapter !== OPAP_SPLIT_ADAPTER) {
    throw new OpapError(
      "unsupported_split_adapter",
      resolution.execution.adapter,
    );
  }
  const intent = freezeIntent(paymentIntent);
  const assetProfile = resolveAssetProfile(
    registry,
    resolution.execution,
    intent.currency,
  );
  const atomicAmount = decimalAmountToAtomicUnits(
    intent.amount,
    assetProfile.decimals,
  );
  if (contractState !== undefined) {
    verifySplitContractState(
      resolution.execution,
      resolution.recipients,
      contractState,
    );
  }
  return Object.freeze({
    type: "split",
    source: resolution.source,
    resolvedTo: resolution.resolvedTo,
    ...(resolution.name === undefined ? {} : { name: resolution.name }),
    intent,
    records: freezeRecords(resolution.records),
    execution: Object.freeze({ ...resolution.execution }),
    atomicAmount: atomicAmount.toString(),
    assetProfile,
    allocations: allocateSplitAmount(atomicAmount, resolution.recipients),
    ...(contractState === undefined
      ? {}
      : { contractState: Object.freeze({ ...contractState }) }),
  });
}

function normalizedPlanRecord(record: ExecutionPlanRecord): string {
  return `${record.id}|${record.fingerprint}|${record.verification}`;
}

export function assertExecutionPlanUnchanged(
  plan: ExecutionPlan,
  resolution: TerminalResolution,
): void {
  const recordsMatch =
    plan.records.length === resolution.records.length &&
    plan.records.every(
      (record, index) =>
        normalizedPlanRecord(record) ===
        normalizedPlanRecord({
          ...resolution.records[index]!,
          fingerprint: formatSha256Fingerprint(
            resolution.records[index]!.fingerprint,
          ),
        }),
    );
  const terminalMatch =
    plan.source === resolution.source &&
    plan.resolvedTo === resolution.resolvedTo;
  let paymentMatch = false;
  if (plan.type === "split" && resolution.paymentType === "split") {
    paymentMatch =
      JSON.stringify(plan.execution) === JSON.stringify(resolution.execution) &&
      plan.allocations.length === resolution.recipients.length &&
      plan.allocations.every(
        (allocation, index) =>
          allocation.recipient.toLowerCase() ===
            resolution.recipients[index]?.recipient.toLowerCase() &&
          allocation.sharePpm === resolution.recipients[index]?.share_ppm,
      );
  } else if (plan.type !== "split" && resolution.paymentType === "direct") {
    paymentMatch = resolution.methods.some(
      (method) => JSON.stringify(method) === JSON.stringify(plan.method),
    );
  }
  if (!recordsMatch || !terminalMatch || !paymentMatch) {
    throw new OpapError("execution_changed");
  }
}

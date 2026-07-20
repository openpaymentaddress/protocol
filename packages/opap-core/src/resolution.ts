import { OpapError } from "./errors";
import { isSha256Hex } from "./fingerprint";
import { normalizeOpid } from "./opid";
import type {
  Erc20PaymentHandler,
  OpapRecord,
  PaymentHandler,
  SepaPaymentHandler,
  SplitExecution,
  SplitRecipient,
} from "./types";
import type { VerificationLevel } from "./verification";

export const MAX_DELEGATE_HOPS = 8;
export const MAX_RESOLUTION_RECORDS = 32;

export type SupportedPaymentHandler = SepaPaymentHandler | Erc20PaymentHandler;

export interface ResolutionRecord {
  readonly id: string;
  readonly fingerprint: string;
  readonly verification: VerificationLevel;
}

export interface ResolutionEvidence {
  readonly record: OpapRecord;
  readonly fingerprint: string;
  readonly verification: VerificationLevel;
}

export interface PendingResolution {
  readonly status: "pending";
  readonly source: string;
  readonly nextOpid: string;
  readonly delegateHops: number;
  readonly visited: readonly string[];
  readonly records: readonly ResolutionRecord[];
}

export interface DirectResolution {
  readonly status: "resolved";
  readonly paymentType: "direct";
  readonly source: string;
  readonly resolvedTo: string;
  readonly name?: string;
  readonly methods: readonly SupportedPaymentHandler[];
  readonly records: readonly ResolutionRecord[];
}

export interface SplitResolution {
  readonly status: "resolved";
  readonly paymentType: "split";
  readonly source: string;
  readonly resolvedTo: string;
  readonly name?: string;
  readonly execution: SplitExecution;
  readonly recipients: readonly SplitRecipient[];
  readonly records: readonly ResolutionRecord[];
}

export type TerminalResolution = DirectResolution | SplitResolution;
export type ResolutionStep = PendingResolution | TerminalResolution;

function freezeResolutionRecord(
  evidence: ResolutionEvidence,
): ResolutionRecord {
  return Object.freeze({
    id: evidence.record.id,
    fingerprint: evidence.fingerprint,
    verification: evidence.verification,
  });
}

function isSupportedPaymentHandler(
  method: PaymentHandler,
): method is SupportedPaymentHandler {
  return (
    typeof method === "object" &&
    method !== null &&
    "type" in method &&
    (method.type === "sepa" || method.type === "erc20")
  );
}

function freezePaymentHandler(
  method: SupportedPaymentHandler,
): SupportedPaymentHandler {
  return Object.freeze({ ...method });
}

export function createResolutionState(input: string): PendingResolution {
  const source = normalizeOpid(input);
  return Object.freeze({
    status: "pending",
    source,
    nextOpid: source,
    delegateHops: 0,
    visited: Object.freeze([]),
    records: Object.freeze([]),
  });
}

export function advanceResolution(
  state: PendingResolution,
  evidence: ResolutionEvidence,
): ResolutionStep {
  if (evidence.record.id !== state.nextOpid) {
    throw new OpapError(
      "id_mismatch",
      `expected:${state.nextOpid};actual:${evidence.record.id}`,
    );
  }
  if (!isSha256Hex(evidence.fingerprint)) {
    throw new OpapError("invalid_record", "invalid_fingerprint");
  }
  if (state.visited.includes(state.nextOpid)) {
    throw new OpapError("resolution_loop", `id:${state.nextOpid}`);
  }
  if (state.records.length >= MAX_RESOLUTION_RECORDS) {
    throw new OpapError("resolution_limit", "records");
  }

  const visited = Object.freeze([...state.visited, state.nextOpid]);
  const records = Object.freeze([
    ...state.records,
    freezeResolutionRecord(evidence),
  ]);

  if (evidence.record.payment.type === "delegate") {
    if (state.delegateHops >= MAX_DELEGATE_HOPS) {
      throw new OpapError("resolution_limit", "delegate_hops");
    }
    const target = evidence.record.payment.target;
    if (visited.includes(target)) {
      throw new OpapError("resolution_loop", `id:${target}`);
    }
    return Object.freeze({
      status: "pending",
      source: state.source,
      nextOpid: target,
      delegateHops: state.delegateHops + 1,
      visited,
      records,
    });
  }

  if (evidence.record.payment.type === "split") {
    return Object.freeze({
      status: "resolved",
      paymentType: "split",
      source: state.source,
      resolvedTo: evidence.record.id,
      ...(evidence.record.name === undefined
        ? {}
        : { name: evidence.record.name }),
      execution: Object.freeze({ ...evidence.record.payment.execution }),
      recipients: Object.freeze(
        evidence.record.payment.recipients.map((recipient) =>
          Object.freeze({ ...recipient }),
        ),
      ),
      records,
    });
  }

  const methods = Object.freeze(
    evidence.record.payment.methods
      .filter(isSupportedPaymentHandler)
      .map(freezePaymentHandler),
  );
  if (methods.length === 0) {
    throw new OpapError("no_supported_method");
  }

  return Object.freeze({
    status: "resolved",
    paymentType: "direct",
    source: state.source,
    resolvedTo: evidence.record.id,
    ...(evidence.record.name === undefined
      ? {}
      : { name: evidence.record.name }),
    methods,
    records,
  });
}

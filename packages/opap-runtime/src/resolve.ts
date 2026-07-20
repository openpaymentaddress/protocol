import {
  OpapError,
  assertExecutionPlanUnchanged,
  advanceResolution,
  createResolutionState,
  fingerprintRecordBytes,
  selectTrustRecord,
  transitionVerificationLevel,
  validateOpapRecordBytes,
  verifyRecordProof,
  type TerminalResolution,
  type ExecutionPlan,
  type TrustRecordMatch,
  type VerificationLevel,
} from "@opap/core";

import { discoverOpid } from "./discovery";
import type { DnsTxtResolver } from "./dns";
import {
  EMPTY_VERIFICATION_HISTORY_STORE,
  type VerificationHistory,
  type VerificationHistoryStore,
} from "./history";
import { fetchOpapRecord, type FetchAdapter } from "./https";
import { createTimeoutSignal } from "./timeout";

export const DEFAULT_RESOLUTION_TIMEOUT_MS = 30_000;

export interface PublicationOptions {
  readonly dns: DnsTxtResolver;
  readonly fetch?: FetchAdapter;
  readonly httpsTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ResolutionOptions extends PublicationOptions {
  readonly history?: VerificationHistoryStore;
  readonly resolutionTimeoutMs?: number;
}

export interface PublicationCheck {
  readonly opid: string;
  readonly url: string;
  readonly trustName: string;
  readonly fingerprint: string;
  readonly verification: VerificationLevel;
  readonly trustMatch?: TrustRecordMatch;
  readonly trustTtl?: number;
  readonly record: ReturnType<typeof validateOpapRecordBytes>;
  readonly headers: Readonly<Record<string, string>>;
}

async function verificationFor(
  opid: string,
  bytes: Uint8Array,
  headers: Readonly<Record<string, string>>,
  options: PublicationOptions,
): Promise<{
  readonly verification: VerificationLevel;
  readonly trustMatch?: TrustRecordMatch;
  readonly trustTtl?: number;
}> {
  const discovery = discoverOpid(opid);
  const dns = await options.dns.resolveTxt(discovery.trustName, options.signal);
  if (dns.status === "bogus") {
    throw new OpapError("dnssec_bogus", `name:${discovery.trustName}`);
  }
  if (dns.status === "insecure") {
    return { verification: "https-only" };
  }

  const trust = selectTrustRecord(dns.records);
  if (trust === undefined) {
    return { verification: "https-only" };
  }
  const trustMatch = await verifyRecordProof(
    discovery.opid,
    bytes,
    headers["opap-proof"],
    trust,
  );
  return {
    verification: "dnssec-bound",
    trustMatch,
    ...(dns.ttl === undefined ? {} : { trustTtl: dns.ttl }),
  };
}

export async function checkPublication(
  input: string,
  options: PublicationOptions,
): Promise<PublicationCheck> {
  const discovery = discoverOpid(input);
  const fetched = await fetchOpapRecord(discovery.opid, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.httpsTimeoutMs === undefined
      ? {}
      : { timeoutMs: options.httpsTimeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const record = validateOpapRecordBytes(fetched.bytes, discovery.opid);
  const fingerprint = await fingerprintRecordBytes(fetched.bytes);
  const verification = await verificationFor(
    discovery.opid,
    fetched.bytes,
    fetched.headers,
    options,
  );

  return Object.freeze({
    opid: discovery.opid,
    url: fetched.url,
    trustName: discovery.trustName,
    fingerprint,
    ...verification,
    record,
    headers: fetched.headers,
  });
}

function withUpdatedHistory(
  history: VerificationHistory,
  checks: readonly PublicationCheck[],
  resolvedTo: string,
): VerificationHistory {
  const next: Record<string, VerificationHistory[string]> = { ...history };
  for (const check of checks) {
    const previous = history[check.opid];
    next[check.opid] = Object.freeze({
      highestVerification: transitionVerificationLevel(
        previous?.highestVerification,
        check.verification,
      ),
      fingerprint: check.fingerprint,
      resolvedTo,
    });
  }
  return Object.freeze(next);
}

export type LiveResolution = TerminalResolution & {
  readonly publications: readonly PublicationCheck[];
};

export async function resolveOpid(
  input: string,
  options: ResolutionOptions,
): Promise<LiveResolution> {
  const resolutionTimeoutMs =
    options.resolutionTimeoutMs ?? DEFAULT_RESOLUTION_TIMEOUT_MS;
  if (
    !Number.isFinite(resolutionTimeoutMs) ||
    resolutionTimeoutMs <= 0 ||
    resolutionTimeoutMs > DEFAULT_RESOLUTION_TIMEOUT_MS
  ) {
    throw new RangeError("resolutionTimeoutMs must be between 1 and 30000");
  }
  const timeout = createTimeoutSignal(resolutionTimeoutMs, options.signal);
  const timedOptions: PublicationOptions = {
    ...options,
    signal: timeout.signal,
  };
  const historyStore = options.history ?? EMPTY_VERIFICATION_HISTORY_STORE;
  try {
    const history = await historyStore.load();
    let state = createResolutionState(input);
    const publications: PublicationCheck[] = [];

    while (true) {
      const publication = await checkPublication(state.nextOpid, timedOptions);
      const previous = history[publication.opid];
      transitionVerificationLevel(
        previous?.highestVerification,
        publication.verification,
      );
      publications.push(publication);

      const step = advanceResolution(state, {
        record: publication.record,
        fingerprint: publication.fingerprint,
        verification: publication.verification,
      });
      if (step.status === "pending") {
        state = step;
        continue;
      }

      await historyStore.save(
        withUpdatedHistory(history, publications, step.resolvedTo),
      );
      return Object.freeze({
        ...step,
        publications: Object.freeze([...publications]),
      });
    }
  } finally {
    timeout.dispose();
  }
}

/** Resolves the payer-selected OPID again immediately before execution. */
export async function reResolveAndCompare(
  plan: ExecutionPlan,
  options: ResolutionOptions,
): Promise<LiveResolution> {
  const resolution = await resolveOpid(plan.source, options);
  assertExecutionPlanUnchanged(plan, resolution);
  return resolution;
}

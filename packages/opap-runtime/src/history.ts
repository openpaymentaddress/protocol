import type { VerificationLevel } from "@opap/core";

export interface VerificationHistoryEntry {
  readonly highestVerification: VerificationLevel;
  readonly fingerprint: string;
  readonly resolvedTo?: string;
}

export type VerificationHistory = Readonly<
  Record<string, VerificationHistoryEntry>
>;

export interface VerificationHistoryStore {
  load(): Promise<VerificationHistory>;
  save(history: VerificationHistory): Promise<void>;
}

export const EMPTY_VERIFICATION_HISTORY_STORE: VerificationHistoryStore =
  Object.freeze({
    async load(): Promise<VerificationHistory> {
      return Object.freeze({});
    },
    async save(): Promise<void> {},
  });

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import {
  normalizeOpid,
  type VerificationHistory,
  type VerificationHistoryEntry,
  type VerificationHistoryStore,
} from "@opap/runtime";

interface StateFile {
  readonly version: 1;
  readonly entries: VerificationHistory;
}

function isEntry(value: unknown): value is VerificationHistoryEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Partial<VerificationHistoryEntry>;
  return (
    (entry.highestVerification === "https-only" ||
      entry.highestVerification === "dnssec-bound") &&
    typeof entry.fingerprint === "string" &&
    /^[0-9a-f]{64}$/.test(entry.fingerprint) &&
    (entry.resolvedTo === undefined || typeof entry.resolvedTo === "string")
  );
}

function isCanonicalOpid(value: string): boolean {
  try {
    return normalizeOpid(value) === value;
  } catch {
    return false;
  }
}

function parseState(source: string): VerificationHistory {
  const value: unknown = JSON.parse(source);
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid verification-history state");
  }
  const state = value as Partial<StateFile>;
  if (
    state.version !== 1 ||
    typeof state.entries !== "object" ||
    state.entries === null ||
    Array.isArray(state.entries)
  ) {
    throw new Error("invalid verification-history state");
  }
  for (const [opid, entry] of Object.entries(state.entries)) {
    if (
      !isCanonicalOpid(opid) ||
      !isEntry(entry) ||
      (entry.resolvedTo !== undefined && !isCanonicalOpid(entry.resolvedTo))
    ) {
      throw new Error("invalid verification-history entry");
    }
  }
  return Object.freeze({ ...state.entries });
}

export class FileVerificationHistoryStore implements VerificationHistoryStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<VerificationHistory> {
    try {
      return parseState(await readFile(this.#path, "utf8"));
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return Object.freeze({});
      }
      throw error;
    }
  }

  async save(history: VerificationHistory): Promise<void> {
    const directory = dirname(this.#path);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${this.#path}.${randomUUID()}.tmp`;
    const contents = `${JSON.stringify(
      { version: 1, entries: history } satisfies StateFile,
      null,
      2,
    )}\n`;
    let temporaryCreated = false;

    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      temporaryCreated = true;
      try {
        await handle.writeFile(contents, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, this.#path);
      temporaryCreated = false;
    } finally {
      if (temporaryCreated) {
        await unlink(temporaryPath).catch(() => undefined);
      }
    }
  }
}

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileVerificationHistoryStore } from "../src/history";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CLI verification-history persistence", () => {
  it("atomically creates and replaces a versioned state file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opap-history-"));
    directories.push(directory);
    const path = join(directory, "nested", "history.json");
    const store = new FileVerificationHistoryStore(path);

    await expect(store.load()).resolves.toEqual({});
    await store.save({
      "https://merchant.example/": {
        highestVerification: "dnssec-bound",
        fingerprint: "a".repeat(64),
        resolvedTo: "https://recipient.example/",
      },
    });
    await store.save({
      "https://merchant.example/": {
        highestVerification: "dnssec-bound",
        fingerprint: "b".repeat(64),
        resolvedTo: "https://recipient.example/",
      },
    });

    await expect(store.load()).resolves.toEqual({
      "https://merchant.example/": {
        highestVerification: "dnssec-bound",
        fingerprint: "b".repeat(64),
        resolvedTo: "https://recipient.example/",
      },
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      version: 1,
    });
  });

  it("rejects non-canonical OPIDs at the state-file boundary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opap-history-"));
    directories.push(directory);
    const path = join(directory, "history.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        entries: {
          "PAY@EXAMPLE.COM": {
            highestVerification: "https-only",
            fingerprint: "a".repeat(64),
          },
        },
      }),
    );

    await expect(new FileVerificationHistoryStore(path).load()).rejects.toThrow(
      "invalid verification-history entry",
    );
  });
});

import { readFile } from "node:fs/promises";

import {
  OpapError,
  type OpapErrorCode,
  validateOpapRecordBytes,
} from "@opap/core";
import { describe, expect, it } from "vitest";

import manifest from "./manifest.json";

interface InvalidFixture {
  readonly file: string;
  readonly expectedError: OpapErrorCode;
  readonly expectedOpid?: string;
  readonly diagnosticIncludes?: string;
}

async function readFixture(file: string): Promise<Uint8Array> {
  const url = new URL(file, import.meta.url);
  const bytes = await readFile(url);

  if (!file.endsWith(".hex")) {
    return bytes;
  }

  return Uint8Array.from(
    Buffer.from(bytes.toString("ascii").replaceAll(/\s/g, ""), "hex"),
  );
}

describe("valid OPAP Record fixtures", () => {
  for (const fixture of manifest.valid) {
    it(fixture.file, async () => {
      const record = validateOpapRecordBytes(
        await readFixture(fixture.file),
        fixture.expectedOpid,
      );
      expect(record.id).toBe(fixture.expectedOpid);
    });
  }
});

describe("invalid OPAP Record fixtures", () => {
  for (const fixture of manifest.invalid as readonly InvalidFixture[]) {
    it(fixture.file, async () => {
      let thrown: unknown;
      try {
        validateOpapRecordBytes(
          await readFixture(fixture.file),
          fixture.expectedOpid,
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(OpapError);
      expect(thrown).toMatchObject({ code: fixture.expectedError });
      if (fixture.diagnosticIncludes !== undefined) {
        expect((thrown as OpapError).diagnostic).toContain(
          fixture.diagnosticIncludes,
        );
      }
    });
  }
});

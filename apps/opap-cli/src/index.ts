#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OpapError,
  checkPublication,
  createGoogleDnsResolver,
  fingerprintRecordBytes,
  normalizeOpid,
  resolveOpid,
  validateOpapRecordBytes,
} from "@opap/runtime";

import { FileVerificationHistoryStore } from "./history";
import { createPublicFetchAdapter } from "./network";

const HELP = `Usage: opap <command> [options]

Commands:
  record validate <file>                  Validate exact OPAP Record bytes
  record hash <file>                      Validate and hash exact record bytes
  record proof <pkcs8-file> <record-file> Sign an OPAP-Proof header for a URL record
  publish check <opid>                    Check live HTTPS and DNSSEC publication
  resolve <opid>                          Resolve a live direct/delegate OPID
  dns rotation-plan <active-key> <next-key> Print safe origin-key rotation steps

Options:
  --doh <https-url>     DNS-over-HTTPS JSON endpoint (default: dns.google)
  --history <file>      Verification-history file
  --ttl <seconds>       Previous TXT TTL for rotation-plan`;

interface ParsedArguments {
  readonly positional: readonly string[];
  readonly doh?: string;
  readonly history?: string;
  readonly ttl?: number;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const positional: string[] = [];
  let doh: string | undefined;
  let history: string | undefined;
  let ttl: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (["--doh", "--history", "--ttl"].includes(argument)) {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error(`missing value for ${argument}`);
      }
      index += 1;
      if (argument === "--doh") {
        doh = value;
      } else if (argument === "--history") {
        history = value;
      } else {
        ttl = Number(value);
        if (!Number.isInteger(ttl) || ttl < 0) {
          throw new Error("--ttl must be a non-negative integer");
        }
      }
      continue;
    }
    positional.push(argument);
  }

  return {
    positional,
    ...(doh === undefined ? {} : { doh }),
    ...(history === undefined ? {} : { history }),
    ...(ttl === undefined ? {} : { ttl }),
  };
}

function defaultHistoryPath(): string {
  return (
    process.env.OPAP_STATE_FILE ??
    join(homedir(), ".opap", "verification-history.json")
  );
}

async function recordBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("key must be unpadded base64url");
  }
  return new Uint8Array(
    Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64"),
  );
}

function assertOriginKey(value: string): void {
  if (decodeBase64Url(value).byteLength !== 32) {
    throw new Error("origin key must be a 32-byte Ed25519 public key");
  }
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export async function runCli(args: readonly string[]): Promise<number> {
  try {
    const parsed = parseArguments(args);
    const [first, second, third, fourth] = parsed.positional;

    if (first === undefined || first === "help" || first === "--help") {
      process.stdout.write(`${HELP}\n`);
      return 0;
    }

    if (first === "record" && second === "validate" && third !== undefined) {
      const bytes = await recordBytes(third);
      const record = validateOpapRecordBytes(bytes);
      writeJson({ valid: true, bytes: bytes.byteLength, record });
      return 0;
    }

    if (first === "record" && second === "hash" && third !== undefined) {
      const bytes = await recordBytes(third);
      const record = validateOpapRecordBytes(bytes);
      const fingerprint = await fingerprintRecordBytes(bytes);
      writeJson({
        valid: true,
        id: record.id,
        bytes: bytes.byteLength,
        fingerprint,
        sha256: fingerprint,
      });
      return 0;
    }

    if (
      first === "dns" &&
      second === "rotation-plan" &&
      third !== undefined &&
      fourth !== undefined
    ) {
      assertOriginKey(third);
      assertOriginKey(fourth);
      if (fourth === third) {
        throw new Error("next origin key equals active origin key");
      }
      const ttl = parsed.ttl;
      const wait =
        ttl === undefined ? "at least the previous TXT TTL" : `${ttl} seconds`;
      writeJson({
        activeKey: third,
        nextKey: fourth,
        steps: [
          `Publish TXT: v=opap1;ed25519=${third};next=${fourth}`,
          `Wait ${wait} before signing records with the next private key.`,
          "Sign every exact record response with the next private key.",
          `Wait ${wait} again.`,
          `Publish TXT: v=opap1;ed25519=${fourth}`,
        ],
      });
      return 0;
    }

    if (
      first === "record" &&
      second === "proof" &&
      third !== undefined &&
      fourth !== undefined
    ) {
      const privateKeyBytes = await recordBytes(third);
      const bytes = await recordBytes(fourth);
      const record = validateOpapRecordBytes(bytes);
      const key = await webcrypto.subtle.importKey(
        "pkcs8",
        Uint8Array.from(privateKeyBytes).buffer,
        { name: "Ed25519" },
        false,
        ["sign"],
      );
      const hash = await fingerprintRecordBytes(bytes);
      const signature = await webcrypto.subtle.sign(
        "Ed25519",
        key,
        new TextEncoder().encode(
          `OPAP/1\n${normalizeOpid(record.id)}\n${hash}`,
        ),
      );
      writeJson({
        id: record.id,
        proof: `v=1;sig=${base64url(new Uint8Array(signature))}`,
      });
      return 0;
    }

    const liveOpid =
      first === "resolve"
        ? second
        : first === "publish" && second === "check"
          ? third
          : undefined;
    if (liveOpid !== undefined) {
      const fetchAdapter = createPublicFetchAdapter();
      const dns = createGoogleDnsResolver({
        ...(parsed.doh === undefined ? {} : { endpoint: parsed.doh }),
        fetch: fetchAdapter,
      });
      if (first === "publish") {
        writeJson(
          await checkPublication(liveOpid, { dns, fetch: fetchAdapter }),
        );
      } else {
        const history = new FileVerificationHistoryStore(
          parsed.history ?? defaultHistoryPath(),
        );
        writeJson(
          await resolveOpid(liveOpid, { dns, fetch: fetchAdapter, history }),
        );
      }
      return 0;
    }

    throw new Error("unknown or incomplete command");
  } catch (error) {
    if (error instanceof OpapError) {
      process.stderr.write(
        `${JSON.stringify({ error: error.code, diagnostic: error.diagnostic })}\n`,
      );
    } else {
      process.stderr.write(
        `${JSON.stringify({ error: "cli_error", diagnostic: String(error) })}\n`,
      );
    }
    return 1;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && fileURLToPath(import.meta.url) === entryPath) {
  process.exitCode = await runCli(process.argv.slice(2));
}

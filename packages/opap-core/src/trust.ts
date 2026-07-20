import { OpapError } from "./errors";
import { fingerprintRecordBytes } from "./record";
import { normalizeOpid } from "./opid";

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const TRUST_RECORD =
  /^v=opap1;ed25519=([A-Za-z0-9_-]+)(?:;next=([A-Za-z0-9_-]+))?$/;
const PROOF = /^v=1;sig=([A-Za-z0-9_-]+)$/;

export interface TrustRecord {
  readonly ed25519: string;
  readonly next?: string;
}
export type TrustRecordMatch = "ed25519" | "next";

function decodeBase64Url(
  value: string,
  code: "invalid_trust_record" | "record_proof_invalid",
): Uint8Array {
  if (!BASE64URL.test(value)) throw new OpapError(code);
  try {
    const binary = atob(
      `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`,
    );
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new OpapError(code);
  }
}

function validPublicKey(value: string): boolean {
  return decodeBase64Url(value, "invalid_trust_record").byteLength === 32;
}

export function parseTrustRecord(value: string): TrustRecord {
  const match = TRUST_RECORD.exec(value);
  const ed25519 = match?.[1];
  const next = match?.[2];
  if (
    ed25519 === undefined ||
    !validPublicKey(ed25519) ||
    (next !== undefined && (!validPublicKey(next) || next === ed25519))
  )
    throw new OpapError("invalid_trust_record", `value:${value}`);
  return Object.freeze({ ed25519, ...(next === undefined ? {} : { next }) });
}

export function selectTrustRecord(
  records: readonly (readonly string[])[],
): TrustRecord | undefined {
  const candidates = records
    .map((chunks) => chunks.join(""))
    .filter((value) => value.trimStart().startsWith("v=opap1"));
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1)
    throw new OpapError("ambiguous_trust_record", `count:${candidates.length}`);
  return parseTrustRecord(candidates[0] ?? "");
}

export function originTrustName(opid: string): string {
  return `_opap.${new URL(normalizeOpid(opid)).hostname}`;
}

export async function verifyRecordProof(
  opid: string,
  bytes: Uint8Array,
  proofHeader: string | undefined,
  trustRecord: TrustRecord,
): Promise<TrustRecordMatch> {
  const proof =
    proofHeader === undefined ? undefined : PROOF.exec(proofHeader)?.[1];
  if (proof === undefined) throw new OpapError("record_proof_invalid");
  const signature = decodeBase64Url(proof, "record_proof_invalid");
  if (signature.byteLength !== 64) throw new OpapError("record_proof_invalid");
  const signed = new TextEncoder().encode(
    `OPAP/1\n${normalizeOpid(opid)}\n${await fingerprintRecordBytes(bytes)}`,
  );
  for (const [name, key] of [
    ["ed25519", trustRecord.ed25519],
    ["next", trustRecord.next],
  ] as const) {
    if (key === undefined) continue;
    try {
      const publicKey = await crypto.subtle.importKey(
        "raw",
        Uint8Array.from(decodeBase64Url(key, "invalid_trust_record")).buffer,
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      if (
        await crypto.subtle.verify(
          "Ed25519",
          publicKey,
          Uint8Array.from(signature).buffer,
          Uint8Array.from(signed).buffer,
        )
      )
        return name;
    } catch (cause) {
      throw new OpapError("record_proof_invalid", undefined, { cause });
    }
  }
  throw new OpapError("record_proof_invalid");
}

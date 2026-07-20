import { describe, expect, it } from "vitest";

import {
  originTrustName,
  parseTrustRecord,
  selectTrustRecord,
  verifyRecordProof,
} from "../src/index";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function signedProof(
  opid: string,
  bytes: Uint8Array,
  key: CryptoKey,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
  );
  const hash = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const signature = await crypto.subtle.sign(
    "Ed25519",
    key,
    new TextEncoder().encode(`OPAP/1\n${opid}\n${hash}`).buffer,
  );
  return `v=1;sig=${base64url(new Uint8Array(signature))}`;
}

describe("OPAP/1 origin DNSSEC keys and record proof", () => {
  it("accepts an active key, a rotating next key, and exact-host key names", async () => {
    const active = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ]);
    const next = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ]);
    const activePublic = base64url(
      new Uint8Array(await crypto.subtle.exportKey("raw", active.publicKey)),
    );
    const nextPublic = base64url(
      new Uint8Array(await crypto.subtle.exportKey("raw", next.publicKey)),
    );
    const trust = parseTrustRecord(
      `v=opap1;ed25519=${activePublic};next=${nextPublic}`,
    );
    const opid = "https://customer.opid.provider/product/1223";
    const body = new TextEncoder().encode('{"version":1}');
    await expect(
      verifyRecordProof(
        opid,
        body,
        await signedProof(opid, body, active.privateKey),
        trust,
      ),
    ).resolves.toBe("ed25519");
    await expect(
      verifyRecordProof(
        opid,
        body,
        await signedProof(opid, body, next.privateKey),
        trust,
      ),
    ).resolves.toBe("next");
    expect(originTrustName(opid)).toBe("_opap.customer.opid.provider");
    expect(originTrustName("https://opid.provider/")).toBe(
      "_opap.opid.provider",
    );
    expect(originTrustName("https://child.customer.opid.provider/")).toBe(
      "_opap.child.customer.opid.provider",
    );
  });

  it("fails closed for malformed keys, duplicate OPAP records, invalid proof, and changed body", async () => {
    expect(() => parseTrustRecord("v=opap1;ed25519=short")).toThrowError(
      expect.objectContaining({ code: "invalid_trust_record" }),
    );
    expect(() =>
      selectTrustRecord([["v=opap1;ed25519=abc"], ["v=opap1;ed25519=def"]]),
    ).toThrowError(expect.objectContaining({ code: "ambiguous_trust_record" }));
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ]);
    const publicKey = base64url(
      new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    );
    const trust = parseTrustRecord(`v=opap1;ed25519=${publicKey}`);
    const opid = "https://merchant.example/";
    const body = new TextEncoder().encode("record");
    await expect(
      verifyRecordProof(opid, body, "v=1;sig=invalid", trust),
    ).rejects.toMatchObject({ code: "record_proof_invalid" });
    await expect(
      verifyRecordProof(
        opid,
        new TextEncoder().encode("changed"),
        await signedProof(opid, body, pair.privateKey),
        trust,
      ),
    ).rejects.toMatchObject({ code: "record_proof_invalid" });
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  fingerprintRecordBytes,
  resolveOpid,
  type DnsTxtResolver,
  type FetchAdapter,
  type VerificationHistoryStore,
} from "../src/index";

const encoder = new TextEncoder();
const headers = (proof?: string) =>
  new Headers({
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "Content-Encoding, OPAP-Proof",
    "cache-control": "no-store",
    "content-encoding": "identity",
    "content-type": "application/opap+json",
    ...(proof === undefined ? {} : { "opap-proof": proof }),
  });
const dns = (
  status: "secure" | "insecure" | "bogus",
  records: readonly (readonly string[])[] = [],
): DnsTxtResolver => ({ resolveTxt: vi.fn(async () => ({ status, records })) });
const history = (): VerificationHistoryStore => ({
  load: async () => ({}),
  save: async () => undefined,
});
const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
async function proof(
  opid: string,
  bytes: Uint8Array,
  privateKey: CryptoKey,
): Promise<string> {
  const hash = await fingerprintRecordBytes(bytes);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    encoder.encode(`OPAP/1\n${opid}\n${hash}`).buffer,
  );
  return `v=1;sig=${b64(new Uint8Array(signature))}`;
}

describe("URL OPID resolution", () => {
  it("does not fetch the submitted product page and follows a bounded delegate", async () => {
    const product = "https://customer.opid.provider/product/1223";
    const merchant = "https://customer.opid.provider/";
    const productUrl =
      "https://customer.opid.provider/.well-known/open-payment/record/L3Byb2R1Y3QvMTIyMw";
    const merchantUrl =
      "https://customer.opid.provider/.well-known/open-payment/record/Lw";
    const records = new Map([
      [
        productUrl,
        encoder.encode(
          JSON.stringify({
            version: 1,
            id: product,
            payment: { type: "delegate", target: merchant },
          }),
        ),
      ],
      [
        merchantUrl,
        encoder.encode(
          JSON.stringify({
            version: 1,
            id: merchant,
            payment: {
              type: "direct",
              methods: [
                {
                  type: "sepa",
                  currency: "EUR",
                  name: "Merchant",
                  iban: "NL91ABNA0417164300",
                },
              ],
            },
          }),
        ),
      ],
    ]);
    const fetch: FetchAdapter = vi.fn(
      async (url) =>
        new Response(records.get(url) ?? null, {
          status: records.has(url) ? 200 : 404,
          headers: headers(),
        }),
    );
    const result = await resolveOpid(product, {
      fetch,
      dns: dns("insecure"),
      history: history(),
    });
    expect(result.resolvedTo).toBe(merchant);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalledWith(product, expect.anything());
  });
  it("requires an Ed25519 proof when a secure origin key exists", async () => {
    const opid = "https://merchant.example/";
    const bytes = encoder.encode(
      JSON.stringify({
        version: 1,
        id: opid,
        payment: {
          type: "direct",
          methods: [
            {
              type: "sepa",
              currency: "EUR",
              name: "Merchant",
              iban: "NL91ABNA0417164300",
            },
          ],
        },
      }),
    );
    const key = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ]);
    const publicKey = b64(
      new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey)),
    );
    await expect(
      resolveOpid(opid, {
        fetch: async () =>
          new Response(bytes, {
            status: 200,
            headers: headers(await proof(opid, bytes, key.privateKey)),
          }),
        dns: dns("secure", [[`v=opap1;ed25519=${publicKey}`]]),
        history: history(),
      }),
    ).resolves.toMatchObject({ records: [{ verification: "dnssec-bound" }] });
    await expect(
      resolveOpid(opid, {
        fetch: async () =>
          new Response(bytes, { status: 200, headers: headers() }),
        dns: dns("secure", [[`v=opap1;ed25519=${publicKey}`]]),
        history: history(),
      }),
    ).rejects.toMatchObject({ code: "record_proof_invalid" });
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  MAX_RECORD_BYTES,
  fetchOpapRecord,
  type FetchAdapter,
} from "../src/index";

const body = new TextEncoder().encode('{"version":1}');
const headers = (overrides: Record<string, string> = {}) =>
  new Headers({
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "Content-Encoding, OPAP-Proof",
    "cache-control": "no-store",
    "content-encoding": "identity",
    "content-type": "application/opap+json",
    ...overrides,
  });
const adapter = (response: Response): FetchAdapter =>
  vi.fn(async () => response);

describe("record-only HTTPS transport", () => {
  it("fetches only the derived well-known URL, without credentials or redirects", async () => {
    const fetch = adapter(
      new Response(body, { status: 200, headers: headers() }),
    );
    const result = await fetchOpapRecord(
      "https://customer.opid.provider/product/1223",
      { fetch },
    );
    expect(result.url).toBe(
      "https://customer.opid.provider/.well-known/open-payment/record/L3Byb2R1Y3QvMTIyMw",
    );
    expect(fetch).toHaveBeenCalledWith(
      result.url,
      expect.objectContaining({
        credentials: "omit",
        redirect: "manual",
        cache: "no-store",
      }),
    );
  });
  it.each([
    ["content-type", "text/plain"],
    ["content-encoding", "gzip"],
    ["access-control-expose-headers", "Content-Encoding"],
    ["cache-control", "max-age=60"],
  ])("rejects invalid %s", async (name, value) => {
    await expect(
      fetchOpapRecord("https://merchant.example/", {
        fetch: adapter(
          new Response(body, {
            status: 200,
            headers: headers({ [name]: value }),
          }),
        ),
      }),
    ).rejects.toMatchObject({ code: "invalid_record" });
  });
  it("bounds bodies and maps redirects and absence", async () => {
    await expect(
      fetchOpapRecord("https://merchant.example/", {
        fetch: adapter(new Response(null, { status: 302 })),
      }),
    ).rejects.toMatchObject({ code: "record_unavailable" });
    await expect(
      fetchOpapRecord("https://merchant.example/", {
        fetch: adapter(new Response(null, { status: 404 })),
      }),
    ).rejects.toMatchObject({ code: "record_not_found" });
    await expect(
      fetchOpapRecord("https://merchant.example/", {
        fetch: adapter(
          new Response(new Uint8Array(MAX_RECORD_BYTES + 1), {
            status: 200,
            headers: headers(),
          }),
        ),
      }),
    ).rejects.toMatchObject({ diagnostic: "response_too_large" });
  });
});

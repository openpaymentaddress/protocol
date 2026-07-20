import { describe, expect, it, vi } from "vitest";

import { createGoogleDnsResolver, type FetchAdapter } from "../src/index";
import { interpretGoogleDnsResponse } from "../src/dns";

describe("DNS-over-HTTPS DNSSEC interpretation", () => {
  it("parses secure TXT records, including DNS character-string chunks", () => {
    expect(
      interpretGoogleDnsResponse({
        Status: 0,
        AD: true,
        Answer: [
          {
            type: 16,
            TTL: 300,
            data: '"v=opap1;sha256=" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
          },
        ],
      }),
    ).toEqual({
      status: "secure",
      records: [
        [
          "v=opap1;sha256=",
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ],
      ],
      ttl: 300,
    });
  });

  it.each([
    [
      { Status: 0, AD: false },
      { status: "insecure", records: [] },
    ],
    [
      { Status: 0, AD: true },
      { status: "secure", records: [] },
    ],
    [
      { Status: 3, AD: true },
      { status: "secure", records: [] },
    ],
    [
      { Status: 2, AD: false, Comment: "DNSSEC validation failure" },
      { status: "bogus", records: [] },
    ],
  ])("maps resolver result %j", (response, expected) => {
    expect(interpretGoogleDnsResponse(response)).toEqual(expected);
  });

  it("does not mislabel an ordinary resolver failure as DNSSEC bogus", () => {
    expect(() =>
      interpretGoogleDnsResponse({ Status: 2, AD: false }),
    ).toThrowError(expect.objectContaining({ code: "record_unavailable" }));
  });

  it("uses a configurable HTTPS JSON endpoint with DNSSEC enabled", async () => {
    const fetch: FetchAdapter = vi.fn(
      async () =>
        new Response(JSON.stringify({ Status: 0, AD: true }), {
          status: 200,
          headers: { "content-type": "application/dns-json" },
        }),
    );
    const resolver = createGoogleDnsResolver({
      endpoint: "https://resolver.example/dns-query",
      fetch,
    });
    await expect(resolver.resolveTxt("pay._opap.example.com")).resolves.toEqual(
      {
        status: "secure",
        records: [],
      },
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/resolver\.example\/dns-query\?.*name=pay(?:\.|%2E)_opap(?:\.|%2E)example(?:\.|%2E)com/,
      ),
      expect.objectContaining({ redirect: "error" }),
    );
  });
});

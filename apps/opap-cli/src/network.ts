import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

import type { FetchAdapter } from "@opap/runtime";

const NON_PUBLIC_ADDRESSES = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  return (
    family !== 0 &&
    !NON_PUBLIC_ADDRESSES.check(address, family === 4 ? "ipv4" : "ipv6")
  );
}

export function createPublicFetchAdapter(): FetchAdapter {
  return async (input, init) => {
    const url = new URL(input);
    if (url.protocol !== "https:") {
      throw new TypeError("only HTTPS requests are allowed");
    }
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => !isPublicIpAddress(address))
    ) {
      throw new TypeError("hostname resolves to a non-public address");
    }

    let lastError: unknown;
    for (const { address, family } of addresses) {
      try {
        return await new Promise<Response>((resolve, reject) => {
          const outgoingHeaders = new Headers(init.headers);
          const requestHandle = request(
            url,
            {
              headers: Object.fromEntries(outgoingHeaders.entries()),
              lookup: (_hostname, lookupOptions, callback) => {
                if (lookupOptions.all === true) {
                  callback(null, [{ address, family }]);
                } else {
                  callback(null, address, family);
                }
              },
              method: init.method ?? "GET",
              signal: init.signal ?? undefined,
            },
            (incoming) => {
              const responseHeaders = new Headers();
              for (
                let index = 0;
                index < incoming.rawHeaders.length;
                index += 2
              ) {
                const name = incoming.rawHeaders[index];
                const value = incoming.rawHeaders[index + 1];
                if (name !== undefined && value !== undefined) {
                  responseHeaders.append(name, value);
                }
              }
              resolve(
                new Response(Readable.toWeb(incoming) as unknown as BodyInit, {
                  status: incoming.statusCode ?? 500,
                  ...(incoming.statusMessage === undefined
                    ? {}
                    : { statusText: incoming.statusMessage }),
                  headers: responseHeaders,
                }),
              );
            },
          );
          requestHandle.on("error", reject);
          requestHandle.end();
        });
      } catch (error) {
        lastError = error;
        if (init.signal?.aborted === true) {
          throw error;
        }
      }
    }
    throw lastError ?? new TypeError("no public address was reachable");
  };
}

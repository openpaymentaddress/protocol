import { OpapError } from "@opap/core";

import { createTimeoutSignal } from "./timeout";
import type { FetchAdapter } from "./https";

export const DEFAULT_DOH_ENDPOINT = "https://dns.google/resolve";
export const DEFAULT_DNS_TIMEOUT_MS = 5_000;

export type DnssecStatus = "secure" | "insecure" | "bogus";

export interface DnsTxtResult {
  readonly status: DnssecStatus;
  readonly records: readonly (readonly string[])[];
  readonly ttl?: number;
}

export interface DnsTxtResolver {
  resolveTxt(name: string, signal?: AbortSignal): Promise<DnsTxtResult>;
}

interface GoogleDnsAnswer {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly TTL?: unknown;
  readonly data?: unknown;
}

interface GoogleDnsResponse {
  readonly Status?: unknown;
  readonly AD?: unknown;
  readonly Answer?: unknown;
  readonly Comment?: unknown;
}

function parseTxtChunks(presentation: string): readonly string[] {
  const chunks: string[] = [];
  let position = 0;

  while (position < presentation.length) {
    while (presentation[position] === " ") {
      position += 1;
    }
    if (presentation[position] !== '"') {
      throw new OpapError("record_unavailable", "invalid_doh_txt_data");
    }
    position += 1;
    let chunk = "";
    let closed = false;

    while (position < presentation.length) {
      const character = presentation[position];
      position += 1;
      if (character === '"') {
        closed = true;
        break;
      }
      if (character !== "\\") {
        chunk += character;
        continue;
      }
      const decimalEscape = presentation.slice(position, position + 3);
      if (/^\d{3}$/.test(decimalEscape)) {
        const value = Number(decimalEscape);
        if (value > 255) {
          throw new OpapError("record_unavailable", "invalid_doh_txt_escape");
        }
        chunk += String.fromCharCode(value);
        position += 3;
      } else {
        const escaped = presentation[position];
        if (escaped === undefined) {
          throw new OpapError("record_unavailable", "invalid_doh_txt_escape");
        }
        chunk += escaped;
        position += 1;
      }
    }

    if (!closed) {
      throw new OpapError("record_unavailable", "invalid_doh_txt_data");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    throw new OpapError("record_unavailable", "empty_doh_txt_data");
  }
  return Object.freeze(chunks);
}

export function interpretGoogleDnsResponse(value: unknown): DnsTxtResult {
  if (typeof value !== "object" || value === null) {
    throw new OpapError("record_unavailable", "invalid_doh_response");
  }
  const response = value as GoogleDnsResponse;
  const status = response.Status;
  const comment = typeof response.Comment === "string" ? response.Comment : "";

  if (status === 2 && /dnssec|validation failure|bogus/i.test(comment)) {
    return Object.freeze({ status: "bogus", records: Object.freeze([]) });
  }
  if (status !== 0 && status !== 3) {
    throw new OpapError("record_unavailable", `dns_status:${String(status)}`);
  }

  const answers = Array.isArray(response.Answer)
    ? (response.Answer as GoogleDnsAnswer[])
    : [];
  const txtAnswers = answers.filter((answer) => answer.type === 16);
  const records = Object.freeze(
    txtAnswers.map((answer) => {
      if (typeof answer.data !== "string") {
        throw new OpapError("record_unavailable", "invalid_doh_txt_answer");
      }
      return parseTxtChunks(answer.data);
    }),
  );
  const ttls = txtAnswers
    .map((answer) => answer.TTL)
    .filter((ttl): ttl is number => typeof ttl === "number" && ttl >= 0);
  const ttl = ttls.length === 0 ? undefined : Math.min(...ttls);

  return Object.freeze({
    status: response.AD === true ? "secure" : "insecure",
    records,
    ...(ttl === undefined ? {} : { ttl }),
  });
}

export interface GoogleDnsResolverOptions {
  readonly endpoint?: string;
  readonly fetch?: FetchAdapter;
  readonly timeoutMs?: number;
}

export function createGoogleDnsResolver(
  options: GoogleDnsResolverOptions = {},
): DnsTxtResolver {
  const endpoint = new URL(options.endpoint ?? DEFAULT_DOH_ENDPOINT);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username.length > 0 ||
    endpoint.password.length > 0
  ) {
    throw new TypeError(
      "DNS-over-HTTPS endpoint must use credential-free HTTPS",
    );
  }
  const fetchAdapter = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_DNS_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000) {
    throw new RangeError("timeoutMs must be between 1 and 10000");
  }

  return Object.freeze({
    async resolveTxt(
      name: string,
      signal?: AbortSignal,
    ): Promise<DnsTxtResult> {
      const url = new URL(endpoint);
      url.searchParams.set("name", name);
      url.searchParams.set("type", "TXT");
      url.searchParams.set("do", "1");
      url.searchParams.set("cd", "0");
      const timeout = createTimeoutSignal(timeoutMs, signal);

      try {
        const response = await fetchAdapter(url.href, {
          cache: "no-store",
          credentials: "omit",
          headers: { accept: "application/dns-json" },
          method: "GET",
          redirect: "error",
          signal: timeout.signal,
        });
        if (!response.ok) {
          throw new OpapError(
            "record_unavailable",
            `doh_http_status:${response.status}`,
          );
        }
        return interpretGoogleDnsResponse(await response.json());
      } catch (error) {
        if (error instanceof OpapError) {
          throw error;
        }
        throw new OpapError(
          "record_unavailable",
          timeout.signal.aborted
            ? "doh_timeout_or_aborted"
            : "doh_network_error",
          { cause: error },
        );
      } finally {
        timeout.dispose();
      }
    },
  });
}

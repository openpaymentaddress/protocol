import { MAX_RECORD_BYTES, OpapError, type OpapErrorCode } from "@opap/core";

import { discoverOpid } from "./discovery";
import { createTimeoutSignal } from "./timeout";

export const DEFAULT_HTTPS_TIMEOUT_MS = 10_000;

export type FetchAdapter = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface FetchRecordOptions {
  readonly fetch?: FetchAdapter;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface FetchedOpapRecord {
  readonly opid: string;
  readonly url: string;
  readonly bytes: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

interface DocumentErrorProfile {
  readonly invalid: OpapErrorCode;
  readonly unavailable: OpapErrorCode;
  readonly notFound: OpapErrorCode;
}

function invalidResponse(code: OpapErrorCode, diagnostic: string): never {
  throw new OpapError(code, diagnostic);
}

function requireTransportHeaders(
  response: Response,
  code: OpapErrorCode,
): void {
  const { headers } = response;
  const browserEnforcedCors = response.type === "cors";
  const contentType = headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (
    contentType !== "application/opap+json" &&
    contentType !== "application/json"
  ) {
    invalidResponse(code, "invalid_content_type");
  }
  if (headers.get("content-encoding")?.trim().toLowerCase() !== "identity") {
    invalidResponse(code, "invalid_content_encoding");
  }
  const corsOrigin = headers.get("access-control-allow-origin");
  if (
    browserEnforcedCors
      ? corsOrigin !== null && corsOrigin.trim() !== "*"
      : corsOrigin?.trim() !== "*"
  ) {
    invalidResponse(code, "invalid_cors_origin");
  }
  const corsCredentials = headers.get("access-control-allow-credentials");
  if (corsCredentials?.trim().toLowerCase() === "true") {
    invalidResponse(code, "credentials_not_allowed");
  }

  const exposedHeader = headers.get("access-control-expose-headers");
  const exposed = (exposedHeader ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase());
  if (
    browserEnforcedCors
      ? exposedHeader !== null &&
        (!exposed.includes("content-encoding") ||
          !exposed.includes("opap-proof"))
      : !exposed.includes("content-encoding") || !exposed.includes("opap-proof")
  ) {
    invalidResponse(code, "content_encoding_not_exposed");
  }

  const cacheControl = (headers.get("cache-control") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase());
  if (!cacheControl.includes("no-store")) {
    invalidResponse(code, "cache_not_disabled");
  }
}

async function readBoundedBody(
  response: Response,
  code: OpapErrorCode,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_RECORD_BYTES
  ) {
    invalidResponse(code, "response_too_large");
  }

  if (response.body === null) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      length += result.value.byteLength;
      if (length > MAX_RECORD_BYTES) {
        await reader.cancel();
        invalidResponse(code, "response_too_large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function selectedHeaders(headers: Headers): Readonly<Record<string, string>> {
  const names = [
    "access-control-allow-origin",
    "access-control-expose-headers",
    "cache-control",
    "content-encoding",
    "content-type",
    "opap-proof",
  ];
  return Object.freeze(
    Object.fromEntries(
      names.flatMap((name) => {
        const value = headers.get(name);
        return value === null ? [] : [[name, value]];
      }),
    ),
  );
}

export async function fetchOpapRecord(
  input: string,
  options: FetchRecordOptions = {},
): Promise<FetchedOpapRecord> {
  const discovery = discoverOpid(input);
  const fetched = await fetchBoundedDocument(discovery.recordUrl, options, {
    invalid: "invalid_record",
    unavailable: "record_unavailable",
    notFound: "record_not_found",
  });
  return Object.freeze({
    opid: discovery.opid,
    url: discovery.recordUrl,
    ...fetched,
  });
}

async function fetchBoundedDocument(
  url: string,
  options: FetchRecordOptions,
  errors: DocumentErrorProfile,
): Promise<{
  readonly bytes: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}> {
  const fetchAdapter = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTPS_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000) {
    throw new RangeError("timeoutMs must be between 1 and 10000");
  }
  const timeout = createTimeoutSignal(timeoutMs, options.signal);

  try {
    const response = await fetchAdapter(url, {
      cache: "no-store",
      credentials: "omit",
      headers: {
        accept: "application/opap+json, application/json;q=0.9",
        "accept-encoding": "identity",
      },
      method: "GET",
      redirect: "manual",
      signal: timeout.signal,
    });

    if (response.status === 404 || response.status === 410) {
      throw new OpapError(errors.notFound, `status:${response.status}`);
    }
    if (response.status !== 200) {
      throw new OpapError(
        errors.unavailable,
        response.status >= 300 && response.status < 400
          ? `redirect:${response.status}`
          : `status:${response.status}`,
      );
    }

    requireTransportHeaders(response, errors.invalid);
    const bytes = await readBoundedBody(response, errors.invalid);
    return Object.freeze({
      bytes,
      headers: selectedHeaders(response.headers),
    });
  } catch (error) {
    if (error instanceof OpapError) {
      throw error;
    }
    const diagnostic = timeout.signal.aborted
      ? "timeout_or_aborted"
      : "network_error";
    throw new OpapError(errors.unavailable, diagnostic, { cause: error });
  } finally {
    timeout.dispose();
  }
}

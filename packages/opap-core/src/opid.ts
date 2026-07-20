import { OpapError } from "./errors";

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PATH_SEGMENT = /^(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$/;
const UNRESERVED_PERCENT_ESCAPE =
  /%(?:2D|2E|5F|7E|[3-5][0-9]|6[1-9A-F]|7[0-9A-F])/i;
const FORBIDDEN_PATH_ESCAPE = /%(?:2F|5C)/i;

function invalidOpid(input: string): never {
  throw new OpapError("invalid_opid", `input:${input}`);
}

function assertCanonicalPath(path: string, input: string): void {
  if (path === "/") return;
  if (!path.startsWith("/") || path.endsWith("/")) invalidOpid(input);
  for (const segment of path.slice(1).split("/")) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      !PATH_SEGMENT.test(segment) ||
      FORBIDDEN_PATH_ESCAPE.test(segment) ||
      UNRESERVED_PERCENT_ESCAPE.test(segment)
    )
      invalidOpid(input);
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(
        [...path.matchAll(/%([0-9A-F]{2})/g)].map((match) =>
          Number.parseInt(match[1] ?? "", 16),
        ),
      ),
    );
  } catch {
    invalidOpid(input);
  }
}

/** Canonicalises the only OPAP/1 identifier form: an absolute HTTPS URL. */
export function normalizeOpid(input: string): string {
  const raw = /^https:\/\/([^/?#]+)(\/[^?#]*)$/iu.exec(input);
  if (raw === null || raw[1]?.includes("@") || raw[1]?.includes(":")) {
    invalidOpid(input);
  }
  assertCanonicalPath(raw[2] ?? "", input);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    invalidOpid(input);
  }
  if (
    url.protocol !== "https:" ||
    url.username.length !== 0 ||
    url.password.length !== 0 ||
    url.port.length !== 0 ||
    url.search.length !== 0 ||
    url.hash.length !== 0 ||
    url.hostname.length === 0
  )
    invalidOpid(input);
  const hostname = url.hostname.toLowerCase();
  if (
    hostname.length > 253 ||
    hostname.split(".").some((label) => !HOST_LABEL.test(label))
  )
    invalidOpid(input);
  const path = url.pathname;
  const canonical = `https://${hostname}${path}`;
  if (canonical.length > 512) invalidOpid(input);
  return canonical;
}

export function derivePathKey(opid: string): string {
  const canonical = normalizeOpid(opid);
  const bytes = new TextEncoder().encode(new URL(canonical).pathname);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function deriveRecordUrl(opid: string): string {
  const canonical = normalizeOpid(opid);
  return `https://${new URL(canonical).hostname}/.well-known/open-payment/record/${derivePathKey(canonical)}`;
}

import { deriveRecordUrl, normalizeOpid, originTrustName } from "@opap/core";

/** Deterministic, same-origin discovery for a canonical URL OPID. */
export interface OpapDiscovery {
  readonly opid: string;
  readonly recordUrl: string;
  readonly trustName: string;
}

export function discoverOpid(input: string): OpapDiscovery {
  const opid = normalizeOpid(input);
  return Object.freeze({
    opid,
    recordUrl: deriveRecordUrl(opid),
    trustName: originTrustName(opid),
  });
}

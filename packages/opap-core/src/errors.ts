export const OPAP_ERROR_CODES = [
  "invalid_opid",
  "record_not_found",
  "record_unavailable",
  "invalid_record",
  "unsupported_version",
  "id_mismatch",
  "dnssec_bogus",
  "invalid_trust_record",
  "ambiguous_trust_record",
  "record_proof_invalid",
  "verification_downgrade",
  "resolution_loop",
  "resolution_limit",
  "no_supported_method",
  "unrecognized_asset",
  "asset_currency_mismatch",
  "unsupported_split_adapter",
  "nested_split_not_supported",
  "recipient_mismatch",
  "split_state_mismatch",
  "amount_not_splittable",
  "execution_changed",
] as const;

export type OpapErrorCode = (typeof OPAP_ERROR_CODES)[number];

export class OpapError extends Error {
  readonly code: OpapErrorCode;
  readonly diagnostic: string | undefined;

  constructor(
    code: OpapErrorCode,
    diagnostic?: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "OpapError";
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

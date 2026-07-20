import type { ErrorObject, ValidateFunction } from "ajv";

import { OpapError } from "./errors";
import validateSchema from "./generated/opap-schema-validator";
import { hasValidIbanChecksum } from "./iban";
import { parseJsonBytes } from "./json";
import { normalizeOpid } from "./opid";
import type { OpapRecord, PaymentHandler, SepaPaymentHandler } from "./types";

const validate = validateSchema as ValidateFunction<OpapRecord>;

function schemaDiagnostic(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(
      (error) =>
        `${error.instancePath || "/"} ${error.message ?? error.keyword}`,
    )
    .join("; ");
}

function isSepaMethod(method: PaymentHandler): method is SepaPaymentHandler {
  return method.type === "sepa";
}

export function validateOpapRecordBytes(
  bytes: Uint8Array,
  expectedOpid?: string,
): OpapRecord {
  const value = parseJsonBytes(bytes);

  if (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    value.version !== 1
  ) {
    throw new OpapError("unsupported_version", `version:${value.version}`);
  }

  if (!validate(value)) {
    throw new OpapError("invalid_record", schemaDiagnostic(validate.errors));
  }
  const record = value as OpapRecord;
  if (normalizeOpid(record.id) !== record.id) {
    throw new OpapError("invalid_record", `noncanonical_id:${record.id}`);
  }
  if (
    record.payment.type === "delegate" &&
    normalizeOpid(record.payment.target) !== record.payment.target
  ) {
    throw new OpapError(
      "invalid_record",
      `noncanonical_delegate_target:${record.payment.target}`,
    );
  }
  if (expectedOpid !== undefined) {
    const normalizedExpectedOpid = normalizeOpid(expectedOpid);
    if (record.id !== normalizedExpectedOpid) {
      throw new OpapError(
        "id_mismatch",
        `expected:${normalizedExpectedOpid};actual:${record.id}`,
      );
    }
  }
  if (record.payment.type === "direct") {
    for (const method of record.payment.methods) {
      if (isSepaMethod(method) && !hasValidIbanChecksum(method.iban)) {
        throw new OpapError(
          "invalid_record",
          `invalid_iban_checksum:${method.iban}`,
        );
      }
    }
  }
  if (record.payment.type === "split") {
    const recipients = new Set<string>();
    let totalShare = 0;
    for (const recipient of record.payment.recipients) {
      const normalizedRecipient = recipient.recipient.toLowerCase();
      if (recipients.has(normalizedRecipient)) {
        throw new OpapError(
          "invalid_record",
          `duplicate_split_recipient:${recipient.recipient}`,
        );
      }
      recipients.add(normalizedRecipient);
      totalShare += recipient.share_ppm;
    }
    if (totalShare !== 1_000_000) {
      throw new OpapError(
        "invalid_record",
        `invalid_split_share_sum:${totalShare}`,
      );
    }
  }

  return record;
}

export async function fingerprintRecordBytes(
  bytes: Uint8Array,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

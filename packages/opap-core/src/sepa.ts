import { decimalAmountToAtomicUnits } from "./amount";
import type { SepaExecutionPlan } from "./execution-plan";

function formatEuroAmount(amount: string): string {
  const atomic = decimalAmountToAtomicUnits(amount, 2);
  const whole = atomic / 100n;
  const cents = (atomic % 100n).toString().padStart(2, "0");
  return `${whole}.${cents}`;
}

function safeRemittance(value: string | undefined): string {
  const remittance = value?.trim() ?? "";
  if (/[\p{Cc}\p{Cf}]/u.test(remittance)) {
    throw new RangeError("invalid_sepa_remittance");
  }
  if (new TextEncoder().encode(remittance).length > 140) {
    throw new RangeError("sepa_remittance_too_long");
  }
  return remittance;
}

export interface SepaHandoff {
  readonly paytoUri: string;
  readonly epcQrPayload: string;
  readonly amount: string;
  readonly currency: "EUR";
  readonly settlementStatus: "handoff-only";
}

export function buildSepaHandoff(plan: SepaExecutionPlan): SepaHandoff {
  const amount = formatEuroAmount(plan.intent.amount);
  const remittance = safeRemittance(plan.intent.description);
  const parameters = new URLSearchParams();
  parameters.set("amount", `EUR:${amount}`);
  parameters.set("receiver-name", plan.method.name);
  if (remittance.length > 0) {
    parameters.set("message", remittance);
  }
  const paytoUri = `payto://iban/${plan.method.iban}?${parameters.toString()}`;
  const epcQrPayload = [
    "BCD",
    "002",
    "1",
    "SCT",
    "",
    plan.method.name,
    plan.method.iban,
    `EUR${amount}`,
    "",
    "",
    remittance,
    "",
  ].join("\n");
  if (new TextEncoder().encode(epcQrPayload).length > 331) {
    throw new RangeError("epc_qr_payload_too_long");
  }
  return Object.freeze({
    paytoUri,
    epcQrPayload,
    amount,
    currency: "EUR",
    settlementStatus: "handoff-only",
  });
}

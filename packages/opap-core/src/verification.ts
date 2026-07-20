import { OpapError } from "./errors";

export type VerificationLevel = "https-only" | "dnssec-bound";

export function transitionVerificationLevel(
  highestSeen: VerificationLevel | undefined,
  current: VerificationLevel,
): VerificationLevel {
  if (highestSeen === "dnssec-bound" && current === "https-only") {
    throw new OpapError("verification_downgrade");
  }
  return highestSeen === "dnssec-bound" || current === "dnssec-bound"
    ? "dnssec-bound"
    : "https-only";
}

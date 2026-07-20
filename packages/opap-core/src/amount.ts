export function decimalAmountToAtomicUnits(
  amount: string,
  decimals: number,
): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError("invalid_decimals");
  }

  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(amount);
  if (match === null) {
    throw new RangeError("invalid_amount");
  }

  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > decimals) {
    throw new RangeError("amount_precision_exceeded");
  }

  const scale = 10n ** BigInt(decimals);
  const atomic =
    BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (atomic === 0n) {
    throw new RangeError("amount_must_be_positive");
  }
  return atomic;
}

export const SHA256_HEX_SOURCE = "[0-9a-f]{64}";

const SHA256_HEX = new RegExp(`^${SHA256_HEX_SOURCE}$`);

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

export function formatSha256Fingerprint(value: string): `sha256:${string}` {
  return `sha256:${value}`;
}

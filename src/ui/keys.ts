/**
 * `crypto.randomUUID` is only exposed in secure contexts. The board is often
 * opened over a plain-http LAN/WSL address, so build a key defensively and
 * never assume `randomUUID` exists.
 */
export function makeIdempotencyKey(): string {
  const cryptoObj: Crypto | undefined = globalThis.crypto;

  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    try {
      return cryptoObj.randomUUID();
    } catch {
      // fall through to the manual generators
    }
  }

  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

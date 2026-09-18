import { afterEach, describe, expect, it, vi } from "vitest";
import { makeIdempotencyKey } from "../src/ui/keys.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe("makeIdempotencyKey", () => {
  it("uses randomUUID when available", () => {
    expect(makeIdempotencyKey()).toMatch(UUID);
  });

  it("falls back to getRandomValues in a non-secure context", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
        return bytes;
      },
    });
    const key = makeIdempotencyKey();
    expect(key).toMatch(UUID);
    expect(key).not.toBe(makeIdempotencyKey());
  });

  it("still produces a unique key when crypto is entirely absent", () => {
    vi.stubGlobal("crypto", undefined);
    const a = makeIdempotencyKey();
    const b = makeIdempotencyKey();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

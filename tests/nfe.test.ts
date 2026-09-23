import { describe, expect, it, vi } from "vitest";
import { HttpNfeLookupClient, NfeLookupError, normalizeAccessKey } from "../src/server/nfe.ts";

const SAMPLE = {
  accessKey: "31240100874929000140550010005216041964324179",
  nfeNumber: "521604",
  volumes: 1,
  batches: [{ code: "B23L0947", expiry: "2025-06-30", quantity: 20.0 }],
  source: "drive:31240100874929000140550010005216041964324179.xml",
};

function fetchMock(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("normalizeAccessKey", () => {
  it("strips non-digits and accepts exactly 44", () => {
    expect(normalizeAccessKey("3124-0100 874929000140550010005216041964324179")).toBe(SAMPLE.accessKey);
  });

  it("rejects anything that is not 44 digits", () => {
    for (const bad of ["", "1234", "9".repeat(43), "9".repeat(45)]) {
      expect(() => normalizeAccessKey(bad)).toThrow(NfeLookupError);
    }
  });
});

describe("HttpNfeLookupClient", () => {
  it("normalizes the key, hits the endpoint, and returns the payload", async () => {
    const impl = fetchMock(200, SAMPLE);
    const client = new HttpNfeLookupClient("http://nfe-lookup:5000/", impl as unknown as typeof fetch);
    const result = await client.lookup(SAMPLE.accessKey);
    expect(impl).toHaveBeenCalledWith(
      `http://nfe-lookup:5000/nfe/${SAMPLE.accessKey}`,
    );
    expect(result.nfeNumber).toBe("521604");
    expect(result.volumes).toBe(1);
  });

  it("maps upstream status codes to stable error codes", async () => {
    for (const [status, code] of [
      [400, "invalid-access-key"],
      [404, "nfe-not-found"],
      [422, "nfe-unparseable"],
      [503, "nfe-unavailable"],
    ] as const) {
      const impl = fetchMock(status, { error: { message: `boom ${status}` } });
      const client = new HttpNfeLookupClient("http://nfe-lookup:5000", impl as unknown as typeof fetch);
      const err = await client.lookup(SAMPLE.accessKey).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NfeLookupError);
      expect((err as NfeLookupError).status).toBe(status);
      expect((err as NfeLookupError).code).toBe(code);
    }
  });

  it("reports an unreachable service as 502 nfe-unreachable", async () => {
    const impl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const client = new HttpNfeLookupClient("http://nfe-lookup:5000", impl as unknown as typeof fetch);
    const err = await client.lookup(SAMPLE.accessKey).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NfeLookupError);
    expect((err as NfeLookupError).status).toBe(502);
    expect((err as NfeLookupError).code).toBe("nfe-unreachable");
  });

  it("tolerates a non-JSON error body", async () => {
    const impl = vi.fn(async () => new Response("<html>502</html>", { status: 502 }));
    const client = new HttpNfeLookupClient("http://nfe-lookup:5000", impl as unknown as typeof fetch);
    const err = await client.lookup(SAMPLE.accessKey).catch((e: unknown) => e);
    expect((err as NfeLookupError).code).toBe("nfe-unavailable");
  });
});

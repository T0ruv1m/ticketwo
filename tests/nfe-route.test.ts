import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { Store } from "../src/domain/store.ts";
import { createApp } from "../src/server/app.ts";
import { NfeLookupError, type NfeLookupClient, type NfeLookupResult } from "../src/server/nfe.ts";
import { FakeComposer } from "./helpers.ts";

const SAMPLE: NfeLookupResult = {
  accessKey: "31240100874929000140550010005216041964324179",
  nfeNumber: "521604",
  volumes: 3,
  batches: [{ code: "B23L0947", expiry: "2025-06-30", quantity: 20 }],
  source: "drive:test.xml",
};

const openServers: Server[] = [];

async function listen(app: ReturnType<typeof createApp>): Promise<string> {
  const server = app.listen(0);
  openServers.push(server);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const { port } = server.address() as { port: number };
  return `http://localhost:${port}`;
}

afterEach(async () => {
  for (const server of openServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("GET /api/nfe/:key", () => {
  it("proxies a lookup with a normalized key", async () => {
    const lookup = vi.fn(async () => SAMPLE);
    const store = new Store({ composer: new FakeComposer() });
    const app = createApp(store, { nfeClient: { lookup } });
    const base = await listen(app);
    const res = await fetch(`${base}/api/nfe/3124-0100.874929000140550010005216041964324179`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SAMPLE);
    expect(lookup).toHaveBeenCalledWith(SAMPLE.accessKey);
  });

  it("rejects a key that is not 44 digits", async () => {
    const lookup = vi.fn(async () => SAMPLE);
    const store = new Store({ composer: new FakeComposer() });
    const app = createApp(store, { nfeClient: { lookup } });
    const base = await listen(app);
    const res = await fetch(`${base}/api/nfe/1234`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid-access-key");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("maps upstream errors onto their HTTP status and code", async () => {
    const lookup = vi.fn(async () => {
      throw new NfeLookupError(404, "nfe-not-found", "no XML for key");
    });
    const store = new Store({ composer: new FakeComposer() });
    const app = createApp(store, { nfeClient: { lookup } });
    const base = await listen(app);
    const res = await fetch(`${base}/api/nfe/${SAMPLE.accessKey}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("nfe-not-found");
    expect(body.error.message).toBe("no XML for key");
  });

  it("answers 503 when no nfe client is configured", async () => {
    const store = new Store({ composer: new FakeComposer() });
    const app = createApp(store);
    const base = await listen(app);
    const res = await fetch(`${base}/api/nfe/${SAMPLE.accessKey}`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("nfe-disabled");
  });

  it("creates a group whose tickets carry the looked-up nfe number and lote codes", () => {
    const store = new Store({ composer: new FakeComposer() });
    const result = store.addGroup({
      id: SAMPLE.accessKey,
      project: "ACME",
      totalVolumes: SAMPLE.volumes ?? 1,
      nfeNumber: SAMPLE.nfeNumber,
      batches: SAMPLE.batches,
    });
    expect(result.tickets.every((t) => t.nfeNumber === "521604")).toBe(true);
    expect(result.tickets.every((t) => t.batchCodes[0] === "B23L0947")).toBe(true);
    expect(result.group.nfeNumber).toBe("521604");
    const board = store.board();
    expect(board.tickets[0]!.nfeNumber).toBe("521604");
    expect(board.tickets[0]!.batchCodes).toEqual(["B23L0947"]);
  });
});

describe("POST /api/groups without a lookup", () => {
  it("accepts a manually typed nfe number", async () => {
    const store = new Store({ composer: new FakeComposer() });
    const base = await listen(createApp(store));
    const res = await fetch(`${base}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: "ACME", totalVolumes: 2, nfeNumber: "521604" }),
    });
    expect(res.status).toBe(201);
    const board = store.board();
    expect(board.tickets.every((t) => t.nfeNumber === "521604")).toBe(true);
  });

  it("accepts manually typed batch codes", async () => {
    const store = new Store({ composer: new FakeComposer() });
    const base = await listen(createApp(store));
    const res = await fetch(`${base}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: "ACME",
        totalVolumes: 2,
        nfeNumber: "521604",
        codes: ["B23L0947", "B23L0948"],
      }),
    });
    expect(res.status).toBe(201);
    const board = store.board();
    expect(board.tickets.every((t) => t.batchCodes.join(",") === "B23L0947,B23L0948")).toBe(true);
  });

  it("merges manual codes with lookup batches and de-duplicates", async () => {
    const store = new Store({ composer: new FakeComposer() });
    const base = await listen(createApp(store));
    await fetch(`${base}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: "ACME",
        totalVolumes: 2,
        nfeNumber: "521604",
        batches: SAMPLE.batches,
        codes: ["B23L0947", "B23L0948"],
      }),
    });
    const board = store.board();
    expect(board.tickets[0]!.batchCodes).toEqual(["B23L0947", "B23L0948"]);
  });
});

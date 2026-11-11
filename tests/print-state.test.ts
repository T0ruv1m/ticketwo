import { describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/errors.ts";
import { addGroup, makeStore } from "./helpers.ts";

describe("State", () => {
  it("print success moves pending -> printed exactly once", async () => {
    const { store } = makeStore();
    addGroup(store, "G1", 8);
    const result = await store.print("k1");
    expect(result.printed).toBe(true);
    if (result.printed) expect(result.batch.tickets).toHaveLength(8);
    expect(store.board().tickets).toHaveLength(0);
    const second = await store.print("k2");
    expect(second).toEqual({ printed: false, reason: "empty-queue" });
  });

  it("stores optional shipment references and the NF-e barcode in print records only", async () => {
    const { store } = makeStore();
    store.addGroup({
      id: "G1",
      project: "ACME",
      destination: "Berlin",
      totalVolumes: 2,
      nfeNumber: "521604",
      nfeAccessKey: "31240100874929000140550010005216041964324179",
      afOs: "AF 123/2026",
      empenho: "NE 456/2026",
    });

    const result = await store.print("k1");
    if (!result.printed) throw new Error("expected print");

    expect(result.batch.tickets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nfeAccessKey: "31240100874929000140550010005216041964324179",
        afOs: "AF 123/2026",
        empenho: "NE 456/2026",
      }),
    ]));
    expect(store.board().tickets).toEqual([]);
  });

  it("does not mark tickets printed when writing the audit record fails", async () => {
    const { store } = makeStore({
      auditLog: { append: async () => { throw new Error("disk full"); } },
    });
    addGroup(store, "G1", 2);

    await expect(store.print("k1")).rejects.toMatchObject({ code: "audit-write-failed" });
    expect(store.listBatches()).toEqual([]);
    expect(store.board().tickets).toHaveLength(2);
  });

  it("print failure records nothing", async () => {
    const { store, composer } = makeStore();
    composer.behavior = "throw";
    addGroup(store, "G1", 8);
    await expect(store.print("k1")).rejects.toMatchObject({ code: "render-failed" });
    expect(store.listBatches()).toHaveLength(0);
    expect(store.board().tickets).toHaveLength(8);
    expect(store.board().tickets.every((t) => t.status === "pending")).toBe(true);
  });

  it("print timeout records nothing and leaves tickets pending", async () => {
    const { store, composer } = makeStore({ renderTimeoutMs: 20 });
    composer.behavior = "hang";
    addGroup(store, "G1", 3);
    await expect(store.print("k1")).rejects.toMatchObject({ code: "render-timeout" });
    expect(store.listBatches()).toHaveLength(0);
    expect(store.board().tickets).toHaveLength(3);
    composer.release();
  });

  it("batches are immutable: only whole-batch deletion", async () => {
    const { store } = makeStore();
    addGroup(store, "G1", 3);
    await store.print("k1");
    const batch = store.listBatches()[0]!;
    const before = JSON.stringify(batch);
    store.deleteBatch(batch.id);
    expect(store.listBatches()).toHaveLength(0);
    expect(() => store.deleteBatch(batch.id)).toThrow(DomainError);
    expect(before).toContain("G1");
  });

  it("restores a printed batch to the queue without preserving positions", async () => {
    const { store } = makeStore();
    store.addGroup({ id: "G1", project: "ACME", destination: "Berlin", totalVolumes: 3 });
    const printed = await store.print("restore-key");
    if (!printed.printed) throw new Error("expected print");

    store.restoreBatch(printed.batch.id);

    expect(store.listBatches()).toHaveLength(0);
    expect(store.board().tickets.map((ticket) => ticket.status)).toEqual(["pending", "pending", "pending"]);
    expect(store.board().tickets.map((ticket) => ticket.groupId)).toEqual(["G1", "G1", "G1"]);
  });
});

describe("Print contract", () => {
  it("requires an idempotency key", async () => {
    const { store } = makeStore();
    addGroup(store, "G1", 3);
    await expect(store.print("")).rejects.toMatchObject({ code: "invalid-idempotency-key" });
  });

  it("records at most one batch per idempotency key", async () => {
    const { store } = makeStore();
    addGroup(store, "G1", 4);
    const first = await store.print("same-key");
    const second = await store.print("same-key");
    expect(store.listBatches()).toHaveLength(1);
    expect(second.printed).toBe(true);
    if (first.printed && second.printed) {
      expect(second.batch.id).toBe(first.batch.id);
      expect(second.idempotent).toBe(true);
    }
  });

  it("does not resurrect a deleted batch when the key is reused", async () => {
    const { store } = makeStore();
    addGroup(store, "G1", 3);
    const first = await store.print("k1");
    if (!first.printed) throw new Error("expected print");
    store.deleteBatch(first.batch.id);
    addGroup(store, "G2", 2);
    const retry = await store.print("k1");
    expect(retry.printed).toBe(true);
    if (retry.printed) {
      expect(retry.batch.tickets).toHaveLength(2);
      expect(retry.batch.tickets[0]!.groupId).toBe("G2");
    }
    expect(store.listBatches()).toHaveLength(1);
  });

  it("rejects dropping a group with the same id but different attributes", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 3, "ACME", "Berlin");
    expect(() => addGroup(store, "G1", 4, "ACME", "Berlin")).toThrow(DomainError);
  });

  it("returns the existing ticket with duplicate=true for a repeat add", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 3);
    const repeat = store.addGroup({ id: "G1", project: "ACME", destination: "Berlin", totalVolumes: 3 });
    expect(repeat.duplicate).toBe(true);
    expect(repeat.tickets).toHaveLength(3);
    expect(store.board().tickets).toHaveLength(3);
  });
});

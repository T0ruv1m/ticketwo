import { describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/errors.ts";
import { addGroup, makeStore } from "./helpers.ts";

describe("State", () => {
  it("only pending or printed is ever observable", async () => {
    const { store } = makeStore();
    addGroup(store, "G1", 8);
    expect(store.board().tickets.every((t) => t.status === "pending")).toBe(true);
    await store.print("k1");
    expect(store.board().tickets).toHaveLength(0);
    for (const ticket of store.tickets.values()) {
      expect(["pending", "printed"]).toContain(ticket.status);
    }
  });

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

  it("empty-queue print is a no-op with a reason", async () => {
    const { store, composer } = makeStore();
    const result = await store.print("empty");
    expect(result).toEqual({ printed: false, reason: "empty-queue" });
    expect(composer.calls).toHaveLength(0);
    expect(store.listBatches()).toHaveLength(0);
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

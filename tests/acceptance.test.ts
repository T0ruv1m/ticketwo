import { describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/errors.ts";
import { addGroup, gridOccupancy, makeStore, occupiedGroupRuns } from "./helpers.ts";

describe("Grouping", () => {
  it("every ticket belongs to its group", () => {
    const { store } = makeStore();
    const result = store.addGroup({ id: "G1", project: "ACME", destination: "Berlin", totalVolumes: 3 });
    expect(result.tickets).toHaveLength(3);
    expect(result.tickets.every((t) => t.groupId === "G1")).toBe(true);
  });

  it("groups never interleave", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 3);
    addGroup(store, "G2", 2);
    for (const runs of occupiedGroupRuns(store.board())) {
      const seen = new Set<string>();
      let previous: string | undefined;
      for (const run of runs) {
        expect(run).not.toBe(previous);
        expect(seen.has(run)).toBe(false);
        seen.add(run);
        previous = run;
      }
    }
  });
});

describe("Sheets and capacity", () => {
  it("a sheet holds exactly 10 grid tickets", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 10);
    const sheet = store.board().sheets[0]!;
    expect(sheet.kind).toBe("grid");
    expect(sheet.slots).toHaveLength(10);
    expect(sheet.slots!.filter(Boolean)).toHaveLength(10);
  });

  it("fills column-major", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 6);
    expect(gridOccupancy(store.board())).toEqual([
      "G1",
      "G1",
      "G1",
      "G1",
      "G1",
      "G1",
      null,
      null,
      null,
      null,
    ]);
  });

  it("<= 10 volumes -> one grid ticket per volume", () => {
    const { store } = makeStore();
    const result = store.addGroup({ id: "G1", project: "P", totalVolumes: 10 });
    expect(result.tickets).toHaveLength(10);
    expect(result.tickets.map((t) => t.volumeIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.tickets.every((t) => t.kind === "grid")).toBe(true);
  });

  it("> 10 volumes -> exactly one full-page ticket", () => {
    const { store } = makeStore();
    const result = store.addGroup({ id: "G1", project: "P", totalVolumes: 11 });
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0]!.kind).toBe("full");
    expect(result.tickets[0]!.volumeIndex).toBeNull();
  });

  it("a full-page ticket owns its sheet", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 12);
    addGroup(store, "G2", 3);
    const board = store.board();
    const fullSheet = board.sheets.find((s) => s.kind === "full")!;
    expect(fullSheet.ticket?.groupId).toBe("G1");
    const others = board.sheets.filter((s) => s.id !== fullSheet.id);
    expect(others.every((s) => (s.kind === "grid" ? true : s.ticket?.groupId !== "G1"))).toBe(true);
  });

  it("a full-page ticket shows the group total", async () => {
    const { store, composer } = makeStore();
    addGroup(store, "G1", 12);
    await store.print("key");
    const page = composer.calls[0]!.find((p) => p.kind === "full");
    expect(page?.kind).toBe("full");
    if (page?.kind === "full") expect(page.ticket.totalVolumes).toBe(12);
  });
});

describe("Arrangement", () => {
  it("is deterministic and ordered by group id ascending", () => {
    const { store } = makeStore();
    addGroup(store, "G3", 12);
    addGroup(store, "G1", 8);
    addGroup(store, "G2", 5);
    const normalize = () =>
      JSON.stringify(
        store.autoArrange().sheets.map((sheet) =>
          sheet.kind === "grid"
            ? { kind: "grid", slots: (sheet.slots ?? []).map((t) => t?.id ?? null) }
            : { kind: "full", ticket: sheet.ticket?.id ?? null },
        ),
      );
    expect(normalize()).toBe(normalize());
    const groupOrder = store
      .board()
      .sheets.filter((s) => s.kind === "full")
      .map((s) => s.ticket!.groupId);
    expect(groupOrder).toEqual(["G3"]);
  });

  it("wraps whole groups, never splitting", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 8);
    addGroup(store, "G2", 5);
    const board = store.autoArrange();
    const sheet1 = board.sheets[0]!;
    const sheet2 = board.sheets[1]!;
    expect(sheet1.slots!.slice(0, 8).map((t) => t?.groupId)).toEqual(Array(8).fill("G1"));
    expect(sheet1.slots!.slice(8)).toEqual([null, null]);
    expect(sheet2.slots!.slice(0, 5).map((t) => t?.groupId)).toEqual(Array(5).fill("G2"));
    expect(sheet2.slots!.slice(5)).toEqual([null, null, null, null, null]);
  });

  it("gives every ticket a linear position", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 8);
    addGroup(store, "G2", 5);
    const board = store.autoArrange();
    for (const ticket of board.tickets) {
      const pos = board.positions[ticket.id];
      expect(typeof pos).toBe("number");
    }
    expect(board.positions[`t:G1:1`]).toBe(0);
    expect(board.positions[`t:G1:8`]).toBe(7);
    expect(board.positions[`t:G2:1`]).toBe(10);
    expect(board.positions[`t:G2:5`]).toBe(14);
  });
});

describe("Inherited data", () => {
  it("tickets copy group fields at creation", () => {
    const { store } = makeStore();
    const result = store.addGroup({
      id: "G1",
      project: "ACME",
      destination: "Berlin",
      totalVolumes: 8,
    });
    expect(
      result.tickets.every(
        (t) =>
          t.project === "ACME" && t.destination === "Berlin" && t.groupId === "G1" && t.totalVolumes === 8,
      ),
    ).toBe(true);
  });
});

describe("Integrity", () => {
  it("rejects silly volume counts and creates nothing", () => {
    const { store } = makeStore();
    for (const totalVolumes of [0, -1, 2.5, 100001]) {
      expect(() => store.addGroup({ id: `G${totalVolumes}`, project: "P", totalVolumes })).toThrow(
        DomainError,
      );
    }
    expect(store.board().tickets).toHaveLength(0);
    expect(store.groups.size).toBe(0);
  });

  it("rejects empty or whitespace projects", () => {
    const { store } = makeStore();
    expect(() => store.addGroup({ id: "G1", project: "", totalVolumes: 3 })).toThrow(DomainError);
    expect(() => store.addGroup({ id: "G2", project: "   ", totalVolumes: 3 })).toThrow(DomainError);
  });

  it("deleting a group deletes its pending tickets but not batch snapshots", async () => {
    const { store } = makeStore();
    addGroup(store, "G1", 5);
    addGroup(store, "G2", 5);
    await store.print("key");
    addGroup(store, "G1b", 5);
    addGroup(store, "G2b", 5);
    store.deleteGroup("G1b");
    const board = store.board();
    expect(board.tickets.every((t) => t.groupId === "G2b")).toBe(true);
    expect(store.listBatches()[0]!.tickets).toHaveLength(10);
    expect(store.listBatches()[0]!.tickets.some((t) => t.groupId === "G1")).toBe(true);
  });
});

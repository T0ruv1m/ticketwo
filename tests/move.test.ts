import { describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/errors.ts";
import { assertInvariants, keyboardTarget } from "../src/domain/board.ts";
import { addGroup, gridOccupancy, makeStore } from "./helpers.ts";

function setup(groups: [string, number][]) {
  const { store } = makeStore();
  for (const [id, n] of groups) addGroup(store, id, n);
  store.autoArrange();
  return store;
}

describe("Move semantics", () => {
  it("moves a whole grid block, keeping the grabbed index", () => {
    const store = setup([["G1", 3], ["G2", 3]]);
    const sheet = store.board().sheets[0]!;
    const dragged = sheet.slots![0]!;
    store.move(dragged.id, sheet.id, 6);
    expect(gridOccupancy(store.board())).toEqual([
      null, null, null, "G2", "G2", "G2", "G1", "G1", "G1", null,
    ]);
  });

  it("swaps with one other group of equal size", () => {
    const store = setup([["G1", 5], ["G2", 5]]);
    const sheet = store.board().sheets[0]!;
    const dragged = sheet.slots![0]!;
    store.move(dragged.id, sheet.id, 5);
    expect(gridOccupancy(store.board())).toEqual([
      "G2", "G2", "G2", "G2", "G2", "G1", "G1", "G1", "G1", "G1",
    ]);
  });

  it("rejects a partially occupied target range", () => {
    const store = setup([["G1", 3], ["G2", 2]]);
    const board = store.board();
    const sheet = board.sheets[0]!;
    const dragged = sheet.slots![0]!;
    const before = JSON.stringify(board.sheets);
    expect(() => store.move(dragged.id, sheet.id, 3)).toThrow(DomainError);
    expect(JSON.stringify(store.board().sheets)).toBe(before);
  });

  it("rejects a block that does not fit", () => {
    const store = setup([["G1", 8]]);
    const sheet = store.board().sheets[0]!;
    const dragged = sheet.slots![0]!;
    expect(() => store.move(dragged.id, sheet.id, 3)).toThrow(DomainError);
    expect(gridOccupancy(store.board())[0]).toBe("G1");
  });

  it("moves a full-page ticket only between full-page sheets", () => {
    const store = setup([["G1", 12], ["G2", 13], ["G3", 2]]);
    const board = store.board();
    const fullSheets = board.sheets.filter((s) => s.kind === "full");
    const full = fullSheets[0]!.ticket!;
    store.move(full.id, fullSheets[1]!.id, 0);
    const after = store.board();
    const sheetsAfter = after.sheets.filter((s) => s.kind === "full");
    expect(sheetsAfter[0]!.ticket!.groupId).toBe("G2");
    expect(sheetsAfter[1]!.ticket!.groupId).toBe("G1");

    const gridSheet = after.sheets.find((s) => s.kind === "grid")!;
    expect(() => store.move(full.id, gridSheet.id, 0)).toThrow(DomainError);
  });

  it("is immediate, durable, and leaves rejected moves unchanged", () => {
    const store = setup([["G1", 2], ["G2", 2]]);
    const sheet = store.board().sheets[0]!;
    const dragged = sheet.slots![0]!;
    store.move(dragged.id, sheet.id, 4);
    const snapshot = JSON.stringify(store.board().sheets);
    expect(gridOccupancy(store.board()).slice(4, 6)).toEqual(["G1", "G1"]);
    expect(() => store.move(dragged.id, sheet.id, 9)).toThrow(DomainError);
    expect(JSON.stringify(store.board().sheets)).toBe(snapshot);
  });

  it("keeps invariants after every move", () => {
    const store = setup([["G1", 5], ["G2", 5], ["G3", 12]]);
    const sheet = store.board().sheets[0]!;
    const dragged = sheet.slots![0]!;
    store.move(dragged.id, sheet.id, 5);
    assertInvariants(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      store.board().sheets.map((s) =>
        s.kind === "grid"
          ? { id: s.id, kind: "grid" as const, slots: (s.slots ?? []).map((t) => t?.id ?? null) }
          : { id: s.id, kind: "full" as const, ticketId: s.ticket?.id ?? null },
      ),
      store.tickets,
    );
  });
});

describe("Keyboard parity", () => {
  it("computes the same target a drag would use", () => {
    const store = setup([["G1", 8]]);
    const sheet = store.board().sheets[0]!;
    const first = sheet.slots![0]!;
    const target = keyboardTarget(store.rawSheets, store.tickets, first.id, "right");
    expect(target).toEqual({ sheetId: sheet.id, slot: 1 });
    store.move(first.id, target!.sheetId, target!.slot);
    expect(gridOccupancy(store.board())[0]).toBeNull();
    expect(gridOccupancy(store.board()).slice(1, 9)).toEqual(Array(8).fill("G1"));
    expect(gridOccupancy(store.board())[9]).toBeNull();
  });

  it("moves down a row step of 5", () => {
    const store = setup([["G1", 2]]);
    const sheet = store.board().sheets[0]!;
    const first = sheet.slots![0]!;
    const target = keyboardTarget(store.rawSheets, store.tickets, first.id, "down");
    expect(target).toEqual({ sheetId: sheet.id, slot: 5 });
  });

  it("does not move past the grid edge", () => {
    const store = setup([["G1", 1]]);
    const sheet = store.board().sheets[0]!;
    const first = sheet.slots![0]!;
    expect(keyboardTarget(store.rawSheets, store.tickets, first.id, "left")).toBeNull();
    expect(keyboardTarget(store.rawSheets, store.tickets, first.id, "up")).toBeNull();
  });
});

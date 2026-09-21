import { describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/errors.ts";
import { addGroup, gridOccupancy, makeStore } from "./helpers.ts";

type Store = ReturnType<typeof makeStore>["store"];

/** Any id referenced by the board that does not resolve to a pending ticket. */
function ghostIds(store: Store): string[] {
  const ghosts: string[] = [];
  for (const sheet of store.rawSheets) {
    const ids = sheet.kind === "grid" ? sheet.slots : [sheet.ticketId];
    for (const id of ids) {
      if (!id) continue;
      const ticket = store.tickets.get(id);
      if (!ticket || ticket.status !== "pending") ghosts.push(id);
    }
  }
  return ghosts;
}

describe("deleteGroup board cleanup", () => {
  it("frees grid slots so another group can move into the hole", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 3);
    addGroup(store, "G2", 3);
    store.deleteGroup("G1");
    expect(ghostIds(store)).toEqual([]);

    const sheet = store.board().sheets[0]!;
    const g2first = sheet.slots![3]!;
    store.move(g2first.id, sheet.id, 0);
    expect(gridOccupancy(store.board())).toEqual([
      "G2", "G2", "G2", null, null, null, null, null, null, null,
    ]);
  });

  it("lets a new group reuse a hole freed by a deletion", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 3);
    addGroup(store, "G2", 6);
    store.deleteGroup("G1");

    addGroup(store, "G3", 3);
    expect(ghostIds(store)).toEqual([]);
    expect(store.board().sheets).toHaveLength(1);
    expect(gridOccupancy(store.board())).toEqual([
      "G3", "G3", "G3", "G2", "G2", "G2", "G2", "G2", "G2", null,
    ]);
  });

  it("moves into a hole left in the middle of a sheet", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 3);
    addGroup(store, "G2", 3);
    addGroup(store, "G3", 3);
    store.deleteGroup("G2");

    const sheet = store.board().sheets[0]!;
    store.move(sheet.slots![0]!.id, sheet.id, 3);
    expect(gridOccupancy(store.board())).toEqual([
      null, null, null, "G1", "G1", "G1", "G3", "G3", "G3", null,
    ]);
    expect(ghostIds(store)).toEqual([]);
  });

  it("removes a full-page sheet when its group is deleted", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 12);
    addGroup(store, "G2", 13);
    expect(store.board().sheets).toHaveLength(2);

    store.deleteGroup("G1");
    expect(ghostIds(store)).toEqual([]);
    expect(store.board().sheets).toHaveLength(1);
    expect(store.board().sheets[0]!.ticket?.groupId).toBe("G2");
  });

  it("lets a full-page ticket swap onto a sheet freed by deletion", () => {
    const { store } = makeStore();
    addGroup(store, "G1", 12);
    addGroup(store, "G2", 13);
    addGroup(store, "G3", 14);
    store.deleteGroup("G2");

    const sheets = store.board().sheets;
    expect(sheets.map((s) => s.ticket?.groupId)).toEqual(["G1", "G3"]);
    store.move(sheets[0]!.ticket!.id, sheets[1]!.id, 0);
    expect(store.board().sheets.map((s) => s.ticket?.groupId)).toEqual(["G3", "G1"]);
    expect(ghostIds(store)).toEqual([]);
  });

  it("deletes only pending tickets; printed batches survive", async () => {
    const { store } = makeStore();
    addGroup(store, "G1", 3);
    await store.print("k1");
    addGroup(store, "G2", 3);
    store.deleteGroup("G1");

    expect(store.listBatches()).toHaveLength(1);
    expect(store.listBatches()[0]!.tickets.every((t) => t.groupId === "G1")).toBe(true);
    expect(ghostIds(store)).toEqual([]);
  });

  it("rejects deleting an unknown group", () => {
    const { store } = makeStore();
    expect(() => store.deleteGroup("nope")).toThrow(DomainError);
  });
});

import { describe, expect, it } from "vitest";
import { assertInvariants } from "../src/domain/board.ts";
import { isDomainError } from "../src/domain/errors.ts";
import { Store } from "../src/domain/store.ts";
import { FakeComposer } from "./helpers.ts";

/** Deterministic LCG so a failure is reproducible from its seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function makeRandomStore(seed: number): Store {
  let batch = 0;
  return new Store({
    composer: new FakeComposer(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    idFactory: () => `batch-${seed}-${(batch += 1)}`,
  });
}

/**
 * The core structural contract, asserted after every operation:
 *  - every board reference resolves to a pending ticket (no ghosts),
 *  - no ticket appears twice,
 *  - every pending ticket is on the board exactly once,
 *  - capacity / contiguity / full-sheet invariants,
 *  - every pending ticket has a position.
 */
function checkInvariants(store: Store): void {
  assertInvariants(store.rawSheets, store.tickets);

  const seen = new Set<string>();
  for (const sheet of store.rawSheets) {
    const ids = sheet.kind === "grid" ? sheet.slots : [sheet.ticketId];
    for (const id of ids) {
      if (!id) continue;
      const ticket = store.tickets.get(id);
      expect(ticket, `board references missing ticket ${id}`).toBeDefined();
      expect(ticket!.status, `board references non-pending ticket ${id}`).toBe("pending");
      expect(seen.has(id), `ticket ${id} appears twice on the board`).toBe(false);
      seen.add(id);
    }
  }

  for (const ticket of store.tickets.values()) {
    if (ticket.status !== "pending") continue;
    expect(seen.has(ticket.id), `pending ticket ${ticket.id} is missing from the board`).toBe(true);
  }

  const board = store.board();
  for (const ticket of board.tickets) {
    expect(typeof board.positions[ticket.id]).toBe("number");
  }
}

const SIZES = [1, 1, 2, 3, 4, 5, 8, 9, 10, 10, 11, 12, 13, 20];

describe("randomized board operations", () => {
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987]) {
    it(`holds every invariant across a random op sequence (seed ${seed})`, async () => {
      const rand = rng(seed);
      const store = makeRandomStore(seed);
      let counter = 0;

      for (let step = 0; step < 120; step += 1) {
        const roll = rand();

        if (roll < 0.3 || store.groups.size === 0) {
          counter += 1;
          const size = SIZES[Math.floor(rand() * SIZES.length)]!;
          store.addGroup({
            id: `G${counter}`,
            project: "ACME",
            destination: "Berlin",
            totalVolumes: size,
          });
        } else if (roll < 0.55) {
          const ids = [...store.groups.keys()];
          store.deleteGroup(ids[Math.floor(rand() * ids.length)]!);
        } else if (roll < 0.85) {
          const tickets = store.board().tickets;
          const sheets = store.rawSheets;
          if (tickets.length > 0 && sheets.length > 0) {
            const ticket = tickets[Math.floor(rand() * tickets.length)]!;
            const sheet = sheets[Math.floor(rand() * sheets.length)]!;
            const slot = Math.floor(rand() * 10);
            try {
              store.move(ticket.id, sheet.id, slot);
            } catch (error) {
              if (!isDomainError(error)) throw error;
            }
          }
        } else if (roll < 0.92) {
          store.autoArrange();
        } else {
          await store.print(`key-${seed}-${step}`);
        }

        checkInvariants(store);
      }
    });
  }
});

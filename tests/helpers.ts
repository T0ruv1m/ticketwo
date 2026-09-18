import { inflateSync } from "node:zlib";
import type { Composer, PageSpec } from "../src/pdf/composer.ts";
import { Store } from "../src/domain/store.ts";

/** Inflate every FlateDecode stream so tests can assert on rendered text. */
export function extractPdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const chunks: string[] = [];
  const pattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of raw.matchAll(pattern)) {
    const data = Buffer.from(match[1] ?? "", "latin1");
    let content: string;
    try {
      content = inflateSync(data).toString("latin1");
    } catch {
      content = data.toString("latin1");
    }
    chunks.push(
      content.replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_full, hex: string) =>
        Buffer.from(hex, "hex").toString("latin1"),
      ),
    );
  }
  return chunks.join("\n");
}

export class FakeComposer implements Composer {
  calls: PageSpec[][] = [];
  behavior: "ok" | "throw" | "hang" = "ok";
  private hangResolve: (() => void) | null = null;

  async compose(pages: readonly PageSpec[]): Promise<Uint8Array> {
    this.calls.push([...pages]);
    if (this.behavior === "throw") throw new Error("boom");
    if (this.behavior === "hang") {
      await new Promise<void>((resolve) => {
        this.hangResolve = resolve;
      });
    }
    return new TextEncoder().encode(serialize(pages));
  }

  release(): void {
    this.hangResolve?.();
    this.hangResolve = null;
  }
}

function serialize(pages: readonly PageSpec[]): string {
  return JSON.stringify(
    pages.map((page) =>
      page.kind === "full"
        ? { kind: "full", id: page.ticket.id, total: page.ticket.totalVolumes }
        : {
            kind: "grid",
            slots: page.slots.map((t) => (t ? `${t.groupId}#${t.volumeIndex}` : null)),
          },
    ),
  );
}

let idCounter = 0;

export function makeStore(
  overrides: Partial<ConstructorParameters<typeof Store>[0]> = {},
): { store: Store; composer: FakeComposer } {
  const composer = new FakeComposer();
  const store = new Store({
    composer,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    idFactory: () => `batch-${++idCounter}`,
    ...overrides,
  });
  return { store, composer };
}

export function addGroup(
  store: Store,
  id: string,
  totalVolumes: number,
  project = "ACME",
  destination = "Berlin",
): void {
  store.addGroup({ id, project, destination, totalVolumes });
}

export function occupiedGroupRuns(board: ReturnType<Store["board"]>): string[][] {
  return board.sheets.map((sheet) => {
    if (sheet.kind === "full") {
      return sheet.ticket ? [sheet.ticket.groupId] : [];
    }
    const runs: string[] = [];
    for (const ticket of sheet.slots ?? []) {
      if (!ticket) continue;
      if (runs[runs.length - 1] !== ticket.groupId) runs.push(ticket.groupId);
    }
    return runs;
  });
}

export function gridOccupancy(board: ReturnType<Store["board"]>): (string | null)[] {
  const sheet = board.sheets[0];
  if (!sheet || sheet.kind !== "grid") return [];
  return (sheet.slots ?? []).map((t) => (t ? t.groupId : null));
}

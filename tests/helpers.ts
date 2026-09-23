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

export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  size: number;
}

export interface PdfImageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Inflate every content stream and pull out text baselines and image boxes, so
 * a test can assert on the rendered geometry (not just the text) without a
 * PDF renderer.
 */
export function extractPdfGeometry(bytes: Uint8Array): {
  texts: PdfTextItem[];
  images: PdfImageBox[];
} {
  const raw = Buffer.from(bytes).toString("latin1");
  const texts: PdfTextItem[] = [];
  const images: PdfImageBox[] = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of raw.matchAll(streamPattern)) {
    const data = Buffer.from(match[1] ?? "", "latin1");
    let content: string;
    try {
      content = inflateSync(data).toString("latin1");
    } catch {
      content = data.toString("latin1");
    }
    if (!content.includes("BT") && !content.includes("Do")) continue;

    // pdf-lib: "/Helvetica-Bold-123 25 Tf ... 1 0 0 1 <x> <y> Tm <hex> Tj"
    for (const item of content.matchAll(
      /\/[\w-]+ ([\d.]+) Tf[\s\S]*?1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\s*<([0-9A-Fa-f]*)> Tj/g,
    )) {
      texts.push({
        size: Number(item[1]),
        x: Number(item[2]),
        y: Number(item[3]),
        text: Buffer.from(item[4] ?? "", "hex").toString("latin1"),
      });
    }

    // pdf-lib images: translate cm, identity, "w 0 0 h 0 0 cm", identity, then
    // "/Image... Do". Requiring the trailing image op skips rectangles, which
    // share the same leading "1 0 0 1 x y cm" translate.
    for (const box of content.matchAll(
      /1 0 0 1 ([\d.-]+) ([\d.-]+) cm\s+1 0 0 1 0 0 cm\s+([\d.]+) 0 0 ([\d.]+) 0 0 cm\s+1 0 0 1 0 0 cm\s+\/Image[-\w]* Do/g,
    )) {
      images.push({
        x: Number(box[1]),
        y: Number(box[2]),
        width: Number(box[3]),
        height: Number(box[4]),
      });
    }
  }
  return { texts, images };
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

import { createHash, randomUUID } from "node:crypto";
import type { Composer, PageSpec } from "../pdf/composer.ts";
import { A4_PROFILE, type PrintProfile } from "../pdf/profile.ts";
import {
  assertInvariants,
  autoArrange,
  findTicketSheet,
  keyboardTarget,
  moveTicket,
  nextSheetId,
  positionOf,
  removeTickets,
  type MoveDirection,
} from "./board.ts";
import { DomainError, isDomainError } from "./errors.ts";
import {
  buildGroup,
  buildTickets,
  ticketId,
  type CreateGroupInput,
} from "./group.ts";
import { GRID_SLOTS, type Batch, type BatchSnapshot, type Group, type Sheet, type Ticket } from "./types.ts";

export interface BoardSheetView {
  id: string;
  kind: "grid" | "full";
  slots?: (Ticket | null)[];
  ticket?: Ticket | null;
}

export interface BoardView {
  sheets: BoardSheetView[];
  tickets: Ticket[];
  groups: Group[];
  positions: Record<string, number>;
}

export interface CreateGroupResult {
  group: Group;
  tickets: Ticket[];
  duplicate: boolean;
}

export type PrintResult =
  | { printed: true; batch: Batch; idempotent: boolean }
  | { printed: false; reason: "empty-queue" };

export interface StoreOptions {
  composer: Composer;
  profile?: PrintProfile;
  now?: () => Date;
  idFactory?: () => string;
  renderTimeoutMs?: number;
}

export class Store {
  readonly groups = new Map<string, Group>();
  readonly tickets = new Map<string, Ticket>();
  readonly batches: Batch[] = [];
  readonly pdfBytes = new Map<string, Uint8Array>();
  readonly idempotency = new Map<string, string>();

  private sheets: Sheet[] = [];

  get rawSheets(): readonly Sheet[] {
    return this.sheets;
  }
  private readonly composer: Composer;
  private readonly profile: PrintProfile;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly renderTimeoutMs: number;

  constructor(options: StoreOptions) {
    this.composer = options.composer;
    this.profile = options.profile ?? A4_PROFILE;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.renderTimeoutMs = options.renderTimeoutMs ?? 10_000;
  }

  reset(): void {
    this.groups.clear();
    this.tickets.clear();
    this.batches.length = 0;
    this.pdfBytes.clear();
    this.idempotency.clear();
    this.sheets = [];
  }

  addGroup(input: CreateGroupInput): CreateGroupResult {
    const requestedId = input.id?.trim();
    if (requestedId) {
      const existing = this.groups.get(requestedId);
      if (existing) {
        const same =
          existing.project === input.project.trim() &&
          existing.destination === (input.destination ?? "").trim() &&
          existing.totalVolumes === input.totalVolumes &&
          existing.nfeNumber === (input.nfeNumber?.trim() || null) &&
          existing.batches.length === (input.batches?.length ?? 0) &&
          existing.batches.every((batch, i) => batch.code === input.batches?.[i]?.code);
        if (!same) {
          throw new DomainError(
            "duplicate-group-mismatch",
            `group ${requestedId} already exists with different attributes`,
          );
        }
        const pending = this.pendingOf(requestedId);
        return { group: existing, tickets: pending, duplicate: true };
      }
    }

    const group = buildGroup(input, this.now().toISOString());
    const tickets = buildTickets(group);
    this.groups.set(group.id, group);
    for (const ticket of tickets) this.tickets.set(ticket.id, ticket);
    this.placeGroup(tickets);
    this.guard();
    return { group, tickets, duplicate: false };
  }

  deleteGroup(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) throw new DomainError("group-not-found", `no group ${groupId}`);
    const removed: string[] = [];
    for (const [id, ticket] of this.tickets) {
      if (ticket.groupId === groupId && ticket.status === "pending") {
        removed.push(id);
        this.tickets.delete(id);
      }
    }
    this.groups.delete(groupId);
    this.removeTicketsFromBoard(removed);
    this.guard();
  }

  board(): BoardView {
    this.guard();
    const positions: Record<string, number> = {};
    for (const ticket of this.tickets.values()) {
      if (ticket.status !== "pending") continue;
      const pos = positionOf(this.sheets, ticket.id);
      if (pos !== null) positions[ticket.id] = pos;
    }
    return {
      sheets: this.sheets.map((sheet) =>
        sheet.kind === "grid"
          ? {
              id: sheet.id,
              kind: "grid" as const,
              slots: sheet.slots.map((id) => (id ? this.tickets.get(id) ?? null : null)),
            }
          : { id: sheet.id, kind: "full" as const, ticket: sheet.slots[0] ? this.tickets.get(sheet.slots[0]) ?? null : null },
      ),
      tickets: [...this.tickets.values()].filter((t) => t.status === "pending"),
      groups: [...this.groups.values()],
      positions,
    };
  }

  move(ticketIdValue: string, sheetId: string, slot: number): BoardView {
    this.sheets = moveTicket(this.sheets, this.tickets, ticketIdValue, sheetId, slot);
    return this.board();
  }

  autoArrange(): BoardView {
    this.sheets = autoArrange(this.pendingTickets());
    return this.board();
  }

  keyMove(ticketIdValue: string, direction: MoveDirection): BoardView {
    const target = keyboardTarget(this.sheets, this.tickets, ticketIdValue, direction);
    if (!target) return this.board();
    return this.move(ticketIdValue, target.sheetId, target.slot);
  }

  async print(idempotencyKey: string): Promise<PrintResult> {
    if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
      throw new DomainError("invalid-idempotency-key", "idempotency key is required");
    }
    const key = idempotencyKey.trim();
    const existingBatchId = this.idempotency.get(key);
    if (existingBatchId) {
      const batch = this.batches.find((b) => b.id === existingBatchId);
      if (batch) return { printed: true, batch, idempotent: true };
      // The recorded batch was deleted; the key no longer resolves to a record.
      this.idempotency.delete(key);
    }

    const pending = this.pendingTickets();
    if (pending.length === 0) {
      return { printed: false, reason: "empty-queue" };
    }

    const pages = pagesFromSheets(this.sheets, this.tickets);
    let bytes: Uint8Array;
    try {
      bytes = await withTimeout(this.composer.compose(pages, this.profile), this.renderTimeoutMs);
    } catch (error) {
      if (isDomainError(error)) throw error;
      if (error instanceof TimeoutError) {
        throw new DomainError("render-timeout", `render exceeded ${this.renderTimeoutMs}ms`);
      }
      throw new DomainError("render-failed", `render failed: ${(error as Error).message}`);
    }

    const batch: Batch = {
      id: this.idFactory(),
      printedAt: this.now().toISOString(),
      pdfHash: createHash("sha256").update(bytes).digest("hex"),
      tickets: pending.map(snapshot),
    };

    // Atomic commit: only after a complete render.
    this.batches.push(batch);
    this.pdfBytes.set(batch.id, bytes);
    for (const ticket of pending) {
      const stored = this.tickets.get(ticket.id);
      if (stored) stored.status = "printed";
    }
    this.sheets = [];
    this.idempotency.set(key, batch.id);

    return { printed: true, batch, idempotent: false };
  }

  listBatches(): Batch[] {
    return [...this.batches];
  }

  getBatch(batchId: string): Batch {
    const batch = this.batches.find((b) => b.id === batchId);
    if (!batch) throw new DomainError("batch-not-found", `no batch ${batchId}`);
    return batch;
  }

  getPdf(batchId: string): Uint8Array {
    this.getBatch(batchId);
    const bytes = this.pdfBytes.get(batchId);
    if (!bytes) throw new DomainError("batch-not-found", `no PDF for batch ${batchId}`);
    return bytes;
  }

  deleteBatch(batchId: string): void {
    const index = this.batches.findIndex((b) => b.id === batchId);
    if (index < 0) throw new DomainError("batch-not-found", `no batch ${batchId}`);
    this.batches.splice(index, 1);
    this.pdfBytes.delete(batchId);
  }

  private pendingTickets(): Ticket[] {
    return [...this.tickets.values()].filter((t) => t.status === "pending");
  }

  private pendingOf(groupId: string): Ticket[] {
    return this.pendingTickets().filter((t) => t.groupId === groupId);
  }

  private placeGroup(groupTickets: readonly Ticket[]): void {
    const sorted = [...groupTickets].sort(
      (a, b) => (a.volumeIndex ?? 0) - (b.volumeIndex ?? 0),
    );
    if (sorted.length === 0) return;
    if (sorted[0]!.kind === "full") {
      this.sheets.push({ id: nextSheetId(), kind: "full", slots: [sorted[0]!.id] });
      return;
    }
    const size = sorted.length;
    for (const sheet of this.sheets) {
      if (sheet.kind !== "grid") continue;
      const start = firstRun(sheet.slots, size);
      if (start >= 0) {
        sorted.forEach((ticket, i) => {
          sheet.slots[start + i] = ticket.id;
        });
        return;
      }
    }
    const sheet: Sheet = { id: nextSheetId(), kind: "grid", slots: new Array(GRID_SLOTS).fill(null) };
    sorted.forEach((ticket, i) => {
      sheet.slots[i] = ticket.id;
    });
    this.sheets.push(sheet);
  }

  private removeTicketsFromBoard(ticketIds: readonly string[]): void {
    if (ticketIds.length === 0) return;
    this.sheets = removeTickets(this.sheets, ticketIds);
  }

  private guard(): void {
    assertInvariants(this.sheets, this.tickets);
  }
}

function firstRun(slots: readonly (string | null)[], size: number): number {
  let run = 0;
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i] === null) {
      run += 1;
      if (run === size) return i - size + 1;
    } else {
      run = 0;
    }
  }
  return -1;
}

function snapshot(ticket: Ticket): BatchSnapshot {
  return {
    ticketId: ticket.id,
    groupId: ticket.groupId,
    project: ticket.project,
    destination: ticket.destination,
    kind: ticket.kind,
    volumeIndex: ticket.volumeIndex,
    totalVolumes: ticket.totalVolumes,
    nfeNumber: ticket.nfeNumber,
    batchCodes: ticket.batchCodes,
  };
}

export function pagesFromSheets(
  sheets: readonly Sheet[],
  tickets: ReadonlyMap<string, Ticket>,
): PageSpec[] {
  const pages: PageSpec[] = [];
  for (const sheet of sheets) {
    if (sheet.kind === "full") {
      const id = sheet.slots[0];
      if (!id) continue;
      const ticket = tickets.get(id);
      if (ticket) pages.push({ kind: "full", ticket });
      continue;
    }
    pages.push({
      kind: "grid",
      slots: sheet.slots.map((id) => (id ? tickets.get(id) ?? null : null)),
    });
  }
  return pages;
}

class TimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError("timeout")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export { findTicketSheet, ticketId };

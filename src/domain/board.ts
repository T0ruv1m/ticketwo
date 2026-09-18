import { DomainError } from "./errors.ts";
import {
  GRID_COLS,
  GRID_ROWS,
  GRID_SLOTS,
  type GridSheet,
  type Sheet,
  type Ticket,
} from "./types.ts";

let sheetCounter = 0;

export function nextSheetId(prefix = "s"): string {
  sheetCounter += 1;
  return `${prefix}${sheetCounter}`;
}

export function resetSheetIds(): void {
  sheetCounter = 0;
}

export function isGridSheet(sheet: Sheet): sheet is GridSheet {
  return sheet.kind === "grid";
}

export function makeGridSheet(): GridSheet {
  return { id: nextSheetId(), kind: "grid", slots: new Array(GRID_SLOTS).fill(null) };
}

export function cloneSheets(sheets: readonly Sheet[]): Sheet[] {
  return sheets.map((sheet) =>
    sheet.kind === "grid" ? { ...sheet, slots: [...sheet.slots] } : { ...sheet },
  );
}

export function occupiedSlots(sheet: GridSheet): number[] {
  const result: number[] = [];
  for (let i = 0; i < sheet.slots.length; i += 1) {
    if (sheet.slots[i]) result.push(i);
  }
  return result;
}

export function isSheetEmpty(sheet: Sheet): boolean {
  if (sheet.kind === "full") return sheet.ticketId === null;
  return sheet.slots.every((slot) => slot === null);
}

export function pruneSheets(sheets: Sheet[]): Sheet[] {
  return sheets.filter((sheet) => !isSheetEmpty(sheet));
}

export function findTicketSheet(
  sheets: readonly Sheet[],
  ticketId: string,
): { sheet: Sheet; index: number } | null {
  for (let index = 0; index < sheets.length; index += 1) {
    const sheet = sheets[index];
    if (!sheet) continue;
    if (sheet.kind === "full") {
      if (sheet.ticketId === ticketId) return { sheet, index };
    } else if (sheet.slots.includes(ticketId)) {
      return { sheet, index };
    }
  }
  return null;
}

export function blockFor(
  sheet: Sheet,
  tickets: ReadonlyMap<string, Ticket>,
  groupId: string,
): string[] {
  if (sheet.kind === "full") {
    return sheet.ticketId && tickets.get(sheet.ticketId)?.groupId === groupId
      ? [sheet.ticketId]
      : [];
  }
  const ids = sheet.slots.filter((id): id is string => id !== null);
  return ids
    .filter((id) => tickets.get(id)?.groupId === groupId)
    .sort((a, b) => volumeOf(tickets.get(a)) - volumeOf(tickets.get(b)));
}

function volumeOf(ticket: Ticket | undefined): number {
  return ticket?.volumeIndex ?? 0;
}

export function slotOf(sheet: GridSheet, ticketId: string): number {
  return sheet.slots.indexOf(ticketId);
}

export function blockSlots(sheet: GridSheet, block: readonly string[]): number[] {
  return block.map((id) => slotOf(sheet, id)).sort((a, b) => a - b);
}

/**
 * Rebuild the board from pending tickets. Groups are ordered by id ascending and
 * packed whole; a grid group never splits across sheets, a full group owns a
 * sheet. Deterministic: identical input yields a slot-for-slot identical board.
 */
export function autoArrange(pending: readonly Ticket[]): Sheet[] {
  const byGroup = new Map<string, Ticket[]>();
  for (const ticket of pending) {
    const list = byGroup.get(ticket.groupId) ?? [];
    list.push(ticket);
    byGroup.set(ticket.groupId, list);
  }

  const groupIds = [...byGroup.keys()].sort((a, b) => a.localeCompare(b));
  const sheets: Sheet[] = [];

  for (const groupId of groupIds) {
    const groupTickets = byGroup.get(groupId)!;
    const sorted = [...groupTickets].sort((a, b) => volumeOf(a) - volumeOf(b));

    if (sorted[0]!.kind === "full") {
      sheets.push({ id: nextSheetId(), kind: "full", ticketId: sorted[0]!.id });
      continue;
    }

    const last = sheets[sheets.length - 1];
    let target: GridSheet;
    if (last && last.kind === "grid" && occupiedSlots(last).length + sorted.length <= GRID_SLOTS) {
      target = last;
    } else {
      target = makeGridSheet();
      sheets.push(target);
    }
    const start = occupiedSlots(target).length;
    sorted.forEach((ticket, i) => {
      target.slots[start + i] = ticket.id;
    });
  }

  return sheets;
}

export interface MoveTarget {
  sheetId: string;
  slot: number;
}

export function moveTicket(
  sheets: readonly Sheet[],
  tickets: ReadonlyMap<string, Ticket>,
  ticketId: string,
  targetSheetId: string,
  targetSlot: number,
): Sheet[] {
  const ticket = tickets.get(ticketId);
  if (!ticket || ticket.status !== "pending") {
    throw new DomainError("ticket-not-found", `no pending ticket ${ticketId}`);
  }
  const source = findTicketSheet(sheets, ticketId);
  if (!source) {
    throw new DomainError("ticket-not-found", `ticket ${ticketId} is not on the board`);
  }
  const target = sheets.find((sheet) => sheet.id === targetSheetId);
  if (!target) {
    throw new DomainError("invalid-target", `no sheet ${targetSheetId}`);
  }

  if (ticket.kind === "full") {
    return moveFull(sheets, tickets, ticketId, target);
  }
  return moveGrid(sheets, tickets, ticket, source.sheet as GridSheet, target, targetSlot);
}

function moveGrid(
  sheets: readonly Sheet[],
  tickets: ReadonlyMap<string, Ticket>,
  ticket: Ticket,
  sourceSheet: GridSheet,
  target: Sheet,
  targetSlot: number,
): Sheet[] {
  if (target.kind !== "grid") {
    throw new DomainError("invalid-target", "a grid ticket cannot move onto a full-page sheet");
  }
  const block = blockFor(sourceSheet, tickets, ticket.groupId);
  const k = block.indexOf(ticket.id);
  if (k < 0) {
    throw new DomainError("ticket-not-found", `ticket ${ticket.id} is not in its group block`);
  }

  const start = targetSlot - k;
  if (!Number.isInteger(start) || start < 0 || start + block.length > GRID_SLOTS) {
    throw new DomainError("out-of-bounds", "block does not fit at that slot");
  }

  const range = Array.from({ length: block.length }, (_, i) => start + i);
  const occupantIds = range
    .map((slot) => target.slots[slot])
    .filter((id): id is string => id !== null);
  const otherIds = occupantIds.filter((id) => !block.includes(id));

  const next = cloneSheets(sheets);
  const nextTarget = next.find((sheet) => sheet.id === target.id) as GridSheet;

  if (otherIds.length === 0) {
    removeBlock(next, block);
    placeBlock(nextTarget, start, block);
    return pruneSheets(next);
  }

  if (otherIds.length !== range.length) {
    throw new DomainError("collision", "target range is only partially occupied");
  }

  const otherGroupId = tickets.get(otherIds[0]!)?.groupId;
  if (!otherGroupId || otherIds.some((id) => tickets.get(id)?.groupId !== otherGroupId)) {
    throw new DomainError("collision", "target range holds more than one group");
  }
  const otherBlock = blockFor(target, tickets, otherGroupId);
  if (otherBlock.length !== block.length) {
    throw new DomainError("collision", "target group has a different size");
  }
  const otherSlots = blockSlots(target, otherBlock);
  if (otherSlots.join(",") !== range.join(",")) {
    throw new DomainError("collision", "target group does not exactly fill the range");
  }

  const nextSource = next.find((sheet) => sheet.id === sourceSheet.id) as GridSheet;
  const sourceSlots = blockSlots(sourceSheet, block);
  const srcStart = sourceSlots[0]!;

  removeBlock(next, block);
  removeBlock(next, otherBlock);
  placeBlock(nextTarget, start, block);
  placeBlock(nextSource, srcStart, otherBlock);
  return pruneSheets(next);
}

function moveFull(
  sheets: readonly Sheet[],
  tickets: ReadonlyMap<string, Ticket>,
  ticketId: string,
  target: Sheet,
): Sheet[] {
  if (target.kind !== "full") {
    throw new DomainError("full-page-on-grid", "a full-page ticket may only move to a full-page sheet");
  }
  if (target.ticketId === ticketId) {
    return cloneSheets(sheets);
  }

  const source = findTicketSheet(sheets, ticketId)!;
  const otherTicketId = target.ticketId;
  const next = cloneSheets(sheets);
  const nextTarget = next.find((sheet) => sheet.id === target.id);
  if (!nextTarget || nextTarget.kind !== "full") {
    throw new DomainError("invalid-target", `no sheet ${target.id}`);
  }
  const nextSource = next.find((sheet) => sheet.id === source.sheet.id);
  if (!nextSource || nextSource.kind !== "full") {
    throw new DomainError("invalid-target", "full-page ticket source is not a full-page sheet");
  }

  nextSource.ticketId = otherTicketId;
  nextTarget.ticketId = ticketId;
  void tickets;
  return pruneSheets(next);
}

function removeBlock(sheets: Sheet[], block: readonly string[]): void {
  for (const sheet of sheets) {
    if (sheet.kind !== "grid") continue;
    for (let i = 0; i < sheet.slots.length; i += 1) {
      const id = sheet.slots[i];
      if (id && block.includes(id)) sheet.slots[i] = null;
    }
  }
}

function placeBlock(sheet: GridSheet, start: number, block: readonly string[]): void {
  block.forEach((id, i) => {
    sheet.slots[start + i] = id;
  });
}

export type MoveDirection = "left" | "right" | "up" | "down" | "page-up" | "page-down";

export function keyboardTarget(
  sheets: readonly Sheet[],
  tickets: ReadonlyMap<string, Ticket>,
  ticketId: string,
  direction: MoveDirection,
): MoveTarget | null {
  const found = findTicketSheet(sheets, ticketId);
  if (!found) return null;
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  if (found.sheet.kind === "full") {
    if (direction === "left" || direction === "up" || direction === "page-up") {
      return adjacentSheet(sheets, found.index, -1);
    }
    if (direction === "right" || direction === "down" || direction === "page-down") {
      return adjacentSheet(sheets, found.index, 1);
    }
    return null;
  }

  const sheet = found.sheet;
  const slot = slotOf(sheet, ticketId);
  const delta =
    direction === "left" ? -1 : direction === "right" ? 1 : direction === "up" ? -GRID_ROWS : direction === "down" ? GRID_ROWS : 0;

  if (direction === "page-up" || direction === "page-down") {
    return adjacentSheet(sheets, found.index, direction === "page-up" ? -1 : 1, slot);
  }

  const nextSlot = slot + delta;
  if (nextSlot < 0 || nextSlot >= GRID_SLOTS) return null;
  return { sheetId: sheet.id, slot: nextSlot };
}

function adjacentSheet(
  sheets: readonly Sheet[],
  index: number,
  step: number,
  slot = 0,
): MoveTarget | null {
  const nextIndex = index + step;
  const sheet = sheets[nextIndex];
  if (!sheet) return null;
  return { sheetId: sheet.id, slot: sheet.kind === "grid" ? Math.min(slot, GRID_SLOTS - 1) : 0 };
}

export function positionOf(
  sheets: readonly Sheet[],
  ticketId: string,
): number | null {
  let base = 0;
  for (const sheet of sheets) {
    if (sheet.kind === "full") {
      if (sheet.ticketId === ticketId) return base;
      base += 1;
      continue;
    }
    const slot = slotOf(sheet, ticketId);
    if (slot >= 0) return base + slot;
    base += GRID_SLOTS;
  }
  return null;
}

export function assertInvariants(sheets: readonly Sheet[], tickets: ReadonlyMap<string, Ticket>): void {
  for (const sheet of sheets) {
    if (sheet.kind === "full") {
      if (sheet.ticketId) {
        const t = tickets.get(sheet.ticketId);
        if (!t || t.kind !== "full") {
          throw new Error(`full sheet ${sheet.id} does not hold a full ticket`);
        }
      }
      continue;
    }
    const occupied = occupiedSlots(sheet);
    if (occupied.length > GRID_SLOTS) {
      throw new Error(`sheet ${sheet.id} over capacity`);
    }
    const groupRuns: string[] = [];
    for (const slot of occupied) {
      const id = sheet.slots[slot]!;
      const groupId = tickets.get(id)!.groupId;
      if (groupRuns[groupRuns.length - 1] !== groupId) groupRuns.push(groupId);
    }
    for (let i = 1; i < groupRuns.length; i += 1) {
      if (groupRuns[i] === groupRuns[i - 1]) {
        throw new Error(`group ${groupRuns[i]} interleaves on sheet ${sheet.id}`);
      }
    }
    const seen = new Set<string>();
    for (const groupId of groupRuns) {
      if (seen.has(groupId)) {
        throw new Error(`group ${groupId} is split on sheet ${sheet.id}`);
      }
      seen.add(groupId);
    }
  }
}

export const geometry = { cols: GRID_COLS, rows: GRID_ROWS, slots: GRID_SLOTS } as const;

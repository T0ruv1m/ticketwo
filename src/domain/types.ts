export type TicketKind = "grid" | "full";
export type TicketStatus = "pending" | "printed";

export interface Group {
  id: string;
  project: string;
  destination: string;
  totalVolumes: number;
  createdAt: string;
}

export interface Ticket {
  id: string;
  groupId: string;
  project: string;
  destination: string;
  kind: TicketKind;
  volumeIndex: number | null;
  totalVolumes: number;
  status: TicketStatus;
}

export interface GridSheet {
  id: string;
  kind: "grid";
  slots: (string | null)[];
}

export interface FullSheet {
  id: string;
  kind: "full";
  ticketId: string | null;
}

export type Sheet = GridSheet | FullSheet;

export interface BatchSnapshot {
  ticketId: string;
  groupId: string;
  project: string;
  destination: string;
  kind: TicketKind;
  volumeIndex: number | null;
  totalVolumes: number;
}

export interface Batch {
  id: string;
  printedAt: string;
  pdfHash: string;
  tickets: BatchSnapshot[];
}

export const GRID_SLOTS = 10;
export const GRID_COLS = 2;
export const GRID_ROWS = 5;

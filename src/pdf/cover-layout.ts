import type { Ticket } from "../domain/types.ts";

/** Measured in points from the top-left of docs/capa.pdf. */
export const COVER = {
  width: 595.32,
  height: 841.92,
  fontSize: 48,
  maxTextWidth: 523.32,
  logo: { x: 111.6, y: 61.08, width: 144.48, height: 31.32 },
  baselines: [207.72, 428.16, 648.6],
  frame: [
    { x: 27, y: 27, width: 541.32, height: 3 },
    { x: 27, y: 30, width: 3, height: 784.92 },
    { x: 565.32, y: 30, width: 6, height: 787.92 },
    { x: 30, y: 811.92, width: 541.32, height: 6 },
  ],
} as const;

export function coverLines(ticket: Ticket): string[] {
  return [
    (ticket.destination || "—").toUpperCase(),
    ticket.nfeNumber ? `NF ${ticket.nfeNumber}` : "NF",
    `${ticket.totalVolumes} VOLUMES`,
  ];
}

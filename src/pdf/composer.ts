import type { Ticket } from "../domain/types.ts";
import type { PrintProfile } from "./profile.ts";

export interface GridPageSpec {
  kind: "grid";
  /** Column-major, length = cols * rows. null = empty slot. */
  slots: (Ticket | null)[];
}

export interface FullPageSpec {
  kind: "full";
  ticket: Ticket;
}

export type PageSpec = GridPageSpec | FullPageSpec;

/**
 * The single seam between our print contract and whatever layout library is
 * used. Swappable and fakeable; the rest of the system never sees pdf-lib.
 */
export interface Composer {
  compose(pages: readonly PageSpec[], profile: PrintProfile): Promise<Uint8Array>;
}

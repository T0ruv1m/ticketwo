# Lote (batch) modelling: what the full-page ticket exposed

Notes on a domain mismatch surfaced while fixing the full-page PDF layout.

## The observation

A full-page ticket is one label for a whole group (a group with more than 10
volumes collapses to a single `full` ticket). It was printing the group's lote
codes as per-box checkboxes — the same row the grid cards use. But a full page
does not represent one box. There is nothing on it to tick. The checkboxes had
no referent.

## The mismatch

A lote is a **per-box** concept. The checkbox asks "does this box belong to
lote X?". That question only makes sense on a card that stands for a single
volume — i.e. a grid ticket.

But the data lives at the **group** level:

- `Group.batches` holds `{ code, expiry, quantity }`, from the NF-e lookup.
- `buildTickets` copies `group.batches.map((b) => b.code)` onto **every**
  ticket, including the one full-page ticket.
- The PDF and the UI both render that copy.

So the full ticket inherits per-box data it cannot use, and the model offers no
signal that the data is inapplicable there.

## Current fix

The full page no longer renders lotes (`src/pdf/pdf-lib-composer.ts`). Grid
cards still do. This is a presentation-level patch: the domain still carries
`batchCodes` on the full ticket.

## Open questions

1. **Is a lote a property of a volume or of the group?** Today it is stored on
   the group and sprayed onto every ticket. If lotes really track boxes, a
   ticket should reference the specific lote(s) it belongs to, not carry the
   whole list. That would make the full-page case empty by construction.
2. **Quantity vs volumes.** A batch has a `quantity`; a group has
   `totalVolumes`. Nothing forces them to agree, so "one checkbox per lote per
   card" is already ambiguous: is the operator ticking that the box is in the
   lote, or that the lote exists?
3. **`Ticket.batchCodes` duplicates `Group.batches`.** Same shape of problem as
   the board/registry split: derived data kept in two places. The copy is what
   the immutable print snapshot records, so it is not obviously removable — but
   the duplication should be intentional, not incidental.
4. **The UI full card still shows "Lote …"** (`src/ui/main.ts`, `cardHtml`).
   Should it, for consistency with the PDF? It has the same no-referent issue.

## Bottom line

The PDF overlap was cosmetic. Underneath it is a modelling question: lotes are
per-box, but they are stored per-group and copied onto a ticket that stands for
many boxes. The fix stopped the full page from drawing something meaningless;
it did not resolve whether the data belongs where it is. Worth a decision before
per-volume lote tracking is ever needed.

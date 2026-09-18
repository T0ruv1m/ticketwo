# tickets — spec

Loose notes on what this thing should be. Not a formal spec. Meant to be argued
with and rewritten.

## The idea

A little tool for arranging and printing **tickets** — little cards you stick on
physical things (boxes, packages, volumes). You collect a bunch of them, lay
them out on pages, rearrange until it looks right, then print the whole batch.

That's it. The two hard parts are the arranging (should feel good) and the
printing (should be boring and reliable). Everything else is bookkeeping.

## Words I'm using

- **Group** — the thing being shipped, and the unit everything is organized
  around. A shipment. Tickets belong to a group.
- **Ticket** — one card. One physical volume of a group. Knows its group and its
  index within it ("3 of 12").
- **Sheet** — one printed page, holding a fixed grid of tickets.
- **Batch** — the set of tickets you print together in one go.
- **Board** — the screen where you arrange tickets onto sheets.
- **Full-page ticket** — a ticket that takes a whole page by itself instead of
  sharing a grid slot. Some things just need to be big.

## Acceptance examples (the non-negotiables, executable)

These replace prose rules. Each example is runnable at the system boundary: set
up the queue, act, assert the board / batch / PDF. Identifiers are illustrative;
the numbers are the contract.

### Grouping

- A ticket always belongs to a group.
  - Given a group `G1` with 3 volumes, then all 3 tickets report `groupId = G1`.
- Tickets from the same group never interleave with another group.
  - Given `G1` (3) and `G2` (2), when arranged, then each sheet's occupied slots
    read as one contiguous `G1` run and one contiguous `G2` run. No sheet reads
    `G1, G2, G1`.

### Sheets and capacity

- A sheet holds exactly 10 grid tickets, 2 columns × 5 rows.
  - Given any board, then every grid sheet has ≤ 10 occupied slots, slot indices
    0–4 are column 1 (top→bottom), and 5–9 are column 2 (top→bottom).
- Filling is column-major.
  - Given `G1` (6), then sheet 1 slots 0–5 are occupied and slots 6–9 are empty.
- ≤ 10 volumes → one grid ticket per volume.
  - Given `G1` (10), then there are 10 grid tickets with `volumeIndex` 1..10.
- > 10 volumes → exactly one full-page ticket.
  - Given `G1` (11), then there is exactly 1 ticket with `kind = full` and
    `volumeIndex = null`. Not 11 tickets, not a sprawl across 2 sheets.
- A full-page ticket owns its sheet.
  - Given `G1` (12) and `G2` (3), then the sheet holding the `G1` full-page
    ticket contains no other ticket, and the full-page ticket occupies no grid
    slot.
- A full-page ticket shows the group total prominently.
  - Given `G1` (12), then the printed full-page page contains the text `12`.

### Arrangement

- Ordering is deterministic.
  - Given groups `G1` (8), `G2` (5), `G3` (12), when auto-arranged twice, then
    the two boards are slot-for-slot identical, and groups are ordered by group
    identifier ascending (default; see Open decisions).
- Groups wrap whole, never split.
  - Given `G1` (8) and `G2` (5), when auto-arranged, then sheet 1 slots 0–7 =
    `G1`, sheet 1 slots 8–9 empty, sheet 2 slots 0–4 = `G2`, sheet 2 slots 5–9
    empty.
- Every ticket has a position.
  - Given a board, then each ticket exposes a position equal to its linear slot
    index across sheets in order.

### State

- Only `pending` or `printed`.
  - Given any sequence of operations, then every ticket's status is `pending` or
    `printed`; no other value is ever observable.
- Print success moves pending → printed exactly once.
  - Given 8 pending tickets, when print succeeds, then the batch contains 8
    tickets, the board is empty, and a subsequent print reports the empty queue.
- Print failure records nothing.
  - Given 8 pending tickets, when the print step fails, then there are 0 batches
    and all 8 tickets remain `pending`.
- Batches are immutable.
  - Given a recorded batch, then no operation edits it or removes part of it;
    only whole-batch deletion is allowed.

### Inherited data

- Tickets copy what they need at creation.
  - Given `G1` (project `ACME`, destination `Berlin`, 8 volumes), then every
    ticket reports `project = ACME`, `destination = Berlin`, `groupId = G1`
    without consulting the group again.

### Integrity

- Volume counts are integers ≥ 1.
  - Given `totalVolumes` in {0, -1, 2.5, 100001}, then creation is rejected and
    no tickets are created.
- Full-page tickets have no volume index.
  - Given a full-page ticket, then `volumeIndex = null`.
- Every ticket has a project.
  - Given an empty or whitespace project, then creation is rejected.
- Deleting a group deletes its pending tickets.
  - Given `G1` (5 pending) and `G2` (5 pending), when `G1` is deleted, then the
    board and pending list contain only `G2`; any batch snapshots that already
    contained `G1` remain unchanged.

## The flow

1. Tickets get added to a queue. Sometimes one at a time, sometimes as a group
   at once: "this shipment has 8 boxes" becomes 8 tickets, "this shipment has 12
   boxes" becomes one full-page ticket, per the capacity rule above.
2. You arrange them on the board.
3. You hit print. Everything queued goes out as one batch.
4. Printed tickets leave the queue and land in a history of past batches.

Nothing should ever be marked "printed" unless it actually printed. If the
print fails, it stays queued. This is important — false printed records are
worse than a failed print.

## The board

This is the part I care about most, because it's the part that currently feels
bad.

- Tickets sit in a grid on sheets. Moving a ticket from one slot to another
  should be **drag and drop**. Grab a card, drop it somewhere, done.
- While you drag, the other cards should shift out of the way in a way that's
  obvious and predictable. No surprises about where things will land.
- The move sticks immediately. There is no "save layout" button.
- You can also move a card without a mouse — arrow keys or something. Drag-only
  is not acceptable.
- Full-page tickets are atomic. They own a whole sheet and can't be dropped into
  a grid slot or split across pages.
- Empty slots are visible, so you can tell how full a page is at a glance.
- If there are several sheets, you can flip between them, and there should be
  some small overview that shows what's on every page without flipping.

There's also an auto-arrange button ("just tidy this up") that groups related
tickets together and packs pages in a predictable order. Nice to have, not the
main way of arranging.

## Printing

The current printing is flaky and I don't trust it. Requirements:

- **Deterministic.** Same queue in, same output out. Every time. Not "it depends
  on the browser."
- **Server-side.** We compose the page ourselves. We do not hand layout over to
  the browser's print dialog or to whatever print styles happen to apply.
- **All or nothing.** A print either fully works and gets recorded once, or it
  fails loudly and records nothing. It must not hang waiting on some event that
  may never fire.
- **Testable.** I want to test the printed output without a human clicking
  "print" in a real browser.
- **Physically correct.** Page size, margins, and the grid have to match the
  real paper exactly. The layout library choice is open — pick whatever gives
  us programmatic, reproducible output, and keep it behind our own interface.

## Audit

- Every printed batch gets an immutable record: a batch id, when it happened,
  and which tickets it contained.
- Records are never edited. They're either there as a whole batch or gone as a
  whole batch.
- The point is a trustworthy paper trail (and eventually feeding some legacy
  system that wants to know what was printed).

## Edge cases / stuff to figure out

- Adding a ticket that's already queued — show it, don't silently duplicate.
- Silly volume counts (zero, negative, absurdly large) — reject or clamp.
- Printing an empty queue — no-op, tell the user.
- A full-page ticket and grid tickets must never collide on the same sheet.
- Deleting something should clean up whatever it left behind.
- A print attempt that gets abandoned shouldn't strand tickets as "printing"
  forever.
- Clearing printed items is destructive — make it deliberate.

## Data model

- **Group** — `{ id, project, destination, totalVolumes, createdAt }`. `id` is
  caller-supplied or generated and unique. `totalVolumes` is fixed at creation
  and immutable.
- **Ticket** — `{ id, groupId, project, destination, kind, volumeIndex,
  totalVolumes, status }`.
  - `kind ∈ {grid, full}`.
  - Grid identity is `(groupId, volumeIndex)` with `volumeIndex ∈ 1..totalVolumes`.
  - Full-page identity is `(groupId)` with `volumeIndex = null`.
  - `project`, `destination`, `groupId`, and `totalVolumes` are copies captured
    at creation and never re-read upstream.
  - `status ∈ {pending, printed}`; no transient state.
- **Sheet** — derived, not first-class. A grid sheet is 10 slots (2×5,
  column-major); a full-page sheet is 1 slot. Sheet identifiers are ephemeral:
  auto-arrange may regenerate them, so clients must not persist a sheet id
  across operations.
- **Batch** — `{ id, printedAt, pdfHash, tickets: [snapshot] }`, immutable.
  Snapshots are independent copies: deleting a group or its tickets never
  mutates a recorded batch.
- **Board** — the ordered set of sheets holding pending tickets. Printed tickets
  are not on the board.

## Move semantics

- A move names a ticket and a target `(sheet, slot)`. There is no separate
  "layout" object and no save step.
- **Grid block move.** Moving any grid ticket moves its entire group block. If
  the dragged ticket is at index `k` of its block and the target slot is `s`,
  the block starts at `s − k` and must fit within slots `0..9`.
- **Collision policy (default).**
  1. target range empty → place;
  2. target range exactly occupied by one other group of equal size → swap;
  3. otherwise → reject with a typed error and leave the board unchanged.
- **Full-page move.** A full-page ticket may move only to a full-page sheet
  (swapping with whatever is there). Dropping it on a grid slot is rejected.
- **Immediate and durable.** A successful move is visible on the next read; a
  rejected move changes nothing.
- **Keyboard parity.** Arrow keys move a focused ticket by one slot (left/right)
  or one row step of 5 (up/down); PageUp/PageDown move across sheets. Every
  keyboard move is equivalent to a drag to the resulting slot, and every drag is
  expressible with the keyboard.
- **Invariants after every move:** grid sheet ≤ 10 tickets, groups contiguous,
  no interleaving, full-page tickets alone on their sheet.

## Print contract

- **Geometry.** The print profile selects paper and grid. Default: A4
  (210×297 mm), 10 mm margins, 5 mm gutters, 2×5 grid. The layout library is
  hidden behind a composer interface; the profile is data, not code.
- **Template.**
  - Grid ticket: index line `"n of N"`, project, destination, group id.
  - Full-page ticket: group total volume count rendered prominently, plus
    project, destination, group id.
- **Empties.** Empty grid slots print as empty outlines so page fullness is
  visible. Trailing empty sheets are not emitted.
- **Determinism.** Same queue + same profile → byte-identical PDF. Producer,
  creator, and dates are pinned; no random ids or timestamps in output.
- **Idempotency.** Each print request carries a client-supplied idempotency key.
  The server records at most one batch per key; retrying the same key returns the
  existing batch instead of printing again. This is what makes "actually printed
  but the response was lost" safe.
- **Timeout / failure classification.** Rendering is bounded by a timeout (10 s
  default). On timeout or render error → no batch, tickets stay `pending`, a
  typed error is returned. On success → the batch is committed and tickets are
  marked printed atomically.
- **All or nothing.** Commit happens only after a complete render. No path marks
  a ticket printed without a recorded batch.

## Open decisions

Defaults chosen so a next agent can build without guessing. Each row is
explicitly changeable; change the default in one place and update the matching
acceptance example.

| Decision | Chosen default | Why / notes |
| --- | --- | --- |
| Paper & grid | A4, 10 mm margin, 5 mm gutter, 2×5 | Matches "physically correct"; profile is data |
| Auto-arrange primary order | group id ascending | Deterministic; no other key was specified |
| Tie-break | group id ascending | Only meaningful if the primary key changes |
| Group collision on move | place if free; swap if exact equal-size group; else reject | Predictable, preserves contiguity |
| Full-page move | swap between full-page sheets only | Keeps full-page atomic |
| Duplicate queued add | return the existing ticket with `duplicate = true` | "Show it, don't silently duplicate" |
| Empty-queue print | success with `printed = false`, `reason = empty-queue` | Not an error; tells the user |
| Volume bounds | integer `1..100000`; reject outside | "Reject or clamp" resolved to reject |
| `totalVolumes` lifecycle | fixed at creation; incremental adds capped at it; no post-hoc conversion to full-page | Keeps the capacity rule well-defined |
| Empty slots on print | render as outlines | Makes page fullness visible on paper |
| Sheet identity | ephemeral / derived | Auto-arrange regenerates sheets |
| Batch deletion | whole batch only | Immutable records; deletion is deliberate |
| Snapshot independence | batch snapshots survive group/ticket deletion | Audit is a paper trail |
| Print idempotency | client key, at-most-once batch | Handles lost responses |
| Print timeout | bounded (10 s default) | "Must not hang" |
| Determinism scope | PDF bytes | Batch id/timestamp are not deterministic |

## Things I don't care about yet

- The actual printer/hardware.
- Where the ticket data originally comes from. Ingest, import, whatever — not
  this tool's problem.
- The legacy system integration. We just need the audit record that makes it
  possible later.

# Board fixes, plain and simple

Same review as before, just said like a person.

## The short version

The delete bug is patched. But the code is shaped in a way that keeps inviting
the same bug back. Four things to change, easiest first.

## What's actually wrong

**1. The board and the ticket list can disagree, and nobody checks.**

The board (`this.sheets`) holds ticket ids. The tickets map (`this.tickets`)
holds the real tickets. A slot can point at a ticket that's already gone. The
only checker is `assertInvariants` (`src/domain/board.ts:349`), and only tests
call it. So in real life, nothing stops a ghost id.

Small correction to the earlier note: it's not really "two sources of truth."
The board is the only place placement lives. The real problem is a broken link
that nobody validates.

**2. The screen hides the mess instead of complaining.**

`board()` turns a missing ticket into `null` (`src/domain/store.ts:146` and
`:148`). So a broken slot looks like a normal empty slot. That's why the bug
looked like "empty slot won't accept a drop" instead of an error.

One gotcha: `assertInvariants` would crash with a confusing `TypeError` on a
ghost grid id (`src/domain/board.ts:367`), so it needs a real "does this id
exist?" check first.

**3. Full pages and grid pages store their ids in two different shapes.**

A grid sheet has `slots: (string | null)[]`. A full sheet has
`ticketId: string | null`. Same idea, two formats, so every shared helper has to
branch. The delete bug was exactly a missed branch (`if (sheet.kind !== "grid")
continue` in the old `removeTicketsFromBoard`).

Fix: give full pages a `slots` array too, with one entry. Keep `kind` for
meaning (atomic move, print template).

**4. Removing tickets is done by hand in several places.**

`removeBlock` (`src/domain/board.ts:266`) and `removeTicketsFromBoard`
(`src/domain/store.ts:281`) do the same job. After fix 3 they can become one
function.

(Skip the old "positions is duplicated" point — `board()` already builds it in
the same pass, and only tests read it.)

**5. The drag preview copies the server's move rule.**

`previewFor` (`src/ui/main.ts:263`) re-does the block math from `moveGrid`
(`src/domain/board.ts:170`). And it uses `volumeIndex - 1`
(`src/ui/main.ts:277`) while the server uses `block.indexOf`
(`src/domain/board.ts:182`). This only affects the highlight (the server still
validates), so it's a cosmetic risk, not a data one.

Fix: export one pure `previewBlock()` from the domain and use it in the UI.

## What to do, in order

1. Add a real id-exists check to `assertInvariants`, then call it after every
   `Store` change (one guard spot). Cheap, and it kills this whole bug class.
2. Make full sheets use `slots` too.
3. Collapse removal into one `removeTickets(sheets, ids)`.
4. Export `previewBlock()` and use it in `src/ui/main.ts`.

## Bottom line

The missing line wasn't the real problem. The real problem is a rule nobody
checks, and a screen that hides it. The two-shapes-for-one-thing is what made
the bad branch easy to write in the first place.

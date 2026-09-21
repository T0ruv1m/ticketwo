# Board abstraction review

Notes on the design problems behind the group-deletion bug. The bug itself is
fixed, but the abstraction choices that produced it are still in place.

## Context

`deleteGroup` failed to clear deleted tickets from the board, so stale ids stayed
in `this.sheets` and blocked moves into the freed slots. That was a symptom of
how the board state is modelled, not just a missed branch.

## Problems

### 1. Split source of truth, with no referential integrity

The board (`this.sheets`) stores ticket **ids**; the registry (`this.tickets`)
stores tickets. The same fact — "this ticket is on this page" — is recorded in
two places and kept in sync by hand. The rule that they must agree is implicit
and is only checked by `assertInvariants` (`src/domain/board.ts:349`), which is
called **only in tests** — there is no production call site. Every mutation is a
chance to break the invariant, and `deleteGroup` did.

### 2. The view masks corruption instead of rejecting it

`board()` maps dangling ids through `tickets.get(id) ?? null`
(`src/domain/store.ts:146`) and skips full sheets whose id does not resolve. That
coercion turns corrupt state into a plausible-looking empty slot. The view layer
silently launders an impossible state into a normal one, which is why the bug
presented as "an empty slot that rejects drops" instead of an error. A `board()`
that asserted resolution (or a branded ticket id that cannot dangle) would have
failed loudly at the delete.

### 3. `Sheet` is a union over different *storage*, not just behavior

`GridSheet` holds `slots: (string | null)[]`; `FullSheet` holds
`ticketId: string | null`. The same concept — the ids on this page — is encoded
two ways, so every generic operation must branch:

- `isSheetEmpty` branches,
- `positionOf` branches,
- `removeTicketsFromBoard` branched and **forgot one arm**.

A full page is just a sheet with one slot. Unify to `slots` and keep `kind` only
for semantics (atomic move, print template). Then there is one cleanup path, one
prune path, and no arm to forget.

### 4. Removal is ad hoc; pruning is an implicit obligation

`deleteGroup` performs three ordered steps — collect ids, mutate the map, clean
the board — with nothing enforcing the order (that order was the first bug).
There is no single placement/removal primitive; `placeGroup`, `move`,
`autoArrange`, `removeTicketsFromBoard`, and `pruneSheets` all edit sheets
directly, and every mutator is simply expected to remember to prune.

### 5. Business rules duplicated across the domain/UI boundary

The block-move rule (`start = slot - k`, exact-swap check) lives in `moveGrid`,
and the UI re-implements it in `previewFor` (`src/ui/main.ts:263`) to draw the
landing highlight. Two copies of one rule can drift, and a drift would show a
preview that does not match where the server lands the block.

## Proposed changes, cheapest first

1. **Fail loud.** Assert the resolve-integrity invariant inside every mutator (or
   at least in `board()`), not only in tests. This alone turns this class of bug
   from subtle to obvious.
2. **Unify sheet storage.** Use `slots: (string | null)[]` for both kinds; keep
   `kind` as semantics only. Removes the branch duplication.
3. **Single removal primitive.** One routine that clears ids from every sheet
   kind and prunes once; `deleteGroup` then only collects ids and calls it.
4. **Stop denormalizing in the view.** `positions` is derivable from `sheets`;
   either drop it or compute it in the same pass. Expose a pure `previewMove()`
   so the UI stops re-implementing collision rules.

## Bottom line

The load-bearing flaw is not the missing line. It is an implicit invariant that
nothing checks, plus a view layer that hides violations. The non-uniform sheet
storage is what made the missing branch easy to write in the first place.

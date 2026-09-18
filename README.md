# tickets — MVP

An implementation of `SPEC.md`: arrange shipment tickets on sheets, then print
the whole batch as a deterministic, server-composed PDF.

## Stack

- **TypeScript everywhere.** One language for domain, server, and UI.
- **Node + Express** for the API and to serve the built UI.
- **`pdf-lib`** behind a one-method `Composer` interface. Pure JS, programmatic,
  reproducible output, no browser involved.
- **Vanilla TS + Vite** for the board. The board is mostly direct DOM work
  (pointer-based drag, keyboard focus); a framework would add weight without
  changing the hard parts.
- **Vitest** for domain/PDF tests, **Playwright** for adversarial UI tests.

## Run

```bash
npm install
npm start            # builds the UI and serves http://localhost:8787
npm run dev          # API on :8787, Vite dev server on :5173 (proxies /api)
```

## Test

```bash
npm test             # 45 unit/integration tests (domain, moves, print, PDF, keys)
npm run typecheck
npm run test:e2e     # 22 Playwright tests

# watch it run in a real browser (WSLg: appears on the Windows desktop)
bash scripts/run-e2e.sh --headed
bash scripts/run-e2e.sh --headed tests/e2e/board.spec.ts:28
```

`test:e2e` runs `scripts/run-e2e.sh`. On a machine with Playwright's system
libraries installed, plain `playwright test` works too. On a bare host where
those libraries are missing, the script points the loader at a local extraction
(see `scripts/run-e2e.sh`); `npx playwright install-deps` with root is the
normal fix. Headed mode additionally needs the GTK/cairo/pango/cups stack.

## Layout

```
src/domain/     types, validation, board + move semantics, store, print contract
src/pdf/        PrintProfile geometry + Composer interface + pdf-lib implementation
src/server/     Express app + entry point
src/ui/         board UI (drag, keyboard, overview, queue, batches)
tests/          acceptance / move / print / pdf tests (spec examples)
tests/e2e/      Playwright: board interactions, print flow, adversarial cases
```

The domain is pure and has no knowledge of Express, pdf-lib, or the DOM. The
print layout library is hidden behind `Composer`, so it can be swapped or faked
(the tests use a fake composer to exercise failure and timeout paths).

## How the spec maps to code

- **Grouping / capacity** — `src/domain/group.ts`. `≤ 10` volumes → one grid
  ticket per volume; `> 10` → exactly one full-page ticket.
- **On-screen layout** — the sheet grid is `grid-auto-flow: column` (2x5,
  column-major) so the board matches the domain slot model and the PDF.
- **Board + moves** — `src/domain/board.ts`. Auto-arrange is deterministic and
  group-id ordered; grid moves move the whole group block (`start = slot − k`);
  collision policy is place / exact-swap / typed reject; full-page tickets only
  swap between full-page sheets. Invariants are checked by `assertInvariants`.
- **Print contract** — `src/domain/store.ts` `print()` plus `src/pdf/`. Render is
  bounded by a timeout, commit is all-or-nothing, and a client idempotency key
  records at most one batch.
- **Audit** — batches are immutable snapshots; only whole-batch deletion exists.

## Decisions worth calling out

- **Move collision ignores the moving block.** The spec says "target range
  empty → place". If the block itself is in the range (shifting within a sheet),
  it is removed conceptually first, otherwise keyboard parity would be
  impossible. Collisions are only ever with *other* groups.
- **Empty sheets are pruned** after every operation, so a full-page ticket has
  nowhere to move except another existing full-page sheet (or an exact swap).
- **Full-page keyboard moves** treat arrows and PageUp/Down as previous/next
  sheet; a move onto a grid sheet is rejected with `full-page-on-grid`.
- **`totalVolumes` is fixed at creation** and incremental adds are capped by the
  duplicate check (same id + same attributes returns the existing tickets).
- **Position** counts a grid sheet as 10 slots and a full sheet as 1.

## Known gaps

- Drag does not physically reflow cards while dragging; it previews the exact
  landing range (accent highlight) and rejects impossible drops with no preview.
- No persistence: the store is in-memory, so restarting the server clears state.
- The PDF is kept in memory per batch to serve it later; there is no archive.

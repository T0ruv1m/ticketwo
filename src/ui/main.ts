import type { Batch, Group, Sheet, Ticket } from "../domain/types.ts";
import type { BoardView, BoardSheetView } from "../domain/store.ts";
import { previewBlock } from "../domain/board.ts";
import { makeIdempotencyKey } from "./keys.ts";

const boardEl = document.getElementById("board") as HTMLDivElement;
const tabsEl = document.getElementById("sheet-tabs") as HTMLDivElement;
const overviewEl = document.getElementById("overview") as HTMLDivElement;
const groupsEl = document.getElementById("groups") as HTMLUListElement;
const batchesEl = document.getElementById("batches") as HTMLUListElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const form = document.getElementById("add-group") as HTMLFormElement;

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!res.ok) {
    throw new ApiError(data.error?.code ?? "http-error", data.error?.message ?? res.statusText);
  }
  return data;
}

let board: BoardView = { sheets: [], tickets: [], groups: [], positions: {} };
let selected: string | null = null;
let activeSheetId: string | null = null;
let printKey: string | null = null;

function esc(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function setStatus(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

const FRIENDLY: Record<string, string> = {
  "out-of-bounds": "That block does not fit there.",
  collision: "Can't drop there — another group is in the way.",
  "full-page-on-grid": "A full-page ticket needs a full-page sheet.",
  "invalid-target": "That is not a valid drop target.",
  "ticket-not-found": "That ticket is no longer on the board.",
};

function friendly(err: unknown): string {
  if (err instanceof ApiError) return FRIENDLY[err.code] ?? err.message;
  return err instanceof Error ? err.message : "Something went wrong.";
}

function cardHtml(ticket: Ticket): string {
  const label = `${ticket.project}, ${ticket.destination || "no destination"}, ${ticket.groupId}, ${
    ticket.kind === "full" ? `${ticket.totalVolumes} volumes` : `${ticket.volumeIndex} of ${ticket.totalVolumes}`
  }`;
  if (ticket.kind === "full") {
    return `<div class="card full-card" data-testid="ticket" data-ticket-id="${esc(ticket.id)}" data-group-id="${esc(
      ticket.groupId,
    )}" data-kind="full" tabindex="0" role="button" aria-label="${esc(label)}">
      <div class="big">${esc(ticket.totalVolumes)}</div>
      <div class="label">TOTAL VOLUMES</div>
      <div class="project">${esc(ticket.project)}</div>
      <div class="meta">${esc(ticket.destination || "—")} · ${esc(ticket.groupId)}</div>
    </div>`;
  }
  return `<div class="card" data-testid="ticket" data-ticket-id="${esc(ticket.id)}" data-group-id="${esc(
    ticket.groupId,
  )}" data-kind="grid" data-volume-index="${ticket.volumeIndex}" tabindex="0" role="button" aria-label="${esc(
    label,
  )}">
    <div class="index">${esc(ticket.volumeIndex)} of ${esc(ticket.totalVolumes)}</div>
    <div class="project">${esc(ticket.project)}</div>
    <div class="meta">${esc(ticket.destination || "—")} · ${esc(ticket.groupId)}</div>
  </div>`;
}

function sheetHtml(sheet: BoardSheetView): string {
  if (sheet.kind === "full") {
    const inner = sheet.ticket ? cardHtml(sheet.ticket) : "";
    return `<div class="sheet full" data-testid="sheet" data-sheet-id="${esc(sheet.id)}" data-sheet-kind="full" data-slot="0">${inner}</div>`;
  }
  const slots = (sheet.slots ?? [])
    .map((ticket, slot) => {
      const inner = ticket ? cardHtml(ticket) : "";
      const cls = ticket ? "slot" : "slot empty";
      return `<div class="${cls}" data-testid="slot" data-sheet-id="${esc(sheet.id)}" data-slot="${slot}" data-occupied="${
        ticket ? "true" : "false"
      }">${inner}</div>`;
    })
    .join("");
  return `<div class="sheet grid" data-testid="sheet" data-sheet-id="${esc(sheet.id)}" data-sheet-kind="grid">${slots}</div>`;
}

function renderTabs(): void {
  tabsEl.innerHTML = board.sheets
    .map((sheet, index) => {
      const active = activeSheetId === sheet.id ? " active" : "";
      return `<button type="button" class="tab${active}" role="tab" data-testid="sheet-tab" data-sheet-id="${esc(
        sheet.id,
      )}">Sheet ${index + 1}</button>`;
    })
    .join("");
}

function renderOverview(): void {
  overviewEl.innerHTML = board.sheets
    .map((sheet) => {
      if (sheet.kind === "full") {
        const on = sheet.ticket ? " full-on" : "";
        return `<div class="thumb full-thumb${activeSheetId === sheet.id ? " active" : ""}" data-testid="thumb" data-sheet-id="${esc(
          sheet.id,
        )}"><div class="cell${on}"></div></div>`;
      }
      const cells = (sheet.slots ?? [])
        .map((ticket) => `<div class="cell${ticket ? " on" : ""}"></div>`)
        .join("");
      return `<div class="thumb${activeSheetId === sheet.id ? " active" : ""}" data-testid="thumb" data-sheet-id="${esc(
        sheet.id,
      )}">${cells}</div>`;
    })
    .join("");
}

function renderGroups(): void {
  const counts = new Map<string, number>();
  for (const ticket of board.tickets) {
    counts.set(ticket.groupId, (counts.get(ticket.groupId) ?? 0) + 1);
  }
  const groups = board.groups.filter((group: Group) => (counts.get(group.id) ?? 0) > 0);
  groupsEl.innerHTML = groups.length
    ? groups
        .map(
          (group) => `<li class="queue-item" data-testid="queue-group" data-group-id="${esc(group.id)}">
            <div class="grow">
              <div><strong>${esc(group.project)}</strong> · ${esc(group.destination || "—")}</div>
              <div class="muted">${esc(group.id)} · ${counts.get(group.id) ?? 0} ticket(s)</div>
            </div>
            <button type="button" class="icon" data-action="delete-group" data-group-id="${esc(
              group.id,
            )}" aria-label="Delete group ${esc(group.id)}">✕</button>
          </li>`,
        )
        .join("")
    : `<li class="muted">Queue is empty.</li>`;
}

function renderBatches(): void {
  const batches = board ? latestBatches : [];
  batchesEl.innerHTML = batches.length
    ? batches
        .map(
          (batch: Batch) => `<li class="batch-item" data-testid="batch" data-batch-id="${esc(batch.id)}">
            <div class="grow">
              <div>${batch.tickets.length} ticket(s)</div>
              <div class="muted">${esc(batch.id.slice(0, 8))} · ${esc(batch.printedAt)}</div>
            </div>
            <a href="/api/batches/${encodeURIComponent(batch.id)}/pdf" target="_blank" rel="noopener" aria-label="Open composed PDF to print">Print PDF</a>
            <button type="button" class="icon" data-action="delete-batch" data-batch-id="${esc(
              batch.id,
            )}" aria-label="Delete batch">✕</button>
          </li>`,
        )
        .join("")
    : `<li class="muted">Nothing printed yet.</li>`;
}

let latestBatches: Batch[] = [];

function renderBoard(): void {
  const scrollLeft = boardEl.scrollLeft;
  const scrollTop = boardEl.scrollTop;
  boardEl.innerHTML = board.sheets.map(sheetHtml).join("");
  renderTabs();
  renderOverview();
  renderGroups();
  renderBatches();
  boardEl.scrollLeft = scrollLeft;
  boardEl.scrollTop = scrollTop;
  if (selected) {
    boardEl.querySelector<HTMLElement>(`[data-ticket-id="${cssEscape(selected)}"]`)?.focus();
  }
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

async function load(): Promise<void> {
  board = await api<BoardView>("/api/board");
  latestBatches = (await api<{ batches: Batch[] }>("/api/batches")).batches;
  if (activeSheetId && !board.sheets.some((s) => s.id === activeSheetId)) activeSheetId = null;
  renderBoard();
}

async function refreshFrom(next: BoardView): Promise<void> {
  board = next;
  latestBatches = (await api<{ batches: Batch[] }>("/api/batches")).batches;
  if (activeSheetId && !board.sheets.some((s) => s.id === activeSheetId)) activeSheetId = null;
  renderBoard();
}

async function moveTo(path: string, body: unknown): Promise<void> {
  try {
    const next = await api<BoardView>(path, body);
    setStatus("");
    await refreshFrom(next);
  } catch (err) {
    setStatus(friendly(err), true);
    await load();
  }
}

// ---- drag and drop -------------------------------------------------------

interface DragState {
  ticketId: string;
  ghost: HTMLElement | null;
  startX: number;
  startY: number;
  active: boolean;
}

let drag: DragState | null = null;
let highlighted: HTMLElement[] = [];

function dropTargetAt(x: number, y: number): { sheetId: string; slot: number } | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-sheet-id][data-slot]");
  if (!element) return null;
  const sheetId = element.dataset.sheetId;
  const slot = Number(element.dataset.slot);
  if (!sheetId || Number.isNaN(slot)) return null;
  return { sheetId, slot };
}

function setHighlights(elements: HTMLElement[]): void {
  if (highlighted.length === elements.length && highlighted.every((el, i) => el === elements[i])) return;
  for (const element of highlighted) element.classList.remove("drop-active");
  highlighted = elements;
  for (const element of highlighted) element.classList.add("drop-active");
}

/**
 * The server moves a whole group block, so preview exactly the slots the block
 * would land on. The rule itself lives in the domain (`previewBlock`), so the
 * highlight can never drift from where the server lands the block.
 */
function previewFor(ticketId: string, target: { sheetId: string; slot: number }): HTMLElement[] {
  const ticket = board.tickets.find((t) => t.id === ticketId);
  const sheet = board.sheets.find((s) => s.id === target.sheetId);
  if (!ticket || !sheet) return [];

  if (ticket.kind === "full") {
    const fullSheet = document.querySelector<HTMLElement>(
      `[data-testid="sheet"][data-sheet-id="${cssEscape(target.sheetId)}"]`,
    );
    return sheet.kind === "full" && fullSheet ? [fullSheet] : [];
  }

  const tickets = new Map(board.tickets.map((t) => [t.id, t]));
  const sheets: Sheet[] = board.sheets.map((s) =>
    s.kind === "grid"
      ? { id: s.id, kind: "grid", slots: (s.slots ?? []).map((t) => t?.id ?? null) }
      : { id: s.id, kind: "full", slots: [s.ticket?.id ?? null] },
  );
  const range = previewBlock(sheets, tickets, ticketId, target.sheetId, target.slot);
  if (!range) return [];

  const elements: HTMLElement[] = [];
  for (const slot of range) {
    const element = document.querySelector<HTMLElement>(
      `[data-testid="slot"][data-sheet-id="${cssEscape(target.sheetId)}"][data-slot="${slot}"]`,
    );
    if (element) elements.push(element);
  }
  return elements;
}

boardEl.addEventListener("pointerdown", (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-ticket-id]");
  if (!card) return;
  selected = card.dataset.ticketId ?? null;
  card.focus();
  drag = {
    ticketId: selected!,
    ghost: null,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
  };
});

window.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
  if (!drag.active && distance < 4) return;
  if (!drag.active) {
    drag.active = true;
    const ghost = document.createElement("div");
    ghost.className = "ghost";
    document.body.append(ghost);
    drag.ghost = ghost;
  }
  if (drag.ghost) {
    drag.ghost.style.left = `${event.clientX}px`;
    drag.ghost.style.top = `${event.clientY}px`;
  }
  const target = dropTargetAt(event.clientX, event.clientY);
  setHighlights(target ? previewFor(drag.ticketId, target) : []);
});

window.addEventListener("pointerup", async (event) => {
  const current = drag;
  drag = null;
  if (!current) return;
  setHighlights([]);
  if (!current.active) return;
  current.ghost?.remove();
  const target = dropTargetAt(event.clientX, event.clientY);
  if (!target) {
    setStatus("Dropped outside a sheet — nothing moved.");
    return;
  }
  await moveTo("/api/move", { ticketId: current.ticketId, sheetId: target.sheetId, slot: target.slot });
});

// ---- keyboard ------------------------------------------------------------

const KEY_DIRECTIONS: Record<string, string> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  PageUp: "page-up",
  PageDown: "page-down",
};

boardEl.addEventListener("keydown", async (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>("[data-ticket-id]");
  if (!card) return;
  const direction = KEY_DIRECTIONS[event.key];
  if (!direction) return;
  event.preventDefault();
  selected = card.dataset.ticketId ?? null;
  await moveTo("/api/key-move", { ticketId: selected, direction });
});

// ---- sheet navigation ----------------------------------------------------

tabsEl.addEventListener("click", (event) => {
  const tab = (event.target as HTMLElement).closest<HTMLElement>("[data-sheet-id]");
  if (!tab) return;
  focusSheet(tab.dataset.sheetId ?? null);
});

overviewEl.addEventListener("click", (event) => {
  const thumb = (event.target as HTMLElement).closest<HTMLElement>("[data-sheet-id]");
  if (!thumb) return;
  focusSheet(thumb.dataset.sheetId ?? null);
});

function focusSheet(sheetId: string | null): void {
  if (!sheetId) return;
  activeSheetId = sheetId;
  const sheet = boardEl.querySelector<HTMLElement>(`[data-testid="sheet"][data-sheet-id="${cssEscape(sheetId)}"]`);
  sheet?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  renderTabs();
  renderOverview();
}

// ---- actions -------------------------------------------------------------

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const body: Record<string, unknown> = {
    project: String(data.get("project") ?? ""),
    destination: String(data.get("destination") ?? ""),
    totalVolumes: Number(data.get("totalVolumes")),
  };
  const id = String(data.get("id") ?? "").trim();
  if (id) body.id = id;
  try {
    const result = await api<{ duplicate: boolean; tickets: Ticket[] }>("/api/groups", body);
    setStatus(result.duplicate ? `Already queued — showing the existing ${result.tickets.length} ticket(s).` : "");
    form.reset();
    await load();
  } catch (err) {
    setStatus(friendly(err), true);
  }
});

groupsEl.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action="delete-group"]');
  if (!button) return;
  try {
    await api(`/api/groups/${encodeURIComponent(button.dataset.groupId ?? "")}`, undefined, "DELETE");
    await load();
  } catch (err) {
    setStatus(friendly(err), true);
  }
});

batchesEl.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action="delete-batch"]');
  if (!button) return;
  const id = button.dataset.batchId ?? "";
  if (!window.confirm("Delete this printed batch? This is permanent.")) return;
  try {
    await api(`/api/batches/${encodeURIComponent(id)}`, undefined, "DELETE");
    await load();
  } catch (err) {
    setStatus(friendly(err), true);
  }
});

document.getElementById("auto-arrange")!.addEventListener("click", async () => {
  try {
    const next = await api<BoardView>("/api/auto-arrange", {});
    setStatus("Tidied up.");
    await refreshFrom(next);
  } catch (err) {
    setStatus(friendly(err), true);
  }
});

document.getElementById("print")!.addEventListener("click", async () => {
  try {
    if (!printKey) printKey = makeIdempotencyKey();
    const result = await api<
      { printed: true; batch: Batch; idempotent: boolean } | { printed: false; reason: string }
    >("/api/print", { idempotencyKey: printKey });
    if (result.printed) {
      setStatus(`Printed ${result.batch.tickets.length} ticket(s).`);
      printKey = null;
    } else {
      setStatus("Queue is empty — nothing to print.");
      printKey = null;
    }
    await load();
  } catch (err) {
    setStatus(`Print failed: ${friendly(err)} Queue unchanged.`, true);
  }
});

load().catch((err) => setStatus(friendly(err), true));

export {};

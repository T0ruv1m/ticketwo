import { expect, type APIRequestContext, type Page } from "@playwright/test";

export async function reset(request: APIRequestContext): Promise<void> {
  const response = await request.post("/api/test/reset");
  if (!response.ok()) {
    throw new Error(
      `test reset failed (${response.status()}); the server under test was not started with TICKETS_TEST=1`,
    );
  }
}

export async function addGroup(
  request: APIRequestContext,
  id: string,
  totalVolumes: number,
  project = "ACME",
  destination = "Berlin",
): Promise<void> {
  const response = await request.post("/api/groups", {
    data: { id, project, destination, totalVolumes },
  });
  expect(response.ok()).toBeTruthy();
}

export async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "tickets" })).toBeVisible();
}

export function gridSheet(page: Page, index = 0) {
  return page.locator('[data-testid="sheet"][data-sheet-kind="grid"]').nth(index);
}

export function slot(page: Page, sheetIndex: number, slotIndex: number) {
  return gridSheet(page, sheetIndex).locator(`[data-testid="slot"][data-slot="${slotIndex}"]`);
}

export function cardByVolume(page: Page, groupId: string, volumeIndex: number) {
  return page.locator(
    `[data-testid="ticket"][data-group-id="${groupId}"][data-volume-index="${volumeIndex}"]`,
  );
}

export async function occupancy(page: Page, sheetIndex = 0): Promise<(string | null)[]> {
  const sheet = gridSheet(page, sheetIndex);
  await sheet.waitFor({ state: "attached" });
  await sheet.locator('[data-testid="slot"][data-slot="0"]').waitFor({ state: "attached" });
  const result: (string | null)[] = [];
  // Read by slot index, not DOM order, so layout/DOM changes cannot silently
  // reorder what the assertion means.
  for (let slotIndex = 0; slotIndex < 10; slotIndex += 1) {
    const card = sheet
      .locator(`[data-testid="slot"][data-slot="${slotIndex}"]`)
      .locator("[data-ticket-id]");
    result.push((await card.count()) > 0 ? await card.first().getAttribute("data-group-id") : null);
  }
  return result;
}

export async function dragCardTo(
  page: Page,
  card: ReturnType<typeof page.locator>,
  target: ReturnType<typeof page.locator>,
): Promise<void> {
  await card.first().waitFor({ state: "visible" });
  await target.first().waitFor({ state: "visible" });
  const from = await card.first().boundingBox();
  const to = await target.first().boundingBox();
  if (!from || !to) throw new Error("missing bounding box for drag");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
}

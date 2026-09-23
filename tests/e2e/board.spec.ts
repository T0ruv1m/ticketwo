import { expect, test } from "@playwright/test";
import {
  addGroup,
  cardByVolume,
  dragCardTo,
  gridSheet,
  occupancy,
  open,
  reset,
  slot,
} from "./helpers.ts";

test.beforeEach(async ({ request, page }) => {
  await reset(request);
  await open(page);
});

test("shows a group's tickets and wraps whole groups onto sheets", async ({ page, request }) => {
  await addGroup(request, "G1", 8);
  await addGroup(request, "G2", 5);
  await page.reload();

  expect(await occupancy(page, 0)).toEqual(["G1", "G1", "G1", "G1", "G1", "G1", "G1", "G1", null, null]);
  expect(await occupancy(page, 1)).toEqual(["G2", "G2", "G2", "G2", "G2", null, null, null, null, null]);
  await expect(gridSheet(page, 0).locator('[data-testid="slot"][data-occupied="false"]')).toHaveCount(2);
});

test("lays slots out column-major on screen, matching the print model", async ({ page, request }) => {
  await addGroup(request, "G1", 6);
  await page.reload();
  const box = async (index: number) => (await slot(page, 0, index).boundingBox())!;
  const s0 = await box(0);
  const s1 = await box(1);
  const s5 = await box(5);

  // 0 and 1 are in the same column; 0 is above 1.
  expect(Math.abs(s0.x - s1.x)).toBeLessThan(1);
  expect(s0.y).toBeLessThan(s1.y);
  // 0 and 5 share a row; 5 is the next column to the right.
  expect(Math.abs(s0.y - s5.y)).toBeLessThan(1);
  expect(s5.x).toBeGreaterThan(s0.x);
});

test("drag moves an entire group block and persists", async ({ page, request }) => {
  await addGroup(request, "G1", 3);
  await addGroup(request, "G2", 3);
  await page.reload();

  await dragCardTo(page, cardByVolume(page, "G1", 1), slot(page, 0, 6));

  expect(await occupancy(page, 0)).toEqual([null, null, null, "G2", "G2", "G2", "G1", "G1", "G1", null]);
  await page.reload();
  expect(await occupancy(page, 0)).toEqual([null, null, null, "G2", "G2", "G2", "G1", "G1", "G1", null]);
});

test("adversarial: a partial collision is rejected and nothing moves", async ({ page, request }) => {
  await addGroup(request, "G1", 3);
  await addGroup(request, "G2", 2);
  await page.reload();
  const before = await occupancy(page, 0);

  await dragCardTo(page, cardByVolume(page, "G1", 1), slot(page, 0, 3));

  await expect(page.locator("#status")).toContainText("Não dá para soltar aí");
  expect(await occupancy(page, 0)).toEqual(before);
  expect(before).toEqual(["G1", "G1", "G1", "G2", "G2", null, null, null, null, null]);
});

test("adversarial: a full-page ticket cannot be dropped on a grid slot", async ({ page, request }) => {
  await addGroup(request, "G1", 12);
  await addGroup(request, "G2", 2);
  await page.reload();

  const fullCard = page.locator('[data-testid="sheet"][data-sheet-kind="full"] [data-testid="ticket"]');
  await expect(fullCard.locator(".big")).toHaveText("12");

  await dragCardTo(page, fullCard, slot(page, 0, 0));

  await expect(page.locator("#status")).toContainText("full-page ticket needs a full-page sheet");
  await expect(fullCard).toBeVisible();
  expect(await occupancy(page, 0)).toEqual(["G2", "G2", null, null, null, null, null, null, null, null]);
});

test("drag previews the whole block landing range", async ({ page, request }) => {
  await addGroup(request, "G1", 3);
  await addGroup(request, "G2", 3);
  await page.reload();

  await cardByVolume(page, "G1", 1).waitFor({ state: "visible" });
  const from = (await cardByVolume(page, "G1", 1).boundingBox())!;
  const to = (await slot(page, 0, 6).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(page.locator(".slot.drop-active")).toHaveCount(3);
  await page.mouse.up();
  await expect(page.locator(".slot.drop-active")).toHaveCount(0);
});

test("adversarial: an impossible drop shows no landing preview", async ({ page, request }) => {
  await addGroup(request, "G1", 3);
  await addGroup(request, "G2", 2);
  await page.reload();

  await cardByVolume(page, "G1", 1).waitFor({ state: "visible" });
  const from = (await cardByVolume(page, "G1", 1).boundingBox())!;
  const to = (await slot(page, 0, 3).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(page.locator(".slot.drop-active")).toHaveCount(0);
  await page.mouse.up();
});

test("keyboard arrows are equivalent to dragging", async ({ page, request }) => {
  await addGroup(request, "G1", 8);
  await page.reload();

  await cardByVolume(page, "G1", 1).focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => await occupancy(page, 0))
    .toEqual([null, "G1", "G1", "G1", "G1", "G1", "G1", "G1", "G1", null]);

  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => await occupancy(page, 0))
    .toEqual(["G1", "G1", "G1", "G1", "G1", "G1", "G1", "G1", null, null]);
});

test("auto-arrange tidies a hand-moved board", async ({ page, request }) => {
  await addGroup(request, "G1", 3);
  await addGroup(request, "G2", 3);
  await page.reload();

  await dragCardTo(page, cardByVolume(page, "G1", 1), slot(page, 0, 6));
  expect(await occupancy(page, 0)).toEqual([null, null, null, "G2", "G2", "G2", "G1", "G1", "G1", null]);

  await page.getByRole("button", { name: "Auto-organizar" }).click();
  await expect
    .poll(async () => await occupancy(page, 0))
    .toEqual(["G1", "G1", "G1", "G2", "G2", "G2", null, null, null, null]);
});

test("overview reflects what is on each sheet", async ({ page, request }) => {
  await addGroup(request, "G1", 8);
  await page.reload();
  await expect(page.locator('[data-testid="thumb"]').first().locator(".cell.on")).toHaveCount(8);
});

test("duplicate queued add shows the existing tickets instead of duplicating", async ({ page, request }) => {
  await addGroup(request, "G1", 3);
  await page.reload();

  await page.getByLabel("Projeto").fill("ACME");
  await page.getByLabel("Município").fill("LAGOA DOURADA");
  await page.getByLabel("Volumes").fill("3");
  await page.getByLabel("ID do grupo (opcional)").fill("G1");
  await page.getByRole("button", { name: "Adicionar à fila" }).click();

  await expect(page.locator("#status")).toContainText("Já está na fila");
  await expect(page.locator('[data-testid="queue-group"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="ticket"]')).toHaveCount(3);
});

test("adversarial: whitespace project is rejected", async ({ page }) => {
  await page.getByLabel("Projeto").fill("   ");
  await page.getByLabel("Volumes").fill("3");
  await page.getByRole("button", { name: "Adicionar à fila" }).click();
  await expect(page.locator("#status")).toContainText("project must be a non-empty string");
  await expect(page.locator('[data-testid="ticket"]')).toHaveCount(0);
});

test("adversarial: a project name is rendered as text, never executed", async ({ page, request }) => {
  await request.post("/api/groups", {
    data: {
      id: "GX",
      project: '<img src=x onerror="window.__xss=1">',
      destination: "Berlin",
      totalVolumes: 2,
    },
  });
  await page.reload();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.locator('[data-testid="ticket"]').first().locator(".project")).toContainText("<img");
  await expect(page.locator('[data-testid="ticket"] img')).toHaveCount(0);
});

test("deleting a queued group removes its pending tickets", async ({ page, request }) => {
  await addGroup(request, "G1", 3);
  await addGroup(request, "G2", 2);
  await page.reload();
  await expect(page.locator('[data-testid="queue-group"]')).toHaveCount(2);

  await page.locator('[data-testid="queue-group"][data-group-id="G1"] button').click();

  await expect(page.locator('[data-testid="queue-group"]')).toHaveCount(1);
  await expect(page.locator('[data-group-id="G1"]')).toHaveCount(0);
  expect(await occupancy(page, 0)).toEqual([null, null, null, "G2", "G2", null, null, null, null, null]);
});

test("an nfe access-key lookup fills the form and stamps tickets with the NF-e number", async ({
  page,
  request,
}) => {
  const KEY = "31240100874929000140550010005216041964324179";
  await page.route(`**/api/nfe/${KEY}`, async (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accessKey: KEY,
        nfeNumber: "521604",
        volumes: 2,
        batches: [{ code: "B23L0947", expiry: "2025-06-30", quantity: 20 }],
        source: "drive:test",
      }),
    });
  });
  await request.post("/api/test/reset");
  await open(page);

  await page.getByLabel("Chave de acesso (NF-e)").fill(KEY);
  await page.getByRole("button", { name: "Consultar" }).click();
  await expect(page.locator("#status")).toContainText("NF-e 521604");
  await expect(page.getByLabel("Volumes")).toHaveValue("2");
  await expect(page.getByLabel("Número da NF-e")).toHaveValue("521604");
  await expect(page.getByLabel("ID do grupo (opcional)")).toHaveValue(KEY);

  await page.getByLabel("Projeto").fill("ACME");
  await page.getByLabel("Município").fill("LAGOA DOURADA");
  await page.getByRole("button", { name: "Adicionar à fila" }).click();

  await expect(page.locator('[data-testid="ticket"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="nfe-number"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="nfe-number"]').first()).toHaveText("NF-e 521604");
  await expect(page.locator('[data-testid="lote-codes"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="lote-codes"]').first()).toHaveText("Lote B23L0947");
  // The 44-digit access key never appears on a card.
  await expect(page.locator('[data-testid="ticket"]')).not.toContainText(KEY);
});

test("adversarial: a lookup failure surfaces a friendly message and leaves the form untouched", async ({
  page,
  request,
}) => {
  const KEY = "31240100874929000140550010005216041964324179";
  await page.route(`**/api/nfe/${KEY}`, async (route) => {
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "nfe-not-found", message: "no NF-e XML for that key" } }),
    });
  });
  await request.post("/api/test/reset");
  await open(page);

  await page.getByLabel("Volumes").fill("3");
  await page.getByLabel("Chave de acesso (NF-e)").fill(KEY);
  await page.getByRole("button", { name: "Consultar" }).click();

  await expect(page.locator("#status")).toContainText("no NF-e XML for that key");
  await expect(page.getByLabel("Volumes")).toHaveValue("3");
  await expect(page.getByLabel("Número da NF-e")).toHaveValue("");
});

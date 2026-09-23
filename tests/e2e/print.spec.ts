import { expect, test } from "@playwright/test";
import { addGroup, open, reset } from "./helpers.ts";

test.beforeEach(async ({ request, page }) => {
  await reset(request);
  await open(page);
});

test("printing an empty queue is a no-op that tells the user", async ({ page }) => {
  await page.getByRole("button", { name: "Imprimir lote" }).click();
  await expect(page.locator("#status")).toContainText("A fila está vazia");
  await expect(page.locator('[data-testid="batch"]')).toHaveCount(0);
});

test("a successful print clears the board and records one batch", async ({ page, request }) => {
  await addGroup(request, "G1", 3);
  await page.reload();

  await page.getByRole("button", { name: "Imprimir lote" }).click();

  await expect(page.locator("#status")).toContainText("Imprimidos 3 etiqueta(s)");
  await expect(page.locator('[data-testid="ticket"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="batch"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="batch"]')).toContainText("3 etiqueta(s)");
  await expect(page.locator('[data-testid="queue-group"]')).toHaveCount(0);
});

test("the recorded batch has a downloadable PDF", async ({ page, request }) => {
  await addGroup(request, "G1", 3);
  await page.reload();
  await page.getByRole("button", { name: "Imprimir lote" }).click();
  await expect(page.locator('[data-testid="batch"]')).toHaveCount(1);

  const href = await page.locator('[data-testid="batch"] a').getAttribute("href");
  const response = await request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  const body = await response.body();
  expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
});

test("adversarial: double-clicking print does not create two batches", async ({ page, request }) => {
  await addGroup(request, "G1", 4);
  await page.reload();
  const button = page.getByRole("button", { name: "Imprimir lote" });
  await button.click();
  await button.click({ force: true });
  await expect(page.locator('[data-testid="batch"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="batch"]')).toContainText("4 etiqueta(s)");
});

test("adversarial: printing works without crypto.randomUUID (non-secure context)", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true });
  });
  await addGroup(request, "G1", 3);
  await page.reload();

  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");
  await page.getByRole("button", { name: "Imprimir lote" }).click();

  await expect(page.locator("#status")).toContainText("Imprimidos 3 etiqueta(s)");
  await expect(page.locator('[data-testid="batch"]')).toHaveCount(1);
});

test("clearing a printed batch is deliberate (requires confirmation)", async ({ page, request }) => {
  await addGroup(request, "G1", 2);
  await page.reload();
  await page.getByRole("button", { name: "Imprimir lote" }).click();
  await expect(page.locator('[data-testid="batch"]')).toHaveCount(1);

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator('[data-testid="batch"] button').click();
  await expect(page.locator('[data-testid="batch"]')).toHaveCount(1);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('[data-testid="batch"] button').click();
  await expect(page.locator('[data-testid="batch"]')).toHaveCount(0);
});

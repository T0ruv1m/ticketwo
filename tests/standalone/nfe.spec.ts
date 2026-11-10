import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { Group, Sheet, Ticket } from "../../src/domain/types.ts";

const KEY = "31240100874929000140550010005216041964324179";

test.beforeEach(async ({ page }) => {
  await page.route("**/nfe/*", (route) => route.fulfill({
    json: {
      accessKey: KEY, nfeNumber: "521604", volumes: 2,
    },
  }));
  await page.goto(pathToFileURL(resolve("dist/standalone/tickets.html")).href);
});

async function consult(page: Page): Promise<void> {
  await page.getByLabel("Chave de acesso (NF-e)").fill(KEY);
  await page.getByRole("button", { name: "Consultar", exact: true }).click();
  await expect(page.getByLabel("Número da NF-e", { exact: true })).toHaveValue("521604");
  await expect(page.getByLabel("Volumes", { exact: true })).toHaveValue("2");
}

test("consult, enter city, and add without clearing the barcode; consult the same key again", async ({ page }) => {
  await consult(page);
  await page.getByLabel("Município", { exact: true }).fill("LAMIM");
  await page.getByRole("button", { name: "Adicionar à fila" }).click();
  await expect(page.getByTestId("ticket")).toHaveCount(2);

  // Each deliberate add creates a new shipment, even for the same NF-e.
  await consult(page);
  await page.getByLabel("Município", { exact: true }).fill("LAMIM");
  await page.getByRole("button", { name: "Adicionar à fila" }).click();
  await expect(page.getByTestId("ticket")).toHaveCount(4);
  await expect(page.getByTestId("queue-group")).toHaveCount(2);
});

test("a failed save keeps the barcode and NF-e number for retry", async ({ page }) => {
  await consult(page);
  await page.getByLabel("Município", { exact: true }).fill("LAMIM");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      IDBObjectStore.prototype.put = original;
      throw new Error("simulated save failure");
    };
  });
  await page.getByRole("button", { name: "Adicionar à fila" }).click();
  await expect(page.locator("#status")).toContainText("simulated save failure");
  await expect(page.getByLabel("Chave de acesso (NF-e)")).toHaveValue(KEY);
  await page.getByRole("button", { name: "Adicionar à fila" }).click();
  await expect(page.getByTestId("ticket")).toHaveCount(2);
});

test("an already saved barcode can be added with another city and volume count", async ({ page }) => {
  await consult(page);
  await page.getByLabel("Município", { exact: true }).fill("LAMIM");
  await page.getByRole("button", { name: "Adicionar à fila" }).click();
  await expect(page.getByTestId("ticket")).toHaveCount(2);

  // Reload to check existing persisted shipments, not only current form state.
  await page.reload();
  await expect(page.getByTestId("ticket")).toHaveCount(2);
  await consult(page);
  await page.getByLabel("Município", { exact: true }).fill("OURO BRANCO");
  await page.getByLabel("Volumes", { exact: true }).fill("3");
  await expect(page.getByLabel("Chave de acesso (NF-e)")).toHaveValue(KEY);
  await page.getByRole("button", { name: "Adicionar à fila" }).click();
  await expect(page.getByTestId("ticket")).toHaveCount(5);
  await expect(page.getByTestId("queue-group")).toHaveCount(2);
  await expect(page.getByTestId("ticket").last()).toContainText("OURO BRANCO");
  await expect(page.locator("#status")).toHaveText("");
});

test("repeated submit events while saving create only one shipment", async ({ page }) => {
  await consult(page);
  await page.getByLabel("Município", { exact: true }).fill("LAMIM");
  await page.locator("#add-group").evaluate((form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId("ticket")).toHaveCount(2);
  await expect(page.getByTestId("queue-group")).toHaveCount(1);
});

test("legacy data keyed by barcode does not block a new shipment", async ({ page }) => {
  await consult(page);
  await page.getByLabel("Município", { exact: true }).fill("LAMIM");
  await page.getByRole("button", { name: "Adicionar à fila" }).click();
  await expect(page.getByTestId("ticket")).toHaveCount(2);

  // Recreate the previous standalone format independently of current creation code.
  await page.evaluate(async (key) => {
    const project = (document.querySelector("#project-select") as HTMLSelectElement).value;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("tickets-standalone", 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("projects", "readwrite");
        const projects = tx.objectStore("projects");
        const read = projects.get(project);
        read.onsuccess = () => {
          const saved = read.result as { groups: Map<string, Group>; tickets: Map<string, Ticket>; sheets: Sheet[] };
          const group = [...saved.groups.values()][0]!;
          saved.groups = new Map([[key, { ...group, id: key, batches: [{ code: "OLD", expiry: "", quantity: 1 }] }]]);
          const ids = new Map<string, string>();
          saved.tickets = new Map([...saved.tickets].map(([oldId, ticket]) => {
            const id = `t:${key}:${ticket.volumeIndex}`;
            ids.set(oldId, id);
            return [id, { ...ticket, id, groupId: key, batchCodes: ["OLD"] }];
          }));
          for (const sheet of saved.sheets) {
            sheet.slots = sheet.slots.map((id) => id ? ids.get(id)! : null) as typeof sheet.slots;
          }
          projects.put(saved, project);
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
      request.onerror = () => reject(request.error);
    });
  }, KEY);

  await page.reload();
  await expect(page.getByTestId("ticket")).toHaveCount(2);
  await consult(page);
  await page.getByLabel("Município", { exact: true }).fill("OURO BRANCO");
  await page.getByRole("button", { name: "Adicionar à fila" }).click();
  await expect(page.getByTestId("ticket")).toHaveCount(4);
  await expect(page.getByTestId("queue-group")).toHaveCount(2);
  await expect(page.locator("#status")).toHaveText("");
  await expect(page.locator("#board")).not.toContainText("OLD");
});

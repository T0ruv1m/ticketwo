import { describe, expect, it } from "vitest";
import { Store } from "../src/domain/store.ts";
import { PdfLibComposer } from "../src/pdf/pdf-lib-composer.ts";
import { A4_PROFILE, fullPageRect, slotRect } from "../src/pdf/profile.ts";
import { addGroup, extractPdfText } from "./helpers.ts";

function realStore(): Store {
  return new Store({
    composer: new PdfLibComposer(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    idFactory: () => "batch-fixed",
  });
}

describe("Print geometry", () => {
  it("lays slots out column-major, top to bottom", () => {
    const s0 = slotRect(A4_PROFILE, 0);
    const s1 = slotRect(A4_PROFILE, 1);
    const s5 = slotRect(A4_PROFILE, 5);
    expect(s0.y).toBeGreaterThan(s1.y);
    expect(s0.x).toBeCloseTo(s1.x);
    expect(s0.y).toBeCloseTo(s5.y);
    expect(s5.x).toBeGreaterThan(s0.x);
  });

  it("keeps every slot inside the page margins", () => {
    const pageW = A4_PROFILE.paper.widthMm * (72 / 25.4);
    const pageH = A4_PROFILE.paper.heightMm * (72 / 25.4);
    const margin = A4_PROFILE.marginMm * (72 / 25.4);
    for (let slot = 0; slot < A4_PROFILE.cols * A4_PROFILE.rows; slot += 1) {
      const rect = slotRect(A4_PROFILE, slot);
      expect(rect.x).toBeGreaterThanOrEqual(margin - 0.001);
      expect(rect.y).toBeGreaterThanOrEqual(margin - 0.001);
      expect(rect.x + rect.width).toBeLessThanOrEqual(pageW - margin + 0.001);
      expect(rect.y + rect.height).toBeLessThanOrEqual(pageH - margin + 0.001);
    }
    const full = fullPageRect(A4_PROFILE);
    expect(full.width).toBeCloseTo(pageW - margin * 2);
    expect(full.height).toBeCloseTo(pageH - margin * 2);
  });
});

describe("Print determinism", () => {
  it("produces byte-identical PDFs for the same queue and profile", async () => {
    const build = () => {
      const store = realStore();
      addGroup(store, "G1", 8);
      addGroup(store, "G2", 12);
      return store;
    };
    const a = build();
    const b = build();
    const resultA = await a.print("key");
    const resultB = await b.print("key");
    if (!resultA.printed || !resultB.printed) throw new Error("expected print");
    const bytesA = a.getPdf(resultA.batch.id);
    const bytesB = b.getPdf(resultB.batch.id);
    expect(Buffer.from(bytesA).equals(Buffer.from(bytesB))).toBe(true);
    expect(resultA.batch.pdfHash).toBe(resultB.batch.pdfHash);
  });

  it("embeds the full-page total and the index line", async () => {
    const store = realStore();
    addGroup(store, "G1", 12);
    const result = await store.print("key");
    if (!result.printed) throw new Error("expected print");
    const text = extractPdfText(store.getPdf(result.batch.id));
    expect(text).toContain("TOTAL DE VOLUMES");
    expect(text).toContain("G1");
    expect(text).toContain("12");
  });

  it("prints the n of N index line for grid tickets", async () => {
    const store = realStore();
    addGroup(store, "G1", 3);
    const result = await store.print("key");
    if (!result.printed) throw new Error("expected print");
    const text = extractPdfText(store.getPdf(result.batch.id));
    expect(text).toContain("1 de 3");
    expect(text).toContain("3 de 3");
  });

  it("prints NF-e number and lote codes instead of the access key", async () => {
    const store = realStore();
    store.addGroup({
      id: "31240100874929000140550010005216041964324179",
      project: "ACME",
      destination: "Berlin",
      totalVolumes: 3,
      nfeNumber: "521604",
      batches: [{ code: "B23L0947", expiry: "2025-06-30", quantity: 20 }],
    });
    const result = await store.print("key");
    if (!result.printed) throw new Error("expected print");
    const text = extractPdfText(store.getPdf(result.batch.id));
    expect(text).toContain("NF-e 521604");
    expect(text).toContain("B23L0947");
    expect(text).not.toContain("31240100874929000140550010005216041964324179");
  });

  it("prints the NF-e number on grid and full-page tickets", async () => {
    const store = realStore();
    store.addGroup({ id: "G1", project: "ACME", destination: "Berlin", totalVolumes: 3, nfeNumber: "521604" });
    store.addGroup({ id: "G2", project: "ACME", destination: "Berlin", totalVolumes: 12, nfeNumber: "521999" });    const result = await store.print("key");
    if (!result.printed) throw new Error("expected print");
    const text = extractPdfText(store.getPdf(result.batch.id));
    expect(text).toContain("NF-e 521604");
    expect(text).toContain("NF-e 521999");
  });

  it("omits the NF-e line when a group has no NF-e number", async () => {
    const store = realStore();
    addGroup(store, "G1", 3);
    const result = await store.print("key");
    if (!result.printed) throw new Error("expected print");
    expect(extractPdfText(store.getPdf(result.batch.id))).not.toContain("NF-e");
  });
});

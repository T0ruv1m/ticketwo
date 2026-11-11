import { describe, expect, it } from "vitest";
import { Store } from "../src/domain/store.ts";
import { PdfLibComposer } from "../src/pdf/pdf-lib-composer.ts";
import { A4_PROFILE, fullPageRect, slotRect } from "../src/pdf/profile.ts";
import { addGroup, extractPdfGeometry, extractPdfText } from "./helpers.ts";

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

  it("embeds the full-page municipality, NF prompt, and volume count", async () => {
    const store = realStore();
    addGroup(store, "G1", 12);
    const result = await store.print("key");
    if (!result.printed) throw new Error("expected print");
    const text = extractPdfText(store.getPdf(result.batch.id));
    expect(text).toContain("BERLIN");
    expect(text).toContain("NF");
    expect(text).toContain("12 VOLUMES");
  });

  it("prints the reference volume format and CISALV stamp on every grid label", async () => {
    const store = realStore();
    addGroup(store, "G1", 3);
    const result = await store.print("key");
    if (!result.printed) throw new Error("expected print");
    const text = extractPdfText(store.getPdf(result.batch.id));
    expect(text.includes("VOLUME: 1/3")).toBe(true);
    expect(text.includes("VOLUME: 3/3")).toBe(true);
    const { images } = extractPdfGeometry(store.getPdf(result.batch.id));
    expect(images).toHaveLength(10);
    const first = slotRect(A4_PROFILE, 0);
    expect(images[0]!.y).toBeGreaterThan(first.y + first.height / 2);
  });

  it("prints the NF-e number instead of the access key", async () => {
    const store = realStore();
    store.addGroup({
      id: "31240100874929000140550010005216041964324179",
      project: "ACME",
      destination: "Berlin",
      totalVolumes: 3,
      nfeNumber: "521604",
    });
    const result = await store.print("key");
    if (!result.printed) throw new Error("expected print");
    const text = extractPdfText(store.getPdf(result.batch.id));
    expect(text.includes("NF DO FORNECEDOR: 521604")).toBe(true);
    expect(text).not.toContain("31240100874929000140550010005216041964324179");
  });

  it("uses the Estado suffix only for Farmacis labels", async () => {
    const farmacis = realStore();
    farmacis.addGroup({ id: "F1", project: "FARMACIS", destination: "Berlin", totalVolumes: 1 });
    const farmacisResult = await farmacis.print("farmacis-key");
    if (!farmacisResult.printed) throw new Error("expected print");
    const farmacisText = extractPdfText(farmacis.getPdf(farmacisResult.batch.id));
    expect(farmacisText).toContain("FARMACIS-ESTADO");

    const mmh = realStore();
    mmh.addGroup({ id: "M1", project: "MMH", destination: "Berlin", totalVolumes: 1 });
    const mmhResult = await mmh.print("mmh-key");
    if (!mmhResult.printed) throw new Error("expected print");
    const mmhText = extractPdfText(mmh.getPdf(mmhResult.batch.id));
    expect(mmhText).toContain("MATERIAL MÉDICO HOSPITALAR");
    expect(mmhText).toContain("MMH");
    expect(mmhText).not.toContain("MMH-ESTADO");
  });

  it("prints the NF-e number on grid and full-page tickets", async () => {
    const store = realStore();
    store.addGroup({ id: "G1", project: "ACME", destination: "Berlin", totalVolumes: 3, nfeNumber: "521604" });
    store.addGroup({ id: "G2", project: "ACME", destination: "Berlin", totalVolumes: 12, nfeNumber: "521999" });    const result = await store.print("key");
    if (!result.printed) throw new Error("expected print");
    const text = extractPdfText(store.getPdf(result.batch.id));
    expect(text.includes("NF DO FORNECEDOR: 521604")).toBe(true);
    expect(text.includes("NF 521999")).toBe(true);
  });

  it("omits the NF-e line on populated tickets without a number", async () => {
    const store = realStore();
    addGroup(store, "G1", 10);
    const result = await store.print("key");
    if (!result.printed) throw new Error("expected print");
    // Fill the sheet so blank handwriting labels do not contribute NF-e prompts.
    expect(extractPdfText(store.getPdf(result.batch.id)).includes("NF-e")).toBe(false);
  });
});

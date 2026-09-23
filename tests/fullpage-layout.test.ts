import { describe, expect, it } from "vitest";
import { Store } from "../src/domain/store.ts";
import { PdfLibComposer } from "../src/pdf/pdf-lib-composer.ts";
import { extractPdfGeometry } from "./helpers.ts";

const KEY = "31240100874929000140550010005216041964324179";
const CODES = [
  "25K1900",
  "RB5X0001",
  "B23L0947",
  "B23L0948",
  "B23L0949",
  "B23L0950",
  "B23L0951",
  "B23L0952",
];

function fullPageStore(): Store {
  const store = new Store({
    composer: new PdfLibComposer(),
    now: () => new Date("2000-01-01T00:00:00.000Z"),
    idFactory: () => "b-fixed",
  });
  store.addGroup({
    id: KEY,
    project: "MEDICAMENTOS",
    destination: "LAMIM",
    totalVolumes: 150,
    nfeNumber: "521604",
    batches: CODES.map((code) => ({ code, expiry: "2025-06-30", quantity: 1 })),
  });
  return store;
}

/**
 * Geometry regression for the ghost-overlap bug: the lote codes and the
 * consórcio footer used to be drawn on top of the barcode. This reads the real
 * content stream and checks the vertical ordering, so it fails if the layout
 * ever regresses — no renderer or golden image needed.
 */
describe("Full-page layout", () => {
  it("keeps the lotes and footer clear of the barcode, key below it", async () => {
    const store = fullPageStore();
    const result = await store.print("key");
    if (!result.printed) throw new Error("expected print");

    const { texts, images } = extractPdfGeometry(store.getPdf(result.batch.id));

    const barcode = images.find((image) => image.width / image.height > 3);
    expect(barcode, "full page embeds a wide barcode").toBeDefined();
    const barcodeBottom = barcode!.y;
    const barcodeTop = barcode!.y + barcode!.height;

    const loteYs = texts.filter((item) => CODES.includes(item.text)).map((item) => item.y);
    expect(loteYs, "every lote code is rendered").toHaveLength(CODES.length);
    for (const y of loteYs) {
      expect(y, `lote at y=${y} overlaps the barcode`).toBeGreaterThanOrEqual(barcodeTop);
    }

    const footer = texts.find((item) => item.text.includes("CONSÓRCIO"));
    expect(footer, "footer is rendered").toBeDefined();
    expect(footer!.y, "footer overlaps the barcode").toBeGreaterThanOrEqual(barcodeTop);

    const key = texts.find((item) => item.text === KEY);
    expect(key, "access key is printed below the barcode").toBeDefined();
    expect(key!.y, "access key is not below the barcode").toBeLessThan(barcodeBottom);
  });
});

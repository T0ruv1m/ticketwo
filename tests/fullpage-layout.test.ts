import { describe, expect, it } from "vitest";
import { Store } from "../src/domain/store.ts";
import { PdfLibComposer } from "../src/pdf/pdf-lib-composer.ts";
import { extractPdfGeometry } from "./helpers.ts";

const KEY = "31240100874929000140550010005216041964324179";

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
  });
  return store;
}

/** Geometry regression for the full-page capa reference cover. */
describe("Full-page layout", () => {
  it("matches the capa logo and three centered lines", async () => {
    const store = fullPageStore();
    const result = await store.print("key");
    if (!result.printed) throw new Error("expected print");

    const { texts, images } = extractPdfGeometry(store.getPdf(result.batch.id));

    expect(images, "one CISALV stamp, no barcode").toHaveLength(1);
    const stamp = images[0]!;
    expect(stamp.x).toBeCloseTo(111.6, 1);
    expect(stamp.width).toBeCloseTo(144.48, 1);
    expect(stamp.height).toBeCloseTo(31.32, 1);
    expect(stamp.y).toBeCloseTo(749.5, 1);
    expect(texts.map((item) => item.text)).toEqual(["LAMIM", "NF 521604", "150 VOLUMES"]);
    const baselines = [634.2, 413.76, 193.32];
    texts.forEach((item, index) => {
      expect(item.size).toBeCloseTo(48, 1);
      expect(item.y).toBeCloseTo(baselines[index]!, 1);
    });

    const key = texts.find((item) => item.text === KEY);
    expect(key, "access key is omitted").toBeUndefined();
  });
});

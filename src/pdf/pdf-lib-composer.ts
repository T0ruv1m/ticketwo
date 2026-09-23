import { PDFDocument, StandardFonts, rgb, type Color, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { toBuffer } from "bwip-js/node";
import type { Ticket } from "../domain/types.ts";
import type { Composer, PageSpec } from "./composer.ts";
import { fullPageRect, slotRect, type CellRect, type PrintProfile } from "./profile.ts";
import { LOGO_PNG_BASE64 } from "./logo.ts";

/** Aspect ratio of imgs/gray.png (357 x 316). */
const LOGO_ASPECT = 357 / 316;

const FOOTER = "CONSÓRCIO INTERMUNICIPAL DE SAÚDE DO ALTO DAS VERTENTES";

const FIXED_DATE = new Date("2000-01-01T00:00:00.000Z");
const INK = rgb(0.08, 0.08, 0.1);
const MUTED = rgb(0.45, 0.45, 0.5);
const OUTLINE = rgb(0.8, 0.8, 0.83);
const ACCENT = rgb(0.1, 0.35, 0.75);

const PAD = 6;

export class PdfLibComposer implements Composer {
  async compose(pages: readonly PageSpec[], profile: PrintProfile): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.setProducer("tickets");
    doc.setCreator("tickets");
    doc.setCreationDate(FIXED_DATE);
    doc.setModificationDate(FIXED_DATE);

    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const logo = await doc.embedPng(LOGO_PNG_BASE64);

    // One barcode per distinct access key; pages may repeat tickets.
    const barcodes = await embedAccessKeyBarcodes(doc, pages);

    const pageW = profile.paper.widthMm * (72 / 25.4);
    const pageH = profile.paper.heightMm * (72 / 25.4);

    for (const spec of pages) {
      const page = doc.addPage([pageW, pageH]);
      if (spec.kind === "grid") {
        drawGridPage(page, spec.slots, profile, regular, bold, logo, barcodes);
      } else {
        drawFullPage(page, spec.ticket, profile, regular, bold, logo, barcodes);
      }
    }

    return doc.save({ useObjectStreams: false });
  }
}

async function embedAccessKeyBarcodes(
  doc: PDFDocument,
  pages: readonly PageSpec[],
): Promise<Map<string, PDFImage>> {
  const keys = new Set<string>();
  for (const spec of pages) {
    const tickets = spec.kind === "grid" ? spec.slots : [spec.ticket];
    for (const ticket of tickets) if (ticket) keys.add(ticket.groupId);
  }
  const map = new Map<string, PDFImage>();
  for (const key of keys) {
    const png = await toBuffer({ bcid: "code128", text: key, height: 10, includetext: false });
    map.set(key, await doc.embedPng(new Uint8Array(png)));
  }
  return map;
}

function drawGridPage(
  page: PDFPage,
  slots: readonly (Ticket | null)[],
  profile: PrintProfile,
  regular: PDFFont,
  bold: PDFFont,
  logo: PDFImage,
  barcodes: Map<string, PDFImage>,
): void {
  slots.forEach((ticket, slot) => {
    const rect = slotRect(profile, slot);
    if (!ticket) {
      page.drawRectangle({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        borderColor: OUTLINE,
        borderWidth: 1,
        borderDashArray: [3, 3],
      });
      return;
    }
    drawLogo(page, logo, rect, 0.75, 0.1);
    drawTicketCard(page, rect, ticket, regular, bold, barcodes);
  });
}

function drawLogo(page: PDFPage, logo: PDFImage, rect: CellRect, scale: number, opacity: number): void {
  const width = Math.min(rect.width * scale, rect.height * scale * LOGO_ASPECT);
  const height = width / LOGO_ASPECT;
  page.drawImage(logo, {
    x: rect.x + rect.width / 2 - width / 2,
    y: rect.y + rect.height / 2 - height / 2,
    width,
    height,
    opacity,
  });
}

function drawFooter(page: PDFPage, rect: CellRect, font: PDFFont, size: number, color: Color): void {
  const width = font.widthOfTextAtSize(FOOTER, size);
  page.drawText(fit(FOOTER, font, size, rect.width - PAD * 2), {
    x: rect.x + rect.width / 2 - width / 2,
    y: rect.y + PAD,
    size,
    font,
    color,
  });
}

function drawTicketCard(
  page: PDFPage,
  rect: CellRect,
  ticket: Ticket,
  regular: PDFFont,
  bold: PDFFont,
  barcodes: Map<string, PDFImage>,
): void {
  page.drawRectangle({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    borderColor: INK,
    borderWidth: 1.2,
  });

  const left = rect.x + PAD;
  const maxW = rect.width - PAD * 2;
  let cursorY = rect.y + rect.height - PAD - 11;

  const index = `${ticket.volumeIndex} de ${ticket.totalVolumes}`;
  const indexWidth = bold.widthOfTextAtSize(index, 15);
  page.drawText(index, { x: left, y: cursorY, size: 15, font: bold, color: INK });

  // Project name sits on the same line as the volume count, on the right side.
  const projectGap = 12;
  const projectMaxW = maxW - indexWidth - projectGap;
  if (projectMaxW > 20) {
    const project = fit(ticket.project, bold, 11, projectMaxW);
    const projectWidth = bold.widthOfTextAtSize(project, 11);
    page.drawText(project, {
      x: rect.x + rect.width - PAD - projectWidth,
      y: cursorY + 2,
      size: 10,
      font: bold,
      color: INK,
    });
  }
  cursorY -= 22;

  // Município name is emphasized below the project line.
  const destination = fit(ticket.destination || "—", bold, 14, maxW);
  page.drawText(destination, {
    x: left,
    y: cursorY,
    size: 14,
    font: bold,
    color: INK,
  });
  cursorY -= 16;

  // The 44-digit access key is printed only as a barcode; the NF-e number and
  // lote codes identify the shipment. Plain groups keep the group id text.
  if (ticket.nfeNumber) {
    page.drawText(`NF-e ${ticket.nfeNumber}`, {
      x: left,
      y: cursorY,
      size: 14,
      font: regular,
      color: MUTED,
    });
    cursorY -= 16;
  }

  if (ticket.batchCodes.length > 0) {
    const box = 9;
    const textboxGap = 4;
    const gap = 9;
    let x = left;
    for (const code of ticket.batchCodes) {
      // Inline layout: every code gets a checkbox beside it, never stacked.
      const text = code;
      const textW = regular.widthOfTextAtSize(text, 10);
      const itemW = textW + textboxGap + box;
      if (x + itemW > left + maxW && x > left) {
        x = left;
        cursorY -= 15;
      }
      page.drawRectangle({
        x,
        y: cursorY + 1,
        width: box,
        height: box,
        borderColor: OUTLINE,
        borderWidth: 0.9,
      });
      page.drawText(text, { x: x + box + textboxGap, y: cursorY, size: 10, font: regular, color: MUTED });
      x += itemW + gap;
    }
    cursorY -= 15;
  } else if (!ticket.nfeNumber) {
    page.drawText(fit(ticket.groupId, regular, 10, maxW), {
      x: left,
      y: cursorY,
      size: 10,
      font: regular,
      color: MUTED,
      });
    cursorY -= 15;
  }

  drawBarcode(page, barcodes.get(ticket.groupId)!, rect, 0.8, 14);
  drawFooter(page, rect, regular, 6, MUTED);
}

function drawBarcode(
  page: PDFPage,
  barcode: PDFImage | undefined,
  rect: CellRect,
  widthFraction: number,
  bottomOffset: number,
): void {
  if (!barcode) return;
  const width = Math.min(rect.width * widthFraction, rect.width - PAD * 2);
  const height = width / (barcode.width / barcode.height);
  page.drawImage(barcode, {
    x: rect.x + rect.width / 2 - width / 2,
    y: rect.y + bottomOffset,
    width,
    height,
  });
}

function drawFullPage(
  page: PDFPage,
  ticket: Ticket,
  profile: PrintProfile,
  regular: PDFFont,
  bold: PDFFont,
  logo: PDFImage,
  barcodes: Map<string, PDFImage>,
): void {
  const rect = fullPageRect(profile);
  page.drawRectangle({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    borderColor: INK,
    borderWidth: 2,
  });

  drawLogo(page, logo, rect, 0.8, 0.08);

  const centerX = rect.x + rect.width / 2;
  const total = String(ticket.totalVolumes);
  const bigSize = 200;
  const totalWidth = bold.widthOfTextAtSize(total, bigSize);
  page.drawText(total, {
    x: centerX - totalWidth / 2,
    y: rect.y + rect.height * 0.42,
    size: bigSize,
    font: bold,
    color: ACCENT,
  });

  const label = "TOTAL DE VOLUMES";
  const labelWidth = regular.widthOfTextAtSize(label, 18);
  page.drawText(label, {
    x: centerX - labelWidth / 2,
    y: rect.y + rect.height * 0.42 - 32,
    size: 18,
    font: regular,
    color: MUTED,
  });

  // Same identity rule as the grid card: NF-e number and lote codes instead of
  // the 44-digit access key. Plain groups fall back to the group id.
  const lines = [ticket.project, ticket.destination || "—"];
  if (lines.length === 2 && ticket.batchCodes.length === 0) lines.push(ticket.groupId);
  let y = rect.y + rect.height * 0.16;
  for (const [i, line] of lines.entries()) {
    // Município name is emphasized relative to the other identity lines.
    const font = i === 0 ? bold : regular;
    const size = i === 0 ? 25 : 22;
    const width = font.widthOfTextAtSize(line, size);
    page.drawText(fit(line, font, size, rect.width - PAD * 2), {
      x: centerX - width / 2,
      y,
      size,
      font,
      color: i === 0 ? INK : i === 1 ? INK : MUTED,
    });
    y -= size + 10;
  }

  if (ticket.nfeNumber) {
    const nfeText = `NF-e ${ticket.nfeNumber}`;
    const nfeWidth = regular.widthOfTextAtSize(nfeText, 22);
    page.drawText(fit(nfeText, regular, 22, rect.width - PAD * 2), {
      x: centerX - nfeWidth / 2,
      y,
      size: 22,
      font: regular,
      color: MUTED,
    });
    y -= 32;
  }
  if (ticket.batchCodes.length > 0) {
    // Inline layout: every code gets a checkbox beside it, never stacked.
    const box = 14;
    const textboxGap = 7;
    const gap = 16;
    const entries = ticket.batchCodes.map((code) => {
      const text = code;
      return { text, textW: regular.widthOfTextAtSize(text, 18) };
    });
    const totalRow =
      entries.reduce((sum, e) => sum + e.textW + textboxGap + box, 0) + gap * (entries.length - 1);
    let x = centerX - totalRow / 2;
    for (const entry of entries) {
      page.drawRectangle({
        x,
        y: y + 1,
        width: box,
        height: box,
        borderColor: OUTLINE,
        borderWidth: 1,
      });
      page.drawText(entry.text, { x: x + box + textboxGap, y, size: 18, font: regular, color: MUTED });
      x += entry.textW + textboxGap + box + gap;
    }
    y -= 26;
  }

  drawBarcode(page, barcodes.get(ticket.groupId)!, rect, 0.8, 22);
  drawFooter(page, rect, regular, 7, MUTED);
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

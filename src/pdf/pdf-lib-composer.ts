import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Ticket } from "../domain/types.ts";
import type { Composer, PageSpec } from "./composer.ts";
import { fullPageRect, slotRect, type CellRect, type PrintProfile } from "./profile.ts";

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

    const pageW = profile.paper.widthMm * (72 / 25.4);
    const pageH = profile.paper.heightMm * (72 / 25.4);

    for (const spec of pages) {
      const page = doc.addPage([pageW, pageH]);
      if (spec.kind === "grid") {
        drawGridPage(page, spec.slots, profile, regular, bold);
      } else {
        drawFullPage(page, spec.ticket, profile, regular, bold);
      }
    }

    return doc.save({ useObjectStreams: false });
  }
}

function drawGridPage(
  page: PDFPage,
  slots: readonly (Ticket | null)[],
  profile: PrintProfile,
  regular: PDFFont,
  bold: PDFFont,
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
    drawTicketCard(page, rect, ticket, regular, bold);
  });
}

function drawTicketCard(
  page: PDFPage,
  rect: CellRect,
  ticket: Ticket,
  regular: PDFFont,
  bold: PDFFont,
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

  const index = `${ticket.volumeIndex} of ${ticket.totalVolumes}`;
  page.drawText(index, { x: left, y: cursorY, size: 13, font: bold, color: INK });
  cursorY -= 18;

  page.drawText(fit(ticket.project, bold, 10, maxW), {
    x: left,
    y: cursorY,
    size: 10,
    font: bold,
    color: INK,
  });
  cursorY -= 13;

  page.drawText(fit(ticket.destination || "—", regular, 9, maxW), {
    x: left,
    y: cursorY,
    size: 9,
    font: regular,
    color: MUTED,
  });
  cursorY -= 13;

  page.drawText(fit(ticket.groupId, regular, 9, maxW), {
    x: left,
    y: cursorY,
    size: 9,
    font: regular,
    color: MUTED,
  });
}

function drawFullPage(
  page: PDFPage,
  ticket: Ticket,
  profile: PrintProfile,
  regular: PDFFont,
  bold: PDFFont,
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

  const centerX = rect.x + rect.width / 2;
  const total = String(ticket.totalVolumes);
  const bigSize = 180;
  const totalWidth = bold.widthOfTextAtSize(total, bigSize);
  page.drawText(total, {
    x: centerX - totalWidth / 2,
    y: rect.y + rect.height * 0.42,
    size: bigSize,
    font: bold,
    color: ACCENT,
  });

  const label = "TOTAL VOLUMES";
  const labelWidth = regular.widthOfTextAtSize(label, 16);
  page.drawText(label, {
    x: centerX - labelWidth / 2,
    y: rect.y + rect.height * 0.42 - 28,
    size: 16,
    font: regular,
    color: MUTED,
  });

  const lines = [ticket.project, ticket.destination || "—", ticket.groupId];
  let y = rect.y + rect.height * 0.22;
  for (const [i, line] of lines.entries()) {
    const font = i === 0 ? bold : regular;
    const size = i === 0 ? 22 : 16;
    const width = font.widthOfTextAtSize(line, size);
    page.drawText(fit(line, font, size, rect.width - PAD * 2), {
      x: centerX - width / 2,
      y,
      size,
      font,
      color: i === 0 ? INK : MUTED,
    });
    y -= size + 10;
  }
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

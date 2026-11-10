import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { Ticket } from "../domain/types.ts";
import type { Composer, PageSpec } from "./composer.ts";
import { slotRect, type CellRect, type PrintProfile } from "./profile.ts";
import { LOGO_PNG_BASE64 } from "./logo.ts";
import { COVER_LOGO_JPG_BASE64 } from "./cover-logo.ts";
import { COVER, coverLines } from "./cover-layout.ts";

const FIXED_DATE = new Date("2000-01-01T00:00:00.000Z");
const INK = rgb(0, 0, 0);
const BORDER = rgb(0.8, 0.8, 0.8);
const LOGO_ASPECT = 2984 / 405;

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
    const coverLogo = pages.some((page) => page.kind === "full")
      ? await doc.embedJpg(COVER_LOGO_JPG_BASE64)
      : undefined;
    const pageW = profile.paper.widthMm * (72 / 25.4);
    const pageH = profile.paper.heightMm * (72 / 25.4);

    for (const spec of pages) {
      const page = doc.addPage([pageW, pageH]);
      if (spec.kind === "grid") {
        const sheetProject = spec.slots.find((ticket) => ticket)?.project;
        spec.slots.forEach((ticket, slot) =>
          drawLabel(page, slotRect(profile, slot), ticket, sheetProject, regular, bold, logo),
        );
      } else {
        drawFullPage(page, spec.ticket, bold, coverLogo!);
      }
    }

    return doc.save({ useObjectStreams: false });
  }
}

/** The reference label's stamp, title, three details, and right footer. */
function drawLabel(
  page: PDFPage, rect: CellRect, ticket: Ticket | null,
  sheetProject: string | undefined,
  regular: PDFFont, bold: PDFFont, logo: PDFImage,
): void {
  page.drawRectangle({
    x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    borderColor: BORDER, borderWidth: 0.8,
  });

  const left = rect.x + 10;
  const maxW = rect.width - 20;
  const top = rect.y + rect.height;
  drawStamp(page, logo, rect, top - 46, rect.width - 20);
  const project = ticket?.project ?? sheetProject;
  drawCentered(page, labelTitle(project), bold, 11, maxW, rect.x + rect.width / 2, top - 66);

  const details = ticket
    ? [
        `MUNICÍPIO: ${ticket.destination || "—"}`,
        `VOLUME: ${ticket.volumeIndex ?? ticket.totalVolumes}/${ticket.totalVolumes}`,
        ticket.nfeNumber ? `NF DO FORNECEDOR: ${ticket.nfeNumber}` : "NF DO FORNECEDOR:",
      ]
    : ["MUNICÍPIO:", "VOLUME:       /", "NF DO FORNECEDOR:"];
  details.forEach((line, index) => {
    page.drawText(fit(line.toUpperCase(), bold, 11, maxW), {
      x: left, y: top - 86 - index * 16, size: 11, font: bold, color: INK,
    });
  });

  drawRight(page, footer(project), bold, 9, maxW, rect.x + rect.width - 10, rect.y + 7);
}

function labelTitle(project?: string): string {
  if (project === "MMH") return "MATERIAL MÉDICO HOSPITALAR";
  if (!project || project === "FARMACIS" || project === "MEDICAMENTOS") return "MEDICAMENTO";
  return project.toUpperCase();
}

function footer(project?: string): string {
  return project ? `${project.toUpperCase()}-ESTADO` : "FARMACIS-ESTADO";
}

function drawStamp(page: PDFPage, logo: PDFImage, rect: CellRect, y: number, width: number): void {
  const height = width / LOGO_ASPECT;
  page.drawImage(logo, {
    x: rect.x + (rect.width - width) / 2, y, width, height,
  });
}

/** Reproduce the frame, logo, typography, and spacing of docs/capa.pdf. */
function drawFullPage(
  page: PDFPage, ticket: Ticket, bold: PDFFont, logo: PDFImage,
): void {
  const sx = page.getWidth() / COVER.width;
  const sy = page.getHeight() / COVER.height;
  for (const box of COVER.frame) {
    page.drawRectangle({
      x: box.x * sx, y: page.getHeight() - (box.y + box.height) * sy,
      width: box.width * sx, height: box.height * sy, color: INK,
    });
  }
  const stamp = COVER.logo;
  page.drawImage(logo, {
    x: stamp.x * sx, y: page.getHeight() - (stamp.y + stamp.height) * sy,
    width: stamp.width * sx, height: stamp.height * sy,
  });
  coverLines(ticket).forEach((line, index) => {
    // Keep long municipality names complete by reducing their type size.
    const size = Math.min(COVER.fontSize, COVER.fontSize * COVER.maxTextWidth /
      bold.widthOfTextAtSize(line, COVER.fontSize)) * Math.min(sx, sy);
    drawCentered(page, line, bold, size, COVER.maxTextWidth * sx,
      page.getWidth() / 2, page.getHeight() - COVER.baselines[index]! * sy);
  });
}

function drawCentered(
  page: PDFPage, value: string, font: PDFFont, size: number,
  maxWidth: number, centerX: number, y: number,
): void {
  const shown = fit(value, font, size, maxWidth);
  page.drawText(shown, {
    x: centerX - font.widthOfTextAtSize(shown, size) / 2,
    y, size, font, color: INK,
  });
}

function drawRight(
  page: PDFPage, value: string, font: PDFFont, size: number,
  maxWidth: number, rightX: number, y: number,
): void {
  const shown = fit(value, font, size, maxWidth);
  page.drawText(shown, {
    x: rightX - font.widthOfTextAtSize(shown, size),
    y, size, font, color: INK,
  });
}

function fit(value: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

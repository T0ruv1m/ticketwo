export interface PaperSize {
  widthMm: number;
  heightMm: number;
}

export interface PrintProfile {
  name: string;
  paper: PaperSize;
  marginMm: number;
  gutterMm: number;
  cols: number;
  rows: number;
}

export const MM_TO_PT = 72 / 25.4;

export const A4_PROFILE: PrintProfile = {
  name: "A4",
  paper: { widthMm: 210, heightMm: 297 },
  marginMm: 10,
  gutterMm: 5,
  cols: 2,
  rows: 5,
};

export function profileSlots(profile: PrintProfile): number {
  return profile.cols * profile.rows;
}

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Slot 0..n-1 laid out column-major, top to bottom. Origin is bottom-left (PDF). */
export function slotRect(profile: PrintProfile, slot: number): CellRect {
  const { cols, rows } = profile;
  const col = Math.floor(slot / rows);
  const row = slot % rows;
  const pageW = profile.paper.widthMm * MM_TO_PT;
  const pageH = profile.paper.heightMm * MM_TO_PT;
  const margin = profile.marginMm * MM_TO_PT;
  const gutter = profile.gutterMm * MM_TO_PT;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;
  const cellW = (availW - gutter * (cols - 1)) / cols;
  const cellH = (availH - gutter * (rows - 1)) / rows;
  const x = margin + col * (cellW + gutter);
  const y = pageH - margin - (row + 1) * cellH - row * gutter;
  return { x, y, width: cellW, height: cellH };
}

export function fullPageRect(profile: PrintProfile): CellRect {
  const pageW = profile.paper.widthMm * MM_TO_PT;
  const pageH = profile.paper.heightMm * MM_TO_PT;
  const margin = profile.marginMm * MM_TO_PT;
  return {
    x: margin,
    y: margin,
    width: pageW - margin * 2,
    height: pageH - margin * 2,
  };
}

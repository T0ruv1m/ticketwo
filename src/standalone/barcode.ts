import { toCanvas } from 'bwip-js/browser';
export async function toBuffer(options: Parameters<typeof toCanvas>[1]): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  toCanvas(canvas, options);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Barcode export failed'))));
  return new Uint8Array(await blob.arrayBuffer());
}

import { degrees, PDFDocument } from 'pdf-lib';
import type { PageViewport } from 'pdfjs-dist';

export interface Placement {
  id: number;
  page: number;
  image: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export type PagePoint = Pick<Placement, 'x' | 'y'>;

export function signatureBounds(
  ratio: number,
  viewport: Pick<PageViewport, 'width' | 'height'>,
  point: PagePoint = { x: 0.5, y: 0.5 },
) {
  const width = Math.min(0.07, 0.7 * viewport.height / (viewport.width * ratio));
  const height = width * viewport.width * ratio / viewport.height;
  return {
    x: clamp(point.x - width / 2, 0, 1 - width),
    y: clamp(point.y - height / 2, 0, 1 - height),
    width,
    height,
  };
}

export function resizeSignatureBounds(
  placement: Pick<Placement, 'x' | 'y' | 'width' | 'height'>,
  requestedWidth: number,
) {
  const ratio = placement.height / placement.width;
  const maxWidth = Math.min(0.9, 1 - placement.x, (1 - placement.y) / ratio);
  const width = clamp(requestedWidth, Math.min(0.01, maxWidth), maxWidth);
  return { ...placement, width, height: width * ratio };
}

export function imageGeometry(
  placement: Pick<Placement, 'x' | 'y' | 'width' | 'height'>,
  viewport: PageViewport,
) {
  const left = placement.x * viewport.width;
  const bottom = (placement.y + placement.height) * viewport.height;
  const [x, y] = viewport.convertToPdfPoint(left, bottom);
  const [rightX, rightY] = viewport.convertToPdfPoint(left + placement.width * viewport.width, bottom);
  const [topX, topY] = viewport.convertToPdfPoint(left, bottom - placement.height * viewport.height);
  return {
    x,
    y,
    width: Math.hypot(rightX - x, rightY - y),
    height: Math.hypot(topX - x, topY - y),
    rotate: degrees(Math.atan2(rightY - y, rightX - x) * 180 / Math.PI),
  };
}

export async function signPdf(
  original: Uint8Array,
  placements: Placement[],
  viewports: Map<number, PageViewport>,
): Promise<Uint8Array> {
  const document = await PDFDocument.load(original);
  const images = new Map<string, Awaited<ReturnType<typeof document.embedPng>>>();
  for (const placement of placements) {
    const viewport = viewports.get(placement.page);
    if (!viewport) throw new Error(`Missing page geometry for page ${placement.page}.`);
    let image = images.get(placement.image);
    if (!image) {
      image = await document.embedPng(placement.image);
      images.set(placement.image, image);
    }
    document.getPage(placement.page - 1).drawImage(image, imageGeometry(placement, viewport));
  }
  return document.save();
}

import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, degrees } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { clamp, imageGeometry, signPdf, signatureBounds, resizeSignatureBounds, type Placement } from './pdf';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const placement: Placement = { id: 1, page: 1, image: png, x: 0.1, y: 0.2, width: 0.3, height: 0.1 };

async function viewport(rotation = 0, viewBox = [0, 0, 600, 800]) {
  const source = await PDFDocument.create();
  const page = source.addPage([600, 800]);
  page.setRotation(degrees(rotation));
  page.setCropBox(viewBox[0], viewBox[1], viewBox[2] - viewBox[0], viewBox[3] - viewBox[1]);
  const document = await getDocument({ data: await source.save(), isEvalSupported: false }).promise;
  try {
    return (await document.getPage(1)).getViewport({ scale: 1 });
  } finally {
    await document.destroy();
  }
}

describe('signature geometry', () => {
  it('resizes a signature without changing its position or aspect ratio', () => {
    const result = resizeSignatureBounds(placement, 0.5);
    expect(result.x).toBe(placement.x);
    expect(result.y).toBe(placement.y);
    expect(result.width).toBeCloseTo(0.5);
    expect(result.height / result.width).toBeCloseTo(placement.height / placement.width);
  });

  it('constrains resizing to both page edges and a positive minimum', () => {
    const corner = { ...placement, x: 0.8, y: 0.95, width: 0.1, height: 0.04 };
    const enlarged = resizeSignatureBounds(corner, 1);
    expect(enlarged.x + enlarged.width).toBeLessThanOrEqual(1);
    expect(enlarged.y + enlarged.height).toBeLessThanOrEqual(1);
    expect(enlarged.x).toBe(corner.x);
    expect(enlarged.y).toBe(corner.y);
    const shrunk = resizeSignatureBounds(corner, -0.5);
    expect(shrunk.width).toBeCloseTo(0.01);
    expect(shrunk.height).toBeGreaterThan(0);
  });

  it('centers a dragged signature on the exact drop position', () => {
    const bounds = signatureBounds(0.25, { width: 600, height: 800 }, { x: 0.7, y: 0.8 });
    expect(bounds.width).toBeCloseTo(0.07);
    expect(bounds.x + bounds.width / 2).toBeCloseTo(0.7);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(0.8);
    expect(bounds.width * 600 * 0.25).toBeCloseTo(bounds.height * 800);
  });

  it.each([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: -0.1, y: 1.1 }])(
    'keeps signatures dropped at page edges entirely on the page: %o',
    point => {
      const bounds = signatureBounds(0.5, { width: 800, height: 600 }, point);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(1);
    },
  );

  it('preserves centered click insertion and fits tall signatures', () => {
    const bounds = signatureBounds(10, { width: 800, height: 600 });
    expect(bounds.x + bounds.width / 2).toBeCloseTo(0.5);
    expect(bounds.y + bounds.height / 2).toBeCloseTo(0.5);
    expect(bounds.height).toBeCloseTo(0.7);
  });

  it('converts top-left browser coordinates to bottom-left PDF coordinates', async () => {
    const geometry = imageGeometry(placement, await viewport());
    expect(geometry.x).toBeCloseTo(60);
    expect(geometry.y).toBeCloseTo(560);
    expect(geometry.width).toBeCloseTo(180);
    expect(geometry.height).toBeCloseTo(80);
    expect(geometry.rotate.angle).toBeCloseTo(0);
  });

  it.each([0, 90, 180, 270])('matches preview coordinates at %i degrees with a crop offset', async rotation => {
    const view = await viewport(rotation, [20, 40, 580, 760]);
    const geometry = imageGeometry(placement, view);
    const angle = geometry.rotate.angle * Math.PI / 180;
    const bottomLeft = view.convertToViewportPoint(geometry.x, geometry.y);
    const topRight = view.convertToViewportPoint(
      geometry.x + geometry.width * Math.cos(angle) - geometry.height * Math.sin(angle),
      geometry.y + geometry.width * Math.sin(angle) + geometry.height * Math.cos(angle),
    );
    expect(bottomLeft[0]).toBeCloseTo(placement.x * view.width);
    expect(bottomLeft[1]).toBeCloseTo((placement.y + placement.height) * view.height);
    expect(topRight[0]).toBeCloseTo((placement.x + placement.width) * view.width);
    expect(topRight[1]).toBeCloseTo(placement.y * view.height);
  });

  it('keeps dragged signatures in bounds', () => {
    expect(clamp(-0.2, 0, 0.7)).toBe(0);
    expect(clamp(0.9, 0, 0.7)).toBe(0.7);
    expect(clamp(0.4, 0, 0.7)).toBe(0.4);
  });
});

describe('PDF export', () => {
  it('exports three visible copies of the same signature on one page', async () => {
    const source = await PDFDocument.create();
    source.addPage([600, 800]);
    const copies = [0.1, 0.4, 0.7].map((y, index) => ({ ...placement, id: index + 1, y }));
    const result = await signPdf(await source.save(), copies, new Map([[1, await viewport()]]));
    const document = await getDocument({ data: result, isEvalSupported: false }).promise;
    try {
      const operations = await (await document.getPage(1)).getOperatorList();
      expect(operations.fnArray.filter(operation => operation === OPS.paintImageXObject)).toHaveLength(3);
    } finally {
      await document.destroy();
    }
  });

  it('embeds multiple signatures on different pages without changing the original', async () => {
    const source = await PDFDocument.create();
    source.addPage([600, 800]).drawText('Original page');
    source.addPage([600, 800]).setRotation(degrees(90));
    const original = await source.save();
    const unchanged = original.slice();
    const result = await signPdf(original, [placement, { ...placement, id: 2, page: 2 }],
      new Map([[1, await viewport()], [2, await viewport(90)]]));
    const signed = await PDFDocument.load(result);
    expect(signed.getPageCount()).toBe(2);
    expect(signed.getPage(1).getRotation().angle).toBe(90);
    for (const page of signed.getPages()) {
      const images = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
      expect(images?.keys().length).toBe(1);
      expect(page.node.Contents()).toBeDefined();
    }
    expect(result.length).toBeGreaterThan(original.length);
    expect(original).toEqual(unchanged);
  });

  it('reports missing geometry rather than producing a misleading export', async () => {
    const source = await PDFDocument.create();
    source.addPage();
    await expect(signPdf(await source.save(), [placement], new Map())).rejects.toThrow('Missing page geometry');
  });
});

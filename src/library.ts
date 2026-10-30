export interface Signature {
  id: string;
  name: string;
  image: string;
  ratio: number;
}

export function removeWhiteBackground(pixels: Uint8ClampedArray, opaqueInk: boolean): void {
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const minimum = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    const coverage = 1 - minimum / 255;
    const alpha = Math.round(pixels[offset + 3] * coverage);
    pixels[offset + 3] = opaqueInk ? (alpha > 8 ? 255 : 0) : alpha;
    if (coverage > 0) {
      for (let channel = 0; channel < 3; channel++) {
        pixels[offset + channel] = Math.round((pixels[offset + channel] - minimum) / coverage);
      }
    }
  }
}

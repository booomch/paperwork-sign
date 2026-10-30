import { describe, expect, it } from 'vitest';
import { removeWhiteBackground } from './library';

describe('signature background removal', () => {
  it('makes visible strokes opaque while leaving white and invisible pixels transparent', () => {
    const pixels = new Uint8ClampedArray([
      255, 255, 255, 255,
      128, 128, 128, 255,
      220, 220, 220, 255,
      0, 0, 0, 128,
      0, 0, 0, 0,
      254, 254, 254, 255,
    ]);
    removeWhiteBackground(pixels, true);
    expect(Array.from(pixels)).toEqual([
      255, 255, 255, 0,
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
  });

  it('retains the original soft transparency when opaque ink is disabled', () => {
    const pixels = new Uint8ClampedArray([128, 128, 128, 255, 0, 0, 0, 128]);
    removeWhiteBackground(pixels, false);
    expect(Array.from(pixels)).toEqual([0, 0, 0, 127, 0, 0, 0, 128]);
  });

  it('preserves colored ink without the white-paper tint', () => {
    const pixels = new Uint8ClampedArray([128, 128, 255, 255]);
    removeWhiteBackground(pixels, true);
    expect(Array.from(pixels)).toEqual([0, 0, 255, 255]);
  });
});

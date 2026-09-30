// Photo quality measured from pixels. Deterministic, no AI.
//
// Everything is measured on a copy resized to a fixed width so the numbers are
// comparable across photos of different resolutions.

import sharp, { type Sharp } from "sharp";
import type { PhotoMetrics } from "../claims/types.ts";

const ANALYSIS_WIDTH = 768;
const TILES = 4;

export async function measurePhoto(name: string, image: Buffer): Promise<Omit<PhotoMetrics, "nearDuplicateOf">> {
  const meta = await sharp(image).metadata();
  const width = meta.autoOrient?.width ?? meta.width ?? 0;
  const height = meta.autoOrient?.height ?? meta.height ?? 0;

  const small = sharp(image).rotate().resize({ width: ANALYSIS_WIDTH, withoutEnlargement: false });

  const grey = await small.clone().greyscale().raw().toBuffer();
  let sum = 0;
  let clipped = 0;
  for (const v of grey) {
    sum += v;
    if (v >= 245) clipped++;
  }
  const brightness = sum / grey.length;

  const sharpness = await sharpestRegion(small.clone());

  // Greyscale if the colour channels barely differ anywhere.
  const rgb = await small.clone().removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  let greyscale = rgb.info.channels < 3;
  if (!greyscale) {
    let diff = 0;
    const n = rgb.data.length / rgb.info.channels;
    for (let i = 0; i < rgb.data.length; i += rgb.info.channels) {
      const r = rgb.data[i];
      const g = rgb.data[i + 1];
      const b = rgb.data[i + 2];
      diff += Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
    }
    greyscale = diff / n < 4;
  }

  return {
    name,
    width,
    height,
    brightness: round(brightness, 1),
    sharpness: round(sharpness, 2),
    clippedHighlights: round(clipped / grey.length, 3),
    greyscale,
  };
}

// Variance of the Laplacian per tile, taking the 90th percentile tile. A sharp
// close-up of a smooth panel still has crisp edges somewhere (a door handle, a
// panel gap); a blurred photo has none. Tuned on very few images, so it is
// used only as a backstop for very soft photos.
async function sharpestRegion(img: Sharp): Promise<number> {
  const { data, info } = await img.greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const vals: number[] = [];
  for (let ty = 0; ty < TILES; ty++) {
    for (let tx = 0; tx < TILES; tx++) {
      const x0 = Math.floor((tx * W) / TILES) + 1;
      const x1 = Math.floor(((tx + 1) * W) / TILES) - 1;
      const y0 = Math.floor((ty * H) / TILES) + 1;
      const y1 = Math.floor(((ty + 1) * H) / TILES) - 1;
      let s = 0;
      let s2 = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * W + x;
          const l = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - W] - data[i + W];
          s += l;
          s2 += l * l;
          n++;
        }
      }
      vals.push(n ? s2 / n - (s / n) ** 2 : 0);
    }
  }
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.9)];
}

function round(n: number, dp: number) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

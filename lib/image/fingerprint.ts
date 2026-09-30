// Near-duplicate photo check. A small "difference hash" of each photo is
// compared with photos from past claims, including a mirrored copy, so a
// flipped and recompressed reuse is still caught.
//
// In the prototype the "past claims" are a fixed list in past-claims.json.
// In production this would be an index across every photo the carrier holds.

import sharp, { type Sharp } from "sharp";
import pastClaims from "./past-claims.json" with { type: "json" };

const MATCH_DISTANCE = 10; // out of 64 bits

export async function fingerprint(image: Buffer): Promise<{ hash: string; mirrored: string }> {
  const base = sharp(image).rotate();
  return {
    hash: await dHash(base.clone()),
    mirrored: await dHash(base.clone().flop()),
  };
}

async function dHash(img: Sharp): Promise<string> {
  const px = await img.greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
  }
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

export function distance(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export interface PastClaimPhoto {
  claimId: string;
  photo: string;
  hash: string;
}

export const DEMO_PAST_CLAIMS = pastClaims as PastClaimPhoto[];

export function findPastClaimMatch(
  fp: { hash: string; mirrored: string },
  index: PastClaimPhoto[] = DEMO_PAST_CLAIMS,
): string | null {
  for (const p of index) {
    if (distance(fp.hash, p.hash) <= MATCH_DISTANCE || distance(fp.mirrored, p.hash) <= MATCH_DISTANCE) {
      return p.claimId;
    }
  }
  return null;
}

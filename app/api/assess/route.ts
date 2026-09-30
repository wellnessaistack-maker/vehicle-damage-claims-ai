// POST /api/assess: assess one claim (one or more photos).
// Photos arrive as base64 (already shrunk in the browser) or as https links,
// which are fetched through the safe fetcher. Nothing is stored.

import sharp from "sharp";
import { z } from "zod";

import { claimSchema } from "@/lib/claims/schema.ts";
import { MODELS } from "@/lib/extraction/models.ts";
import { fetchImage, sniffImageType, UnsafeUrlError } from "@/lib/net/safe-fetch.ts";
import { assessCase } from "@/lib/pipeline.ts";
import { clampSettings } from "@/lib/policy/protocol.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_PHOTOS = 8;
// Vercel rejects request bodies over 4.5 MB before our code runs; stay under it.
const MAX_BODY_BYTES = 4_400_000;

const bodySchema = z.object({
  claim: claimSchema,
  photos: z
    .array(
      z.union([
        z.object({ name: z.string().max(200), base64: z.string().min(1) }),
        z.object({ name: z.string().max(200), url: z.string().min(1).max(2048) }),
      ]),
    )
    .min(1)
    .max(MAX_PHOTOS),
  settings: z.record(z.string(), z.unknown()).optional(),
  model: z.enum(MODELS.map((m) => m.id) as [string, ...string[]]).optional(),
  simulate: z.enum(["timeout", "invalid_output"]).optional(),
});

export async function POST(req: Request) {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return error(413, "Those photos are too large to send in one go. Try fewer photos per claim.");
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return error(400, `The request wasn't in the expected format. A claim can have 1 to ${MAX_PHOTOS} photos.`);
  }

  const photos: { name: string; data: Buffer }[] = [];
  // Shrunk copies of photos fetched from links, returned so the browser can show
  // them and reuse them without fetching again. Not stored anywhere.
  const fetched: Record<number, string> = {};
  for (const [i, p] of body.photos.entries()) {
    if ("url" in p) {
      try {
        const { data } = await fetchImage(p.url);
        photos.push({ name: p.name, data });
        const preview = await sharp(data).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        fetched[i] = preview.toString("base64");
      } catch (e) {
        return error(400, e instanceof UnsafeUrlError ? e.message : "We couldn't download that link.");
      }
    } else {
      const data = Buffer.from(p.base64, "base64");
      if (!sniffImageType(data)) return error(400, `${p.name} isn't a JPEG, PNG or WebP image.`);
      photos.push({ name: p.name, data });
    }
  }

  try {
    const result = await assessCase({
      claim: body.claim,
      photos,
      settings: clampSettings(body.settings ?? {}),
      model: body.model,
      simulate: body.simulate,
    });
    return Response.json({ ...result, fetched });
  } catch {
    return error(500, "Something went wrong preparing the photos.");
  }
}

function error(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

// Fetches a photo from a URL the reviewer pasted, without letting that URL
// reach anything internal.
//
// - https only, on the default port, no usernames or passwords in the URL
// - every address the hostname resolves to is checked against private,
//   loopback, link-local (including cloud metadata), carrier-grade NAT,
//   multicast and reserved ranges; the check runs at connect time, so a DNS
//   answer that changes between check and connect can't slip through
// - redirects are followed by hand, at most 3, and each hop is checked again
// - only JPEG, PNG or WebP, confirmed from the file's first bytes
// - at most 10 MB, and the whole fetch gives up after 8 seconds

import { lookup as dnsLookup } from "node:dns";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

export const MAX_URL_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

export class UnsafeUrlError extends Error {}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const lower = address.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) carry an IPv4 address inside.
    const embedded = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (embedded) return blocked.check(embedded[1], "ipv4");
    if (lower.startsWith("::ffff:") || lower.startsWith("64:ff9b::")) return true;
    return blocked.check(address, "ipv6");
  }
  return true;
}

export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid link.");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Only https links are accepted.");
  if (url.username || url.password) throw new UnsafeUrlError("Links with a username or password aren't accepted.");
  if (url.port && url.port !== "443") throw new UnsafeUrlError("Links to non-standard ports aren't accepted.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new UnsafeUrlError("Links to internal addresses aren't accepted.");
  }
  if (isIP(host) && isBlockedAddress(host)) throw new UnsafeUrlError("Links to internal addresses aren't accepted.");
  return url;
}

/** DNS lookup that refuses to hand back any blocked address. */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as { address: string; family: number }[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(new UnsafeUrlError("That link points to an internal address."), "", 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export function sniffImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function fetchImage(raw: string): Promise<{ data: Buffer; type: ImageType; finalUrl: string }> {
  const deadline = Date.now() + TIMEOUT_MS;
  let url = checkUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await get(url, deadline);
    if (res.redirect) {
      if (hop === MAX_REDIRECTS) throw new UnsafeUrlError("That link redirects too many times.");
      url = checkUrl(new URL(res.redirect, url).toString());
      continue;
    }
    const type = sniffImageType(res.body!);
    if (!type) throw new UnsafeUrlError("That link isn't a JPEG, PNG or WebP image.");
    return { data: res.body!, type, finalUrl: url.toString() };
  }
  throw new UnsafeUrlError("That link redirects too many times.");
}

function get(url: URL, deadline: number): Promise<{ redirect?: string; body?: Buffer }> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new UnsafeUrlError("That link took too long to respond."));
    const req = https.get(
      url,
      { lookup: guardedLookup, timeout: remaining, headers: { accept: "image/jpeg,image/png,image/webp", "user-agent": "claims-intake-prototype" } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: res.headers.location });
        }
        if (status !== 200) {
          res.resume();
          return reject(new UnsafeUrlError(`That link returned an error (HTTP ${status}).`));
        }
        const ctype = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (ctype && !["image/jpeg", "image/jpg", "image/png", "image/webp", "application/octet-stream"].includes(ctype)) {
          res.resume();
          return reject(new UnsafeUrlError("That link isn't a JPEG, PNG or WebP image."));
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > MAX_URL_BYTES) {
          res.resume();
          return reject(new UnsafeUrlError("That image is larger than 10 MB."));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_URL_BYTES) {
            req.destroy(new UnsafeUrlError("That image is larger than 10 MB."));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new UnsafeUrlError("That link took too long to respond.")));
    req.on("error", (e) => reject(e instanceof UnsafeUrlError ? e : new UnsafeUrlError("We couldn't download that link.")));
  });
}

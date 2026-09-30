// Browser-side intake: read dropped files and folders, group them into claims,
// and shrink each photo before upload. Shrinking keeps a claim's photos under
// Vercel's 4.5 MB request limit and strips location data from the originals.

export interface IncomingFile {
  file: File;
  /** Path including any folders, e.g. "demo-images/A-straightforward/photo.jpg". */
  path: string;
}

export interface CasePhoto {
  name: string;
  base64: string;
  dataUrl: string;
  source: "upload" | "url" | "demo";
  url?: string;
}

export interface IntakeGroup {
  folder: string | null;
  files: IncomingFile[];
}

const MAX_EDGE = 1600;
const QUALITY = 0.85;

export type FileKind = "image" | "heic" | "video" | "other";

export function kindOf(file: File): FileKind {
  const name = file.name.toLowerCase();
  if (/\.(heic|heif)$/.test(name) || /heic|heif/.test(file.type)) return "heic";
  if (file.type.startsWith("video/") || /\.(mov|mp4|m4v|avi|webm)$/.test(name)) return "video";
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type) || /\.(jpe?g|png|webp)$/.test(name)) return "image";
  return "other";
}

export const REJECTION_MESSAGES: Record<Exclude<FileKind, "image">, string> = {
  heic: "iPhone HEIC photos aren't supported yet. Please export them as JPEG, or share them from the Photos app, which converts them.",
  video: "Video isn't supported yet. Please upload photos, or a few screenshots from your video.",
  other: "Only JPEG, PNG and WebP photos are accepted.",
};

/** Reads everything dropped, walking into folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<IncomingFile[]> {
  const entries = Array.from(dt.items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (entries.length === 0) return Array.from(dt.files).map((file) => ({ file, path: file.name }));
  const out: IncomingFile[] = [];
  await Promise.all(entries.map((e) => walk(e, "", out)));
  return out;
}

async function walk(entry: FileSystemEntry, prefix: string, out: IncomingFile[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    if (!entry.name.startsWith(".")) out.push({ file, path });
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  // readEntries returns results in batches; keep reading until it's empty.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (batch.length === 0) break;
    children.push(...batch);
  }
  await Promise.all(children.map((c) => walk(c, path, out)));
}

export function filesFromInput(list: FileList): IncomingFile[] {
  return Array.from(list)
    .filter((f) => !f.name.startsWith("."))
    .map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/**
 * A folder is one claim. Photos dropped on their own become one claim, or one
 * claim each, depending on the reviewer's choice.
 */
export function groupIntoCases(files: IncomingFile[], loose: "one" | "each"): IntakeGroup[] {
  const byFolder = new Map<string, IncomingFile[]>();
  const looseFiles: IncomingFile[] = [];
  for (const f of files) {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    if (!dir) looseFiles.push(f);
    else byFolder.set(dir, [...(byFolder.get(dir) ?? []), f]);
  }
  const groups: IntakeGroup[] = [...byFolder.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, fs]) => ({ folder, files: fs.sort((a, b) => a.path.localeCompare(b.path)) }));
  if (looseFiles.length) {
    if (loose === "one") groups.push({ folder: null, files: looseFiles });
    else looseFiles.forEach((f) => groups.push({ folder: null, files: [f] }));
  }
  return groups;
}

export async function shrink(blob: Blob, name: string, source: CasePhoto["source"], url?: string): Promise<CasePhoto> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process images.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
  return { name, dataUrl, base64: dataUrl.slice(dataUrl.indexOf(",") + 1), source, url };
}

export async function loadDemoPhoto(path: string): Promise<CasePhoto> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Couldn't load ${path}`);
  return shrink(await res.blob(), path.split("/").pop()!, "demo");
}

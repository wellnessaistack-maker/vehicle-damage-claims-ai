"use client";

import { useMemo, useRef, useState } from "react";

import {
  filesFromDrop,
  filesFromInput,
  groupIntoCases,
  kindOf,
  REJECTION_MESSAGES,
  shrink,
  type CasePhoto,
  type IncomingFile,
} from "@/lib/client/intake.ts";

export interface NewCase {
  folder: string | null;
  photos: CasePhoto[];
}

const MAX_PHOTOS_PER_CLAIM = 8;

export function IntakeModal({ onClose, onAdd }: { onClose: () => void; onAdd: (cases: NewCase[]) => void }) {
  const [files, setFiles] = useState<IncomingFile[]>([]);
  const [loose, setLoose] = useState<"one" | "each">("each");
  const [urls, setUrls] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pickFiles = useRef<HTMLInputElement>(null);
  const pickFolder = useRef<HTMLInputElement>(null);

  const accepted = files.filter((f) => kindOf(f.file) === "image");
  const rejected = files.filter((f) => kindOf(f.file) !== "image");
  const groups = useMemo(() => groupIntoCases(accepted, loose), [accepted, loose]);
  const hasLoose = accepted.some((f) => !f.path.includes("/"));
  const urlList = urls
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);
  const tooMany = groups.find((g) => g.files.length > MAX_PHOTOS_PER_CLAIM);
  const claimCount = groups.length + urlList.length;

  const rejectionReasons = [...new Set(rejected.map((f) => REJECTION_MESSAGES[kindOf(f.file) as Exclude<ReturnType<typeof kindOf>, "image">]))];

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const fromFiles: NewCase[] = await Promise.all(
        groups.map(async (g) => ({
          folder: g.folder,
          photos: await Promise.all(g.files.map((f) => shrink(f.file, f.path.split("/").pop()!, "upload"))),
        })),
      );
      const fromUrls: NewCase[] = urlList.map((u) => ({
        folder: null,
        photos: [{ name: decodeURIComponent(u.split("?")[0].split("/").pop() || "linked-photo"), base64: "", dataUrl: "", source: "url", url: u }],
      }));
      onAdd([...fromFiles, ...fromUrls]);
    } catch {
      setErr("One of the photos couldn't be read. Check that it's a JPEG, PNG or WebP image.");
      setBusy(false);
    }
  };

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add photos">
        <div className="drawer-head">
          <h2>Add photos</h2>
          <span className="sub">No claim form needed. Photos are shrunk in your browser and never stored.</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <div
            className={`dropzone ${over ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setOver(false);
              const dropped = await filesFromDrop(e.dataTransfer);
              setFiles((fs) => [...fs, ...dropped]);
            }}
          >
            <div>
              <b>Drop photos or folders here</b>
            </div>
            <div className="hint" style={{ margin: "6px 0 10px" }}>
              One photo, a folder of photos for one claim, or a folder of claim folders.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button className="btn btn-sm" onClick={() => pickFiles.current?.click()}>
                Choose photos
              </button>
              <button className="btn btn-sm" onClick={() => pickFolder.current?.click()}>
                Choose a folder
              </button>
            </div>
            <input ref={pickFiles} type="file" multiple accept="image/*,video/*,.heic,.heif" hidden onChange={(e) => e.target.files && setFiles((fs) => [...fs, ...filesFromInput(e.target.files!)])} />
            <input
              ref={pickFolder}
              type="file"
              hidden
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => e.target.files && setFiles((fs) => [...fs, ...filesFromInput(e.target.files!)])}
            />
          </div>

          {hasLoose && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="hint">Photos not in a folder are</span>
              <div className="seg">
                <button className={loose === "each" ? "on" : ""} onClick={() => setLoose("each")}>
                  One claim per photo
                </button>
                <button className={loose === "one" ? "on" : ""} onClick={() => setLoose("one")}>
                  All one claim
                </button>
              </div>
            </div>
          )}

          {groups.length > 0 && (
            <table className="t">
              <thead>
                <tr>
                  <th>Claim</th>
                  <th>Photos</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr key={i}>
                    <td>{g.folder ? g.folder.split("/").pop() : "Loose photos"}</td>
                    <td>{g.files.map((f) => f.path.split("/").pop()).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {rejectionReasons.length > 0 && (
            <div className="err">
              {rejected.length} file{rejected.length === 1 ? "" : "s"} skipped. {rejectionReasons.join(" ")}
            </div>
          )}
          {tooMany && <div className="err">A claim can have up to {MAX_PHOTOS_PER_CLAIM} photos. &quot;{tooMany.folder ?? "Loose photos"}&quot; has {tooMany.files.length}.</div>}

          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span>
              <b>Or paste photo links</b> <span className="hint">(https, one per line; each link is one claim)</span>
            </span>
            <textarea className="text-input" rows={2} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://example.com/damaged-car.jpg" />
            <span className="hint">Links are fetched by the server, which blocks internal addresses and anything that isn&apos;t a JPEG, PNG or WebP under 10 MB.</span>
          </label>
          {err && <div className="err">{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || claimCount === 0 || !!tooMany} onClick={() => void submit()}>
            {busy ? "Preparing..." : `Add ${claimCount || ""} claim${claimCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

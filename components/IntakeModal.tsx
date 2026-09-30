"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  const [loose, setLoose] = useState<"one" | "each">("one");
  const [urls, setUrls] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(false);
  // Thumbnails from local files; released when the dialog closes.
  const urlsFor = useRef(new Map<File, string>());
  const preview = (f: File) => {
    let u = urlsFor.current.get(f);
    if (!u) {
      u = URL.createObjectURL(f);
      urlsFor.current.set(f, u);
    }
    return u;
  };
  useEffect(() => {
    const map = urlsFor.current;
    return () => {
      map.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);
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
      <div className="modal intake" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add photos">
        <div className="drawer-head">
          <h2>Add photos</h2>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <div
            className={`dropzone big ${over ? "over" : ""} ${accepted.length ? "compact" : ""}`}
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
            {!accepted.length && (
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M4 7h3l2-3h6l2 3h3v12H4z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
            <div className="dz-title">{accepted.length ? "Add more photos" : "Drop the customer's photos here"}</div>
            <div className="dz-actions">
              <button className="btn btn-primary" onClick={() => pickFiles.current?.click()}>
                Choose photos
              </button>
              <button className="linkish" onClick={() => pickFolder.current?.click()} title="Each folder becomes one claim; a folder of folders adds several claims">
                or a folder
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

          {groups.length > 0 && (
            <div className="intake-groups">
              {hasLoose && accepted.filter((f) => !f.path.includes("/")).length > 1 && (
                <div className="intake-choice">
                  <span>These photos show</span>
                  <div className="seg seg-sm">
                    <button className={loose === "one" ? "on" : ""} onClick={() => setLoose("one")}>
                      The same car (one claim)
                    </button>
                    <button className={loose === "each" ? "on" : ""} onClick={() => setLoose("each")}>
                      Different cars
                    </button>
                  </div>
                </div>
              )}
              {groups.map((g, i) => (
                <div key={i} className="intake-group">
                  <div className="intake-group-head">
                    Claim {i + 1}
                    {g.folder && <span className="hint"> · {g.folder.split("/").pop()}</span>}
                    <span className="hint"> · {g.files.length} photo{g.files.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="thumbs">
                    {g.files.map((f) => (
                      <div key={f.path} className="thumb" title={f.path}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={preview(f.file)} alt={f.path} />
                        <button className="thumb-x" aria-label={`Remove ${f.path}`} onClick={() => setFiles((fs) => fs.filter((x) => x !== f))}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {rejectionReasons.length > 0 && (
            <div className="err">
              {rejected.length} file{rejected.length === 1 ? "" : "s"} skipped. {rejectionReasons.join(" ")}
            </div>
          )}
          {tooMany && <div className="err">A claim can have up to {MAX_PHOTOS_PER_CLAIM} photos. &quot;{tooMany.folder ?? "Loose photos"}&quot; has {tooMany.files.length}.</div>}

          {showLinks ? (
            <label className="intake-links">
              <span>
                Photo links <span className="hint">(one per line; each link is one claim)</span>
              </span>
              <textarea className="text-input" rows={2} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://example.com/damaged-car.jpg" autoFocus />
            </label>
          ) : (
            <button className="linkish" style={{ alignSelf: "flex-start" }} onClick={() => setShowLinks(true)}>
              Have a link instead? Paste it
            </button>
          )}
          {err && <div className="err">{err}</div>}
        </div>
        <div className="modal-foot">
          <span className="hint" style={{ marginRight: "auto" }} title="Links are fetched by the server, which blocks internal addresses and anything that isn't a JPEG, PNG or WebP under 10 MB.">
            No claim form needed. JPEG, PNG or WebP; never stored.
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || claimCount === 0 || !!tooMany} onClick={() => void submit()}>
            {busy ? "Preparing..." : claimCount ? `Add ${claimCount} claim${claimCount === 1 ? "" : "s"}` : "Add photos"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import type { ClaimContext, ImpactArea } from "@/lib/claims/types.ts";
import type { CaseItem } from "@/lib/client/cases.ts";
import { PHOTO_QUALITY_THRESHOLDS, usd, type Settings } from "@/lib/policy/protocol.ts";

export function Viewer(props: {
  item: CaseItem | null;
  settings: Settings;
  onUpdateClaim: (id: string, claim: ClaimContext) => void;
  onReassess: (id: string) => void;
}) {
  const { item, settings } = props;
  const [idx, setIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setIdx(0);
    setEditing(false);
  }, [item?.id]);

  if (!item) {
    return (
      <section className="col viewer">
        <div className="viewer-empty">
          <div>
            <h2>No claim selected</h2>
            <p>Add claims or load the demo queue to start. Each claim is assessed as soon as it arrives.</p>
          </div>
        </div>
      </section>
    );
  }

  const c = item.claim;
  const pv = c.policyVehicle;
  const photo = item.photos[Math.min(idx, item.photos.length - 1)];
  const metrics = item.assessment?.photos?.[Math.min(idx, item.photos.length - 1)];
  const t = PHOTO_QUALITY_THRESHOLDS[settings.photoQuality];
  const tags: { text: string; tone: "warn" | "bad" | "info" }[] = [];
  if (item.assessment?.ok) {
    const v = item.assessment.extraction.evidence.view_type;
    if (v === "close_up" || v === "detail") tags.push({ text: "Close-up", tone: "warn" });
    if (item.assessment.extraction.evidence.damage_extends_beyond_frame) tags.push({ text: "Damage runs out of frame", tone: "warn" });
    if (item.assessment.extraction.evidence.photo_issues.includes("glare_over_damage")) tags.push({ text: "Glare over damage", tone: "warn" });
    if (item.assessment.extraction.evidence.photo_issues.includes("blur")) tags.push({ text: "Blurry", tone: "warn" });
  }
  if (metrics) {
    if (metrics.brightness < t.minBrightness) tags.push({ text: "Too dark", tone: "warn" });
    if (metrics.sharpness < t.minSharpness) tags.push({ text: "Very soft", tone: "warn" });
    if (Math.min(metrics.width, metrics.height) < t.minShortEdgePx) tags.push({ text: "Low resolution", tone: "warn" });
    if (metrics.greyscale) tags.push({ text: "Black and white", tone: "info" });
    if (metrics.nearDuplicateOf) tags.push({ text: `Matches past claim ${metrics.nearDuplicateOf}`, tone: "bad" });
  }

  return (
    <section className="col viewer">
      <div className="claim-head">
        <div className="claim-head-top">
          <h1>{c.claimId}</h1>
          <span className="chip">{c.policyholder}</span>
          {c.injuryReported && <span className="chip chip-bad">Injury reported</span>}
          {c.vehicleDrivable === false && <span className="chip chip-bad">Not drivable</span>}
          {c.priorEvidenceRequests > 0 && (
            <span className="chip chip-warn">
              Asked for photos {c.priorEvidenceRequests} time{c.priorEvidenceRequests === 1 ? "" : "s"}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing((e) => !e)}>
            {editing ? "Close" : "Edit claim details"}
          </button>
        </div>
        <dl className="claim-meta">
          <div>
            <dt>Policy vehicle</dt>
            <dd>{[pv.year, pv.colour, pv.make, pv.model].filter(Boolean).join(" ") || "Not on file"}</dd>
          </div>
          <div>
            <dt>Vehicle value (mock)</dt>
            <dd>{c.vehicleValueUsd ? usd(c.vehicleValueUsd) : "Not on file"}</dd>
          </div>
          <div>
            <dt>Loss date</dt>
            <dd>{c.lossDate}</dd>
          </div>
          <div>
            <dt>Reported impact</dt>
            <dd style={{ textTransform: "capitalize" }}>{c.reportedImpactArea === "unknown" ? "Not given" : c.reportedImpactArea}</dd>
          </div>
        </dl>
        <div className="loss">
          <b>Customer&apos;s description:</b> {c.lossDescription}
        </div>
        {editing && (
          <ClaimEditor
            claim={c}
            onSave={(claim) => {
              props.onUpdateClaim(item.id, claim);
              setEditing(false);
            }}
          />
        )}
      </div>

      <div className="stage">
        <div className="photo-main">
          {photo?.dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.dataUrl} alt={`Claim photo ${photo.name}`} />
          ) : photo?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.url} alt={`Claim photo from ${photo.url}`} referrerPolicy="no-referrer" />
          ) : null}
          <div className="photo-tags">
            {tags.map((tag) => (
              <span key={tag.text} className={`chip ${tag.tone === "bad" ? "chip-bad" : tag.tone === "warn" ? "chip-warn" : "chip-info"}`}>
                {tag.text}
              </span>
            ))}
          </div>
          {photo && (
            <span className="photo-name">
              Photo {Math.min(idx, item.photos.length - 1) + 1} of {item.photos.length} · {photo.name}
            </span>
          )}
        </div>
        {item.photos.length > 1 && (
          <div className="thumbs">
            {item.photos.map((p, i) => (
              <button key={i} className={`thumb ${i === idx ? "active" : ""}`} onClick={() => setIdx(i)} title={p.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.dataUrl || p.url} alt={p.name} />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ClaimEditor({ claim, onSave }: { claim: ClaimContext; onSave: (c: ClaimContext) => void }) {
  const [c, setC] = useState(claim);
  const pv = c.policyVehicle;
  const setPv = (patch: Partial<ClaimContext["policyVehicle"]>) => setC({ ...c, policyVehicle: { ...pv, ...patch } });
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <div className="inline-form" style={{ marginTop: 10 }}>
      <div className="hint">Changing claim details re-runs the rules instantly. The AI isn&apos;t called again.</div>
      <div className="row">
        <label>
          Policyholder
          <input value={c.policyholder} onChange={(e) => setC({ ...c, policyholder: e.target.value })} />
        </label>
        <label>
          Vehicle value (USD)
          <input type="number" value={c.vehicleValueUsd ?? ""} onChange={(e) => setC({ ...c, vehicleValueUsd: num(e.target.value) })} />
        </label>
      </div>
      <div className="row">
        <label>
          Year
          <input type="number" value={pv.year ?? ""} onChange={(e) => setPv({ year: num(e.target.value) })} />
        </label>
        <label>
          Make
          <input value={pv.make ?? ""} onChange={(e) => setPv({ make: e.target.value || null })} />
        </label>
        <label>
          Model
          <input value={pv.model ?? ""} onChange={(e) => setPv({ model: e.target.value || null })} />
        </label>
        <label>
          Colour
          <input value={pv.colour ?? ""} onChange={(e) => setPv({ colour: e.target.value || null })} />
        </label>
      </div>
      <div className="row">
        <label>
          Powertrain
          <select value={pv.powertrain} onChange={(e) => setPv({ powertrain: e.target.value as ClaimContext["policyVehicle"]["powertrain"] })}>
            <option value="unknown">Unknown</option>
            <option value="combustion">Petrol or diesel</option>
            <option value="hybrid">Hybrid</option>
            <option value="electric">Electric</option>
          </select>
        </label>
        <label>
          Reported impact
          <select value={c.reportedImpactArea} onChange={(e) => setC({ ...c, reportedImpactArea: e.target.value as ImpactArea })}>
            {["unknown", "front", "rear", "left", "right"].map((a) => (
              <option key={a} value={a}>
                {a === "unknown" ? "Not given" : a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Injury reported
          <select value={String(c.injuryReported)} onChange={(e) => setC({ ...c, injuryReported: e.target.value === "true" })}>
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
        <label>
          Drivable
          <select
            value={c.vehicleDrivable === null ? "unknown" : String(c.vehicleDrivable)}
            onChange={(e) => setC({ ...c, vehicleDrivable: e.target.value === "unknown" ? null : e.target.value === "true" })}
          >
            <option value="unknown">Not said</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
      </div>
      <label>
        Customer&apos;s description
        <textarea rows={2} value={c.lossDescription} onChange={(e) => setC({ ...c, lossDescription: e.target.value })} />
      </label>
      <div className="composer-row">
        <button className="btn btn-primary btn-sm" onClick={() => onSave(c)}>
          Save and re-run rules
        </button>
      </div>
    </div>
  );
}

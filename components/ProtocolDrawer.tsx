"use client";

import { useMemo, useState } from "react";

import results from "@/eval/results/latest.json";
import { currentDecision, type CaseItem } from "@/lib/client/cases.ts";
import { scoreCase, summarise, type EvalRun } from "@/lib/eval/metrics.ts";
import {
  clampSettings,
  DEFAULT_SETTINGS,
  PROTOCOL_VERSION,
  ROUTE_LABELS,
  RULES,
  SETTING_DEFS,
  usd,
  type Route,
  type RuleGroup,
  type Settings,
} from "@/lib/policy/protocol.ts";

import type { Role } from "./Workspace.tsx";

const GROUPS: { id: RuleGroup; title: string; blurb: string }[] = [
  { id: "safety", title: "Safety", blurb: "Always a person. Locked." },
  { id: "scope", title: "Scope", blurb: "Vehicles the photo path doesn't cover. Locked." },
  { id: "integrity", title: "Photo integrity", blurb: "Possible reuse or tampering. Locked, and referred to SIU." },
  { id: "evidence", title: "Evidence", blurb: "Ask the customer for better photos. We don't guess." },
  { id: "cost", title: "Cost", blurb: "Where the estimate range sits against the limits." },
  { id: "review", title: "Review flags", blurb: "The claim keeps its route, but a person checks." },
];

const RUNS = (results as { runs: EvalRun[] }).runs;

export function ProtocolDrawer(props: {
  settings: Settings;
  onChange: (s: Settings) => void;
  role: Role;
  selected: CaseItem | null;
  onClose: () => void;
}) {
  const { settings, role, selected } = props;
  const [test, setTest] = useState(false);
  const canEdit = role === "owner";
  const changes = SETTING_DEFS.filter((d) => settings[d.key] !== DEFAULT_SETTINGS[d.key]);
  const decision = selected ? currentDecision(selected, settings) : null;
  const fired = new Map(decision?.ruleResults.filter((r) => r.fired).map((r) => [r.id, r]) ?? []);

  const set = (key: keyof Settings, value: unknown) => props.onChange(clampSettings({ ...settings, [key]: value }));

  const comparison = useMemo((): Comparison => {
    if (!test || RUNS.length === 0) return null;
    const run = RUNS[0];
    const before = run.cases.map((c) => scoreCase(c, DEFAULT_SETTINGS));
    const after = run.cases.map((c) => scoreCase(c, settings));
    return {
      run,
      before: summarise(before),
      after: summarise(after),
      moved: after
        .map((a, i) => ({ id: a.result.caseId, from: before[i].route, to: a.route, expected: a.result.labels.expectedRoute, acceptable: a.acceptable }))
        .filter((m) => m.from !== m.to),
    };
  }, [test, settings]);

  const fmt = (key: keyof Settings, v: unknown) => {
    const def = SETTING_DEFS.find((d) => d.key === key)!;
    if (def.kind === "choice") return def.options.find((o) => o.value === v)?.label ?? String(v);
    if (def.unit === "usd") return usd(v as number);
    if (def.unit === "pct") return `${v}%`;
    if (def.unit === "ratio") return `${Math.round((v as number) * 100)}%`;
    return String(v);
  };

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>Routing protocol v{PROTOCOL_VERSION}</h2>
            <div className="sub">Illustrative, draft for historical validation. The app and this document are generated from the same file, so they can&apos;t drift apart.</div>
          </div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="drawer-body">
          <div className="card">
            <div className="card-body">
              <b>How the route is chosen.</b> The AI only describes the photos. These rules decide. When more than one rule applies, the most cautious route wins:{" "}
              <span className="route-adjuster route-pill">{ROUTE_LABELS.adjuster}</span>, then <span className="route-more_evidence route-pill">{ROUTE_LABELS.more_evidence}</span>, then{" "}
              <span className="route-photo_estimate route-pill">{ROUTE_LABELS.photo_estimate}</span>. If the AI fails, the claim goes to manual triage.
              {selected && <div className="note">Rules that fired for {selected.claim.claimId} are highlighted.</div>}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Configurable settings</h3>
              <span className="sub">{changes.length ? <span className="changed">Draft: {changes.length} change{changes.length === 1 ? "" : "s"}, not published</span> : "Published values"}</span>
            </div>
            <div className="card-body">
              {!canEdit && <div className="hint" style={{ marginBottom: 8 }}>Read only. Switch the role to Protocol owner to edit (mock role, no real login).</div>}
              {SETTING_DEFS.map((def) => (
                <div className="setting" key={def.key}>
                  <div>
                    <div className={settings[def.key] !== DEFAULT_SETTINGS[def.key] ? "changed" : ""}>{def.label}</div>
                    <div className="help">
                      {def.help} Published: {fmt(def.key, DEFAULT_SETTINGS[def.key])}.
                    </div>
                  </div>
                  {def.kind === "choice" ? (
                    <select disabled={!canEdit} value={String(settings[def.key])} onChange={(e) => set(def.key, e.target.value)}>
                      {def.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="number"
                      disabled={!canEdit}
                      min={def.unit === "ratio" ? def.min * 100 : def.min}
                      max={def.unit === "ratio" ? def.max * 100 : def.max}
                      step={def.unit === "ratio" ? def.step * 100 : def.step}
                      value={def.unit === "ratio" ? Math.round((settings[def.key] as number) * 100) : (settings[def.key] as number)}
                      onChange={(e) => set(def.key, def.unit === "ratio" ? Number(e.target.value) / 100 : Number(e.target.value))}
                    />
                  )}
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button className="btn btn-sm" disabled={!canEdit || changes.length === 0} onClick={() => props.onChange(DEFAULT_SETTINGS)}>
                  Reset to published
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => setTest((t) => !t)}>
                  {test ? "Hide test" : "Test against labelled cases"}
                </button>
              </div>
              <div className="note">
                Changes apply to your worklist straight away, as a draft. In production a change would need a second person&apos;s approval, a test run against the labelled cases, and an audit log entry before going live.
              </div>
              {test && <ProtocolTest comparison={comparison} />}
            </div>
          </div>

          {GROUPS.map((g) => (
            <div className="rules-group" key={g.id}>
              <h4>
                {g.title} <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· {g.blurb}</span>
              </h4>
              <div className="rules-list">
                {RULES.filter((r) => r.group === g.id).map((r) => {
                  const hit = fired.get(r.id);
                  const effect = hit?.effect ?? r.effect;
                  return (
                    <div key={r.id} className={`rule ${hit ? "fired" : ""}`}>
                      <div className="rule-top">
                        <span className="mono">{r.id}</span>
                        <b>{r.title}</b>
                        <span style={{ flex: 1 }} />
                        <span className={`chip ${r.tier === "locked" ? "" : "chip-info"}`}>{r.tier === "locked" ? "Locked" : "Configurable"}</span>
                        <span className={`chip ${effect === "adjuster" ? "chip-bad" : effect === "more_evidence" ? "chip-warn" : ""}`}>
                          {effect === "adjuster" ? "Adjuster" : effect === "more_evidence" ? "More evidence" : "Review flag"}
                        </span>
                      </div>
                      <div className="rule-when">{r.when}</div>
                      {r.settings && <div className="hint">Uses: {r.settings.map((k) => SETTING_DEFS.find((d) => d.key === k)?.label).join(", ")}</div>}
                      {hit && <div className="reason-text" style={{ marginTop: 4 }}>Fired: {hit.reason}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type Comparison = null | {
  run: EvalRun;
  before: ReturnType<typeof summarise>;
  after: ReturnType<typeof summarise>;
  moved: { id: string; from: Route; to: Route; expected: Route; acceptable: boolean }[];
};

function ProtocolTest({ comparison }: { comparison: Comparison }) {
  if (!comparison) {
    return <div className="note-strong">No evaluation run is saved yet. Run the evaluation first (see the Evaluation page), then test changes here.</div>;
  }
  const { before, after, moved, run } = comparison;
  const row = (label: string, b: string, a: string) => (
    <tr>
      <td>{label}</td>
      <td>{b}</td>
      <td className={a !== b ? "changed" : ""}>{a}</td>
    </tr>
  );
  return (
    <div style={{ marginTop: 12 }}>
      <div className="hint" style={{ marginBottom: 6 }}>
        Re-runs the rules over the saved AI extractions from the last evaluation ({run.cases.length} labelled cases, {run.model}). No AI calls, so it&apos;s instant and free.
      </div>
      <table className="t">
        <thead>
          <tr>
            <th>Measure</th>
            <th>Published</th>
            <th>Draft</th>
          </tr>
        </thead>
        <tbody>
          {row("Complex-case escalation recall", `${before.escalation.caught} of ${before.escalation.of}`, `${after.escalation.caught} of ${after.escalation.of}`)}
          {row("Routing agreement (exact)", `${before.agreement.exact} of ${before.agreement.of}`, `${after.agreement.exact} of ${after.agreement.of}`)}
          {row("Routing agreement (acceptable)", `${before.agreement.acceptable} of ${before.agreement.of}`, `${after.agreement.acceptable} of ${after.agreement.of}`)}
          {row("Escalated when not needed", `${before.overEscalated.count} of ${before.overEscalated.of}`, `${after.overEscalated.count} of ${after.overEscalated.of}`)}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        {moved.length === 0 ? (
          <div className="hint">No labelled case changes route under the draft.</div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Case</th>
                <th>Route before</th>
                <th>Route after</th>
                <th>Expert label</th>
              </tr>
            </thead>
            <tbody>
              {moved.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.id}</td>
                  <td>{ROUTE_LABELS[m.from]}</td>
                  <td className={m.acceptable ? "" : "changed"}>{ROUTE_LABELS[m.to]}</td>
                  <td>{ROUTE_LABELS[m.expected]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

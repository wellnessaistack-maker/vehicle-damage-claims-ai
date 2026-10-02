"use client";

import { useMemo, useState } from "react";

import results from "@/eval/results/latest.json";
import { DEFAULT_MODEL } from "@/lib/extraction/models.ts";
import { PROMPT_VERSION } from "@/lib/extraction/prompt.ts";
import { currentDecision, type CaseItem } from "@/lib/client/cases.ts";
import { scoreCase, summarise, type EvalRun } from "@/lib/eval/metrics.ts";
import { HIGH_VOLTAGE_HOURS, MARKETS, RATE_CARD } from "@/lib/policy/ratecard.ts";
import { SALVAGE_SHARE, STATE_TOTAL_LOSS, TOTAL_LOSS_SOURCE } from "@/lib/policy/states.ts";
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
  type SourceKey,
} from "@/lib/policy/protocol.ts";

import type { Role } from "./Workspace.tsx";

/** The rule groups in plain words: what each catches and where it sends the claim. */
const GROUPS: { id: RuleGroup; title: string; catches: string; sendsTo: string }[] = [
  { id: "safety", title: "Safety", catches: "Injury, can't be driven, airbags, structural damage, fire or flood, EV battery", sendsTo: "Adjuster" },
  { id: "scope", title: "Scope", catches: "Race cars, motorcycles, commercial vehicles", sendsTo: "Adjuster" },
  { id: "integrity", title: "Photo integrity", catches: "A photo from a past claim, different cars, a photo of a screen", sendsTo: "Adjuster and SIU" },
  { id: "evidence", title: "Evidence", catches: "Can't see the car or the whole damage, poor photos", sendsTo: "Ask for photos" },
  { id: "cost", title: "Cost", catches: "Over the approval limit, past the total-loss line", sendsTo: "Adjuster" },
  { id: "review", title: "Review flags", catches: "Sensor area, car or damage doesn't match the claim", sendsTo: "Same route, flagged" },
];

/** Which rule groups lead to each route, most cautious first. */
const ROUTE_FLOW: { route: Route; groups: RuleGroup[] }[] = [
  { route: "adjuster", groups: ["safety", "scope", "integrity", "cost"] },
  { route: "more_evidence", groups: ["evidence"] },
  { route: "photo_estimate", groups: [] },
];

/** The settings worth showing first; the rest sit under "More settings". */
const KEY_SETTINGS: (keyof Settings)[] = ["fastPathLimitUsd", "totalLossRatio", "maxEvidenceRequests"];

/** Locked, carrier settings, or a mix, from the rules themselves. */
function changeable(group: RuleGroup) {
  const tiers = new Set(RULES.filter((r) => r.group === group).map((r) => r.tier));
  return tiers.size > 1 ? "Mostly locked" : tiers.has("locked") ? "Locked" : "Carrier settings";
}

const SOURCE_LABELS: Record<SourceKey, string> = {
  "policy.vehicle": "policy record (insured vehicle)",
  "policy.value": "policy record (vehicle value)",
  "policy.powertrain": "policy record (powertrain)",
  "claim.injury": "claim form (injury)",
  "claim.drivable": "claim form (drivable)",
  "claim.impact": "claim form (point of impact)",
  "claim.requests": "claim record (photo requests sent)",
  "ai.vehicle": "photo, AI (vehicle)",
  "ai.damage": "photo, AI (damage)",
  "ai.evidence": "photo, AI (what's in frame)",
  "ai.risk": "photo, AI (risk signs)",
  "photo.checks": "photo checks (code)",
  "photo.pastClaims": "past-claim photos",
  estimate: "estimate range",
};

const RUNS = (results as { runs: EvalRun[] }).runs;
// The protocol test replays the default model's run on the current prompt.
const BASE_RUN = RUNS.find((r) => r.model === DEFAULT_MODEL && r.promptVersion === PROMPT_VERSION) ?? RUNS[0];

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
    if (!test || !BASE_RUN) return null;
    const run = BASE_RUN;
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

  const settingRow = (def: (typeof SETTING_DEFS)[number]) => (
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
  );

  return (
    <div className="overlay" onClick={props.onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>Routing protocol v{PROTOCOL_VERSION}</h2>
            <div className="sub">The rules that pick each claim&apos;s route. The app runs this exact file, so what you read here is what it does.</div>
          </div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="drawer-body">
          <div className="card">
            <div className="card-body proto-how">
              <div className="proto-flow" aria-label="How a claim is routed">
                <span className="proto-node">Claim and photos</span>
                <span className="arrow">→</span>
                <span className="proto-node">AI describes them</span>
                <span className="arrow">→</span>
                <span className="proto-node proto-node-rules">Rules pick a route</span>
                <span className="arrow">→</span>
                <span className="proto-node">Reviewer decides</span>
              </div>
              <div className="proto-routes">
                {ROUTE_FLOW.map((r) => {
                  const here = decision?.route === r.route;
                  return (
                    <div key={r.route} className={`proto-route route-${r.route} ${here ? "here" : ""}`}>
                      <div className="proto-route-head">
                        <span className="dot" /> {ROUTE_LABELS[r.route]}
                        {here && selected && <span className="proto-here">This claim</span>}
                      </div>
                      <div className="proto-route-groups">
                        {r.groups.length === 0 ? (
                          <span className={here ? "hit" : ""}>No rules fired</span>
                        ) : (
                          r.groups.map((gid) => {
                            const g = GROUPS.find((x) => x.id === gid)!;
                            const hit = RULES.some((rule) => rule.group === gid && fired.has(rule.id));
                            return (
                              <span key={gid} className={hit ? "hit" : ""}>
                                {g.title}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hint">
                If rules point to different routes, the most cautious wins, left to right. Review flags keep the route but ask a person to check. If the AI fails, the claim goes to manual triage.
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>The rules</h3>
              <span className="sub">
                {RULES.length} rules in {GROUPS.length} groups{selected ? `. Groups that fired for ${selected.claim.claimId} are highlighted.` : ""}
              </span>
            </div>
            <div className="card-body proto-groups">
              <div className="proto-group-row proto-group-headrow">
                <span>Group</span>
                <span>Sends it to</span>
                <span>Can the carrier change it?</span>
              </div>
              {GROUPS.map((g) => {
                const rules = RULES.filter((r) => r.group === g.id);
                const firedHere = rules.filter((r) => fired.has(r.id)).map((r) => r.id);
                return (
                  <details key={g.id} className={`proto-group ${firedHere.length ? "fired" : ""}`}>
                    <summary className="proto-group-row">
                      <span>
                        <b>{g.title}</b>
                        <span className="proto-catches">{g.catches}</span>
                        {firedHere.length > 0 && <span className="chip chip-warn proto-fired">Fired here: {firedHere.join(", ")}</span>}
                      </span>
                      <span>{g.sendsTo}</span>
                      <span>{changeable(g.id)}</span>
                    </summary>
                    <div className="rules-list">
                      {rules.map((r) => {
                        const hit = fired.get(r.id);
                        return (
                          <div key={r.id} className={`rule ${hit ? "fired" : ""}`}>
                            <div className="rule-top">
                              <span className="mono">{r.id}</span>
                              <b>{r.title}</b>
                              <span style={{ flex: 1 }} />
                              {r.tier !== "locked" && <span className="chip chip-info">Setting</span>}
                            </div>
                            <div className="rule-when">{r.when}</div>
                            <div className="hint">
                              Checks: {r.uses.map((u) => SOURCE_LABELS[u]).join(", ")}
                              {r.settings && <> · Settings: {r.settings.map((k) => SETTING_DEFS.find((d) => d.key === k)?.label).join(", ")}</>}
                            </div>
                            {hit && <div className="reason-text" style={{ marginTop: 4 }}>Fired: {hit.reason}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Settings</h3>
              <span className="sub">{changes.length ? <span className="changed">Draft: {changes.length} change{changes.length === 1 ? "" : "s"}, not published</span> : "Published values"}</span>
            </div>
            <div className="card-body">
              {!canEdit && <div className="hint" style={{ marginBottom: 8 }}>Read only. Switch the role to Protocol owner to edit (mock role, no real login).</div>}
              {SETTING_DEFS.filter((def) => KEY_SETTINGS.includes(def.key)).map(settingRow)}
              <details className="fold">
                <summary>More settings ({SETTING_DEFS.length - KEY_SETTINGS.length}): pricing, photo checks, cost allowances</summary>
                {SETTING_DEFS.filter((def) => !KEY_SETTINGS.includes(def.key)).map(settingRow)}
              </details>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button className="btn btn-sm btn-primary" onClick={() => setTest((t) => !t)}>
                  {test ? "Hide test" : "Test against labelled cases"}
                </button>
                <button className="btn btn-sm" disabled={!canEdit || changes.length === 0} onClick={() => props.onChange(DEFAULT_SETTINGS)}>
                  Reset to published
                </button>
              </div>
              <div className="note">Changes re-route your worklist straight away, as a draft. In production a change would need a second person&apos;s approval, a test against the labelled cases, and an audit log entry.</div>
              {test && <ProtocolTest comparison={comparison} />}
            </div>
          </div>

          <RateCard baseRate={settings.labourRateUsd} />
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

/** The carrier's rate card, read only. In production it comes from an estimating platform and the carrier's own rates. */
function RateCard({ baseRate }: { baseRate: number }) {
  const h = (n?: number) => (n === undefined ? "" : String(n));
  const d = (n?: number) => (n === undefined ? "" : usd(n));
  return (
    <div className="card">
      <div className="card-head">
        <h3>How prices are set</h3>
        <span className="sub">Rate card, labour markets, state total-loss rules</span>
      </div>
      <div className="card-body">
        <div>
          The AI says which part is damaged and how badly. The rate card turns that into hours at the local labour rate, plus paint and parts. Every figure is a placeholder for the carrier&apos;s own.
        </div>
        <details className="fold">
          <summary>How it&apos;s worked out</summary>
          <div className="help" style={{ marginBottom: 6 }}>
          The AI says which part is damaged, how badly, and whether it would be repaired, replaced or refinished. This card turns that into hours and parts, priced at the labour and paint rates in the settings. Repair hours are for moderate damage (half for minor, 1.6x for severe), and each painted panel adds 1 h to remove trim and mask.
          Parts cost 0.8x on cars worth under $10,000, and 1.5x on cars worth over $40,000 or a luxury make. Electric and hybrid cars add {HIGH_VOLTAGE_HOURS} h to make the high-voltage system safe. The base labour rate is scaled by the market the claim&apos;s ZIP code falls in. Every figure is an illustrative placeholder: in production the hours come from an
          estimating platform&apos;s labour times and the rates and parts pricing from the carrier, checked against their paid claims.
        </div>
        </details>
        <details className="fold">
          <summary>Hours and parts by panel ({Object.keys(RATE_CARD).length})</summary>
          <table className="ratecard-table">
            <thead>
              <tr>
                <th>Part</th>
                <th>Repair (h)</th>
                <th>Replace (h)</th>
                <th>Paint (h)</th>
                <th>Part, mid-range car</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(RATE_CARD).map(([area, c]) => (
                <tr key={area}>
                  <td>{area.replace(/_/g, " ")}</td>
                  <td>{h(c?.repairHours)}</td>
                  <td>{h(c?.replaceHours)}</td>
                  <td>{h(c?.paintHours)}</td>
                  <td>{d(c?.partUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <details className="fold">
          <summary>Total-loss rules by state ({Object.keys(STATE_TOTAL_LOSS).length})</summary>
          <div className="hint" style={{ margin: "6px 0" }}>
            Found from the claim&apos;s ZIP code. <b>Unverified:</b> taken from a secondary source (
            <a href={TOTAL_LOSS_SOURCE} target="_blank" rel="noreferrer">
              carinsurance.com
            </a>
            ), to be checked against each state&apos;s law. States not listed use the carrier&apos;s total-loss setting. The formula uses a placeholder salvage value of{" "}
            {Math.round(SALVAGE_SHARE * 100)}% of the car&apos;s value; in production it comes from salvage auction data.
          </div>
          <table className="ratecard-table">
            <thead>
              <tr>
                <th>State</th>
                <th>Rule</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(STATE_TOTAL_LOSS).map(([st, r]) => (
                <tr key={st}>
                  <td>{st}</td>
                  <td>{r.kind === "percent" ? `Total loss at ${r.percent}% of the car's value` : "Total loss formula: repair + salvage reaches the car's value"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <details className="fold">
          <summary>Labour markets by ZIP code ({MARKETS.length})</summary>
          <table className="ratecard-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>ZIP codes starting</th>
                <th>Multiplier</th>
                <th>Labour rate</th>
              </tr>
            </thead>
            <tbody>
              {MARKETS.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td>{m.zip3.map(([lo, hi]) => `${String(lo).padStart(3, "0")} to ${String(hi).padStart(3, "0")}`).join(", ")}</td>
                  <td>x{m.factor}</td>
                  <td>{usd(Math.round(baseRate * m.factor))}/h</td>
                </tr>
              ))}
              <tr>
                <td>Anywhere else</td>
                <td></td>
                <td>x1</td>
                <td>{usd(baseRate)}/h</td>
              </tr>
            </tbody>
          </table>
        </details>
      </div>
    </div>
  );
}

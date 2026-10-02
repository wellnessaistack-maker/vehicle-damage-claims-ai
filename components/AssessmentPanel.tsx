"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { currentDecision, DIRECTORY, holderLine, recipient, REVIEWER, ROUTE_OWNER, type CaseItem, type CaseOutcome, type ThreadEntry } from "@/lib/client/cases.ts";
import { CALL_OUTCOMES, channels, customerUpdate, defaultChannel, firstName, followUpDate, preview as messagePreview, reminder, sentVia, shortDate, type Channel } from "@/lib/client/customer.ts";
import { loadDemoPhoto, shrink, kindOf, type CasePhoto } from "@/lib/client/intake.ts";
import { decide, type Decision, type EstimateOutput } from "@/lib/policy/engine.ts";
import { ROUTE_LABELS, usd, type Route, type Settings } from "@/lib/policy/protocol.ts";

type Mode = null | "change" | "adjust" | "send" | "comment" | "ask" | "contact" | "update";

export function AssessmentPanel(props: {
  item: CaseItem | null;
  settings: Settings;
  routeOverride: Route | null;
  onComplete: (id: string, outcome: Omit<CaseOutcome, "at">) => void;
  onThread: (id: string, entry: Omit<ThreadEntry, "id" | "at">) => void;
  onReassess: (id: string) => void;
  onCustomerPhotos: (id: string, photos: CasePhoto[]) => void;
  onOpenRecord: () => void;
  onOpenProtocol: () => void;
}) {
  const { item, settings } = props;
  const [mode, setMode] = useState<Mode>(null);
  const d = item ? currentDecision(item, settings) : null;
  const draftFor = (dec: Decision | null) => (dec && item ? (dec.customerMessage ?? customerUpdate(dec, item.claim) ?? "") : "");
  const [message, setMessage] = useState<string>(draftFor(d));
  useEffect(() => {
    setMessage(draftFor(d));
    // Redraft only when the route or the photo request changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.customerMessage, d?.route]);
  // Null until the reviewer picks one; until then the default depends on what the message is for.
  const [chosenChannel, setChannel] = useState<Channel | null>(null);
  const purpose = d?.route === "more_evidence" || item?.outcome?.action === "message_sent" ? "photos" : "update";
  // Follow the claim's current contact details, e.g. a phone number added after the claim arrived.
  const channel = item && chosenChannel && channels(item.claim).includes(chosenChannel) ? chosenChannel : item ? defaultChannel(item.claim, purpose) : null;
  const [sendUpdate, setSendUpdate] = useState(true);

  if (!item) {
    return (
      <aside className="col assess">
        <div className="viewer-empty">
          <div>
            <h2>Assessment</h2>
            <p>The vehicle, damage summary, repair estimate and recommended route appear here.</p>
          </div>
        </div>
      </aside>
    );
  }

  if (item.status === "queued" || item.status === "processing") {
    return (
      <aside className="col assess">
        <div className="assess-scroll">
          <Assessing started={item.addedAt} />
        </div>
      </aside>
    );
  }

  const a = item.assessment!;
  const route: Route = a.ok ? d!.route : "manual_triage";
  const reDecided = a.ok && JSON.stringify(a.decision.settings) !== JSON.stringify(settings);

  return (
    <aside className="col assess">
      <div className="assess-scroll">
        <div className={`banner route-${route}`}>
          <div className="banner-top">
            <span className="banner-label">Recommended route</span>
            <div className="banner-links">
              {a.ok && (
                <button className="btn btn-sm btn-ghost" onClick={props.onOpenProtocol}>
                  Routing protocol v{d!.protocolVersion}
                </button>
              )}
              <button className="btn btn-sm btn-ghost" onClick={props.onOpenRecord}>
                Decision record
              </button>
            </div>
          </div>
          <h2>{ROUTE_LABELS[route]}</h2>
          {a.ok && <div className="banner-why">{whyLine(d!)}</div>}
          <div className="banner-flags">
            {a.ok && d!.humanReview.required && route !== "adjuster" && <span className="chip" style={{ borderColor: "#c4b5fd", color: "#6d28d9", background: "#f5f3ff" }}>Human review flagged</span>}
            {a.ok && !d!.humanReview.required && route === "photo_estimate" && <span className="chip chip-ok">No review flags</span>}
            {a.ok && d!.siuReferral && <span className="chip chip-bad">Refer to SIU</span>}
            {reDecided && <span className="chip chip-warn">Re-run with protocol draft</span>}
            {a.ok ? (
              <span className="chip">
                {(a.timings.totalMs / 1000).toFixed(1)} s · ~${a.meta.costUsd.toFixed(3)} est. · {a.meta.modelServed}
              </span>
            ) : (
              <span className="chip">{a.failure.simulated ? "Simulated failure" : "AI assessment failed"}</span>
            )}
          </div>
        </div>

        {!a.ok ? (
          <div className="failure">
            <b>Not assessed.</b> {a.failure.message}
            <div style={{ marginTop: 6 }}>
              This claim goes to manual triage, which is today&apos;s normal process. Nothing was guessed and no route was invented. The photo checks still ran; see the decision record.
            </div>
          </div>
        ) : (
          <>
            <RequiredOutputs d={d!} />
            <Reasons d={d!} onOpenProtocol={props.onOpenProtocol} />
          </>
        )}

        <Thread item={item} decision={d} onThread={props.onThread} mode={mode} setMode={setMode} />
      </div>

      <ActionBar
        item={item}
        route={route}
        d={d}
        settings={settings}
        mode={mode}
        setMode={setMode}
        message={message}
        channel={channel}
        setChannel={setChannel}
        sendUpdate={sendUpdate}
        setSendUpdate={setSendUpdate}
        setMessage={setMessage}
        onComplete={props.onComplete}
        onThread={props.onThread}
        onReassess={props.onReassess}
        onCustomerPhotos={props.onCustomerPhotos}
      />
    </aside>
  );
}

/** Hover text for the approval limit mark on the estimate bar. */
function approvalLimitTip(limitUsd: number) {
  return `The most the reviewer can approve without an adjuster. ${usd(limitUsd)} is a placeholder; carriers set their own by role.`;
}

function Assessing({ started }: { started: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, (Date.now() - new Date(started).getTime()) / 1000);
  const steps = ["Checking photo quality and past claims", "Reading the photos (AI)", "Applying the routing protocol"];
  const active = s < 1.5 ? 0 : 1;
  return (
    <div className="card">
      <div className="card-head">
        <h3>
          <span className="spinner" style={{ marginRight: 8, verticalAlign: -2 }} />
          Assessing
        </h3>
        <span className="sub">{s.toFixed(0)} s</span>
      </div>
      <div className="card-body">
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          {steps.map((st, i) => (
            <li key={st} style={{ color: i === active ? "var(--text)" : "var(--text-3)", fontWeight: i === active ? 600 : 400 }}>
              {st}
            </li>
          ))}
        </ol>
        <div className="note">Usually 10 to 30 seconds. Photos are not stored.</div>
      </div>
    </div>
  );
}

/** One sentence for the banner: the main reasons, most serious first. */
function whyLine(d: Decision): string {
  const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  const routing = d.reasons.filter((r) => r.effect !== "review");
  const flags = d.reasons.filter((r) => r.effect === "review");
  if (routing.length === 0) {
    return flags.length
      ? `No concerns that stop it, but a person should check: ${flags.map((r) => lower(r.title)).join("; ")}.`
      : "No concerns found: the whole car and damage are visible, nothing looks serious, and the estimate is under the limit.";
  }
  const shown = routing.slice(0, 2).map((r) => lower(r.title));
  const more = routing.length - shown.length;
  return `Because: ${shown.join("; ")}${more > 0 ? `; and ${more} more below` : ""}.`;
}

function RequiredOutputs({ d }: { d: Decision }) {
  const v = d.requiredOutputs.vehicle;
  const identified = !!(v.make.value || v.model.value);
  const basis = [v.make.value ? v.make.note : null, v.yearRange ? `likely ${v.yearRange}` : null, v.vehicleClass !== "passenger_car" && v.vehicleClass !== "none" ? v.vehicleClass.replace(/_/g, " ") : null]
    .filter(Boolean)
    .join(" · ");
  const cell = (label: string, f: { value: string | null }) => (
    <div className="kv-cell">
      <span className="kv-l">{label}</span>
      <span className={f.value ? "kv-v" : "kv-v unknown"}>{f.value ?? "Not determinable"}</span>
    </div>
  );
  return (
    <div className="card">
      <div className="card-head">
        <h3>What the AI found</h3>
        <span className="sub">From the photos, priced with the carrier&apos;s price guide</span>
      </div>
      <div className="card-body outputs">
        <div className="out-vehicle">
          <div className="section-label">Vehicle</div>
          <div className="kv-grid">
            {cell("Make", v.make)}
            {cell("Model", v.model)}
            {cell("Colour", v.colour)}
          </div>
          <div className="field-note">{identified ? basis : basis ? `Not guessed from these photos · ${basis}` : "Not guessed from these photos"}</div>
        </div>
        <div className="out-damage">
          <div className="section-label">Damage</div>
          <div className="summary">{d.requiredOutputs.damageSummary}</div>
        </div>
      </div>
      <div className="card-body">
        <div className="section-label">Rough repair estimate</div>
        <Estimate e={d.requiredOutputs.estimate} />
      </div>
    </div>
  );
}

/** What went into the price, split by where it came from: the AI's reading of the photos, the claim, and the carrier's price guide. */
function PriceSources({ e }: { e: EstimateOutput }) {
  const p = e.pricing!;
  const cross =
    p.source === "rate_card" && e.aiItemsUsd && e.aiItemsUsd.highUsd > 0 ? (
      <div className="hint">
        The AI&apos;s own price for the same damage, as a cross-check only: {usd(e.aiItemsUsd.lowUsd)} to {usd(e.aiItemsUsd.highUsd)}.
      </div>
    ) : null;
  if (p.source !== "rate_card") return <div className="est-pricing">Priced from the AI&apos;s own figures: the price guide covers ordinary road cars only.</div>;

  const parts = e.drivers.filter((d) => d.fromPhotos && d.kind !== "possible");
  const shown = parts.slice(0, 4);
  const market = p.market.zip ? `ZIP ${p.market.zip}: ${p.market.name}` : "No ZIP on file: national average";
  const car = p.claimVehicle
    ? `${p.claimVehicle}${p.vehicleValueUsd ? `, worth ${usd(p.vehicleValueUsd)}` : ", value not on file"}`
    : p.vehicleValueUsd
      ? `Car worth ${usd(p.vehicleValueUsd)}`
      : "Car and value not on file";
  const hv = e.drivers.some((d) => d.label === "High-voltage safety procedure");
  return (
    <>
      <div className="price-src" aria-label="What went into this price">
        <div className="price-src-col ai">
          <div className="price-src-tag">
            From the photos <span>The AI&apos;s reading</span>
          </div>
          <ul>
            {shown.map((d) => (
              <li key={d.label}>{d.label}</li>
            ))}
            {parts.length > shown.length && <li>and {parts.length - shown.length} more</li>}
            {p.makeFrom === "photos" && <li>Make read from the photo, which sets the parts level</li>}
            {hv && p.electrifiedFrom === "photos" && <li>Looks electric or hybrid: adds high-voltage safety work</li>}
          </ul>
        </div>
        <div className="price-src-col claim">
          <div className="price-src-tag">
            From the claim <span>Policy and claim form</span>
          </div>
          <ul>
            <li>
              {market} sets the labour rate
            </li>
            <li>
              {car}: {p.tier} parts ({p.tierWhy})
            </li>
            {hv && p.electrifiedFrom === "claim" && <li>Electric or hybrid on the policy: adds high-voltage safety work</li>}
          </ul>
        </div>
        <div className="price-src-col card">
          <div className="price-src-tag">
            From the price guide <span>The carrier&apos;s hours and rates</span>
          </div>
          <ul>
            <li>Hours for each part and repair type</li>
            <li>
              {usd(p.baseLabourRateUsd)}/h labour
              {p.market.factor !== 1 ? `, x ${p.market.factor} here = ${usd(p.labourRateUsd)}/h` : ""}
            </li>
            <li>+{usd(p.paintMaterialsUsd)}/h for paint and materials</li>
            <li>Range of {p.bandPct}% either side</li>
          </ul>
        </div>
      </div>
      {cross}
    </>
  );
}

function Estimate({ e }: { e: EstimateOutput }) {
  if (e.status === "withheld") {
    const guess = e.aiItemsUsd && e.aiItemsUsd.highUsd > 0 ? e.aiItemsUsd : null;
    return (
      <>
        <div className="est-row">
          <span className="field-value unknown">No estimate</span>
          <span className="note">{e.note}</span>
        </div>
        {guess && e.drivers.length > 0 && (
          <details className="fold">
            <summary>The AI&apos;s rough guess, for reference only</summary>
            <div className="hint" style={{ margin: "6px 0" }}>
              From the AI&apos;s general knowledge, not our price guide, and not used for anything: {usd(guess.lowUsd)} to {usd(guess.highUsd)}.
            </div>
            <ul className="drivers">
              {e.drivers
                .filter((d) => d.kind !== "possible")
                .map((d) => (
                  <li key={d.label} className="rich">
                    <div className="drv-top">
                      <span>{d.label}</span>
                      <span className="drv-amt">{usd(d.lowUsd)} to {usd(d.highUsd)}</span>
                    </div>
                    {d.evidence && <div className="driver-note">Seen in the photo: &ldquo;{d.evidence}&rdquo;</div>}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </>
    );
  }
  const lo = e.lowUsd!;
  const hi = e.highUsd!;
  const ceil = Math.max(hi, e.ceilingUsd ?? hi);
  const max = Math.max(ceil, e.fastPathLimitUsd, e.totalLossLineUsd && e.totalLossLineUsd < ceil * 3 ? e.totalLossLineUsd : 0) * 1.12;
  const visible = e.drivers.filter((d) => d.kind !== "possible");
  const possible = e.drivers.filter((d) => d.kind === "possible");
  const one = (d: (typeof e.drivers)[number]) => (d.lowUsd === d.highUsd ? usd(d.highUsd) : d.lowUsd === 0 ? `up to ${usd(d.highUsd)}` : `${usd(d.lowUsd)} to ${usd(d.highUsd)}`);
  const pos = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  // Keep a hover note inside the card: anchor it to the label's nearer edge.
  const tipSide = (n: number) => (n / max < 0.3 ? "tip-start" : n / max > 0.6 ? "tip-end" : "");
  const showTl = e.totalLossLineUsd !== null && e.totalLossLineUsd <= max;
  // After a reviewer changes the amount, the estimate is theirs, not the rate card's.
  const reviewerSet = e.drivers.find((d) => d.label === "Reviewer's amount");
  if (reviewerSet) {
    return (
      <>
        <div className="est-row">
          <div className="range">{lo === hi ? usd(hi) : `${usd(lo)} to ${usd(hi)}`}</div>
          <div className="rangebar est-bar" aria-label="Estimate compared with the approval limit and total-loss line">
            <div className="rangebar-track" />
            <div className="rangebar-fill" style={{ left: pos(lo), width: `max(6px, calc(${pos(hi)} - ${pos(lo)}))` }} />
            <div className="rangebar-mark" style={{ left: pos(e.fastPathLimitUsd) }}>
              <span className={`has-tip ${tipSide(e.fastPathLimitUsd)}`} tabIndex={0} data-tip={approvalLimitTip(e.fastPathLimitUsd)}>
                Limit {usd(e.fastPathLimitUsd)}
              </span>
            </div>
          </div>
        </div>
        <div className="est-likely">Set by the reviewer. {reviewerSet.note}.</div>
      </>
    );
  }
  return (
    <>
      <div className="est-row">
        <div className="range" style={{ opacity: e.status === "reference_only" || e.status === "provisional" ? 0.7 : 1 }}>
          {lo === hi ? usd(hi) : `${usd(lo)} to ${usd(hi)}`}
          {e.status === "provisional" && <span className="chip chip-warn est-chip">Provisional</span>}
        </div>
        <div className="rangebar est-bar" aria-label="Estimate range compared with the approval limit and total-loss line">
          <div className="rangebar-track" />
          <div className="rangebar-fill" style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})`, background: e.status === "reference_only" || e.status === "provisional" ? "var(--text-3)" : undefined }} />
          {ceil > hi && <div className="rangebar-extra" title="Possible extras" style={{ left: pos(hi), width: `calc(${pos(ceil)} - ${pos(hi)})` }} />}
          <div className="rangebar-mark" style={{ left: pos(e.fastPathLimitUsd) }}>
            <span className={`has-tip ${tipSide(e.fastPathLimitUsd)}`} tabIndex={0} data-tip={approvalLimitTip(e.fastPathLimitUsd)}>
              Limit {usd(e.fastPathLimitUsd)}
            </span>
          </div>
          {showTl && (
            <div className={`rangebar-mark tl ${Math.abs(e.totalLossLineUsd! - e.fastPathLimitUsd) < max * 0.18 ? "above" : ""}`} style={{ left: pos(e.totalLossLineUsd!) }}>
              <span
                className={e.totalLossBasis ? `has-tip ${tipSide(e.totalLossLineUsd!)}` : undefined}
                tabIndex={e.totalLossBasis ? 0 : undefined}
                data-tip={e.totalLossBasis ? `Total-loss line: ${e.totalLossBasis}` : undefined}
              >
                Total loss {usd(e.totalLossLineUsd!)}
              </span>
            </div>
          )}
        </div>
      </div>
      {e.likelyUsd !== undefined && (
        <div className="est-likely">
          Most likely <b>{usd(e.likelyUsd)}</b> for the damage the photos show.
          {ceil > hi && <> Could reach {usd(ceil)} if the possible extras below are found.</>}
        </div>
      )}
      {e.pricing && <PriceSources e={e} />}
      <div className="hint">
        {e.status === "provisional" ? e.note : e.status === "reference_only" ? "For the adjuster's reference only." : "If the shop finds more damage, it sends a supplement."} {e.accuracyNote}
      </div>
      <details className="fold">
        <summary>
          How it adds up ({visible.length} repair{visible.length === 1 ? "" : "s"}
          {possible.length ? `, ${possible.length} possible extra${possible.length === 1 ? "" : "s"}` : ""})
        </summary>
        <ul className="drivers">
          {visible.map((dr) => (
            <li key={dr.label} className="rich">
              <div className="drv-top">
                <span>
                  {dr.label}
                  <span className={`chip src ${dr.source === "rule_adjustment" ? "" : "chip-info"}`}>
                    {dr.source === "rate_card" ? "Price guide" : dr.source === "ai_estimate" ? "AI estimate" : "Rule adjustment, illustrative"}
                  </span>
                </span>
                <span className="drv-amt">{one(dr)}</span>
              </div>
              {dr.evidence && (
                <div className="driver-note">
                  <span className="src-ai-text">Seen in the photo:</span> &ldquo;{dr.evidence}&rdquo;
                </div>
              )}
              {dr.options ? (
                <div className="driver-options">
                  {dr.options.map((o) => (
                    <div key={o.label} className={o.chosen ? "chosen" : ""}>
                      <b>{o.label}{o.chosen ? " (priced)" : ""}:</b> {o.math}
                    </div>
                  ))}
                </div>
              ) : (
                dr.math && <div className="driver-math">{dr.math}</div>
              )}
              {dr.decision && <div className="driver-note">{dr.decision}</div>}
              {dr.source !== "rate_card" && dr.note && <div className="driver-note">{dr.note}</div>}
            </li>
          ))}
        </ul>
        {possible.length > 0 && (
          <>
            <div className="drivers-head">Possible extras, not in the likely range</div>
            <ul className="drivers possible">
              {possible.map((dr) => (
                <li key={dr.label} className="rich">
                  <div className="drv-top">
                    <span>{dr.label}</span>
                    <span className="drv-amt">{one(dr)}</span>
                  </div>
                  {dr.note && <div className="driver-note">{dr.note}</div>}
                  {dr.math && <div className="driver-math">{dr.math}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
        {e.workings && e.workings.length > 0 && (
          <div className="workings">
            <div className="drivers-head">The math</div>
            {e.workings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
        )}
        {e.status !== "provisional" && <div className="note">{e.note}</div>}
      </details>
    </>
  );
}

const GROUPS: { effect: "adjuster" | "more_evidence" | "review"; label: string }[] = [
  { effect: "adjuster", label: "Sends it to an adjuster" },
  { effect: "more_evidence", label: "Asks for more photos" },
  { effect: "review", label: "Flags it for a person to check" },
];

/** "Can't identify the car (E2) and damage isn't fully in frame (E3)" */
function listRules(rs: Decision["reasons"]) {
  const parts = rs.map((r) => `${r.title.charAt(0).toLowerCase()}${r.title.slice(1)} (${r.id})`);
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Why, in one or two sentences, before the detail. */
function WhySummary({ d }: { d: Decision }) {
  const by = (e: string) => d.reasons.filter((r) => r.effect === e);
  const adjuster = by("adjuster");
  const evidence = by("more_evidence");
  const review = by("review");
  const main = d.route === "adjuster" ? adjuster : d.route === "more_evidence" ? evidence : [];
  return (
    <div className="why-summary">
      {main.length > 0 && (
        <div>
          <b>Because:</b> {listRules(main)}.
        </div>
      )}
      {d.route === "adjuster" && evidence.length > 0 && <div>Photo rules fired too ({evidence.map((r) => r.id).join(", ")}), but an adjuster comes before asking for photos.</div>}
      {review.length > 0 && (
        <div>
          {main.length === 0 && "No rule changes the route. "}Flagged for a person to check: {listRules(review)}.
        </div>
      )}
    </div>
  );
}

/** The card's question, in the route's own words: "Why it's ready to approve", and so on. */
function whyHeading(d: Decision) {
  if (d.route === "photo_estimate") return "Why it's ready to approve";
  if (d.route === "more_evidence") return "Why it needs more evidence";
  if (d.route === "adjuster") {
    const to = d.reasons.some((r) => r.id === "C2") ? "the total loss unit" : "a field adjuster";
    return `Why it goes to ${to}${d.siuReferral ? " and SIU" : ""}`;
  }
  return "Why this route";
}

function Reasons({ d, onOpenProtocol }: { d: Decision; onOpenProtocol: () => void }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>{whyHeading(d)}</h3>
        <button className="btn btn-sm btn-ghost" onClick={onOpenProtocol} title="Open the routing protocol">
          {d.reasons.length ? `${d.reasons.length} rule${d.reasons.length === 1 ? "" : "s"} fired` : "No rules fired"}
        </button>
      </div>
      <div className="card-body">
        {d.reasons.length === 0 ? (
          <div className="reason-text">
            No rules fired: the photos show the whole car and damage, nothing looks serious, and the estimate is within the approval limit. Everything below was checked.
          </div>
        ) : (
          <>
            <WhySummary d={d} />
            <details className="fold">
              <summary>
                Each rule, with what it saw and where that came from ({d.reasons.length})
              </summary>
              {GROUPS.map((g) => {
                const rs = d.reasons.filter((r) => r.effect === g.effect);
                if (!rs.length) return null;
                return (
                  <div key={g.effect} className={`reason-group effect-${g.effect}`}>
                    <div className="reason-group-head">
                      <span className="dot" /> {g.label} <span className="n">{rs.length}</span>
                    </div>
                    <ul className="reasons compact">
                      {rs.map((r) => {
                        const rule = r.citations?.find((c) => c.source === "Protocol" && c.text.startsWith("Rule "));
                        const sources = r.citations?.filter((c) => c !== rule) ?? [];
                        return (
                          <li key={r.id} className={`reason effect-${r.effect}`}>
                            <div>
                              <span className="reason-title">{r.title}</span>
                              <span className="rid">{r.id}</span>
                              <span className="reason-text"> {r.reason}</span>
                              <div className="cites">
                                {rule && <div className="reason-rule">{rule.text}</div>}
                                {r.evidence && <div className="reason-evidence">Seen: {r.evidence}</div>}
                                {sources.length > 0 && (
                                  <ul>
                                    {sources.map((c, k) => (
                                      <li key={k}>
                                        <span className={`src src-${c.source.split(" ")[0].toLowerCase()}`}>{c.source}</span> {c.text}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </details>
          </>
        )}
        <Checks d={d} />
      </div>
    </div>
  );
}

/** Which rule a failed check sets off, so a red chip points at the reason above it. */
const CHECK_RULES: Record<string, string[]> = {
  "Vehicle in the photos": ["E1"],
  "Car identified from a badge or body shape": ["E2"],
  "Whole damaged area in frame": ["E3"],
  "Bright enough": ["E4"],
  "Sharp enough": ["E4"],
  "High enough resolution": ["E4"],
  "No glare or obstruction over the damage": ["E4"],
  "Colour photo": ["E4"],
  "Only one car in the photo": ["E6"],
  "Not seen on a past claim": ["I1"],
  "Insured vehicle": ["R2"],
  "Colour": ["R2"],
  "Point of impact": ["R3"],
};

/** What was checked, inside the route card: exceptions up front, the full tables one click away. */
function Checks({ d }: { d: Decision }) {
  const fired = new Set(d.reasons.map((r) => r.id));
  const ruleTag = (label: string) => {
    const ids = (CHECK_RULES[label] ?? []).filter((id) => fired.has(id));
    return ids.length ? <span className="rid">{ids.join(", ")}</span> : null;
  };
  const icon = { match: "✓", mismatch: "✕", not_compared: "?", info: "i" } as const;
  const compared = d.policyChecks.filter((p) => p.status !== "info");
  const mismatch = compared.some((p) => p.status === "mismatch");
  const failed = d.evidenceChecklist.filter((c) => !c.ok);
  const passed = d.evidenceChecklist.length - failed.length;
  return (
    <div className="checks checks-in-route">
      <div className="drivers-head">What we checked</div>
      <div className="checks">
        <div className="check-row">
          <span className="check-label">Policy and claim</span>
          <span className="check-chips">
            {compared.map((p) => (
              <span key={p.label} className={`pchip pchip-${p.status}`} title={`On file: ${p.onFile}. From the photos: ${p.observed}`}>
                {icon[p.status]} {p.label}
                {p.status === "mismatch" && ruleTag(p.label)}
              </span>
            ))}
            <span className="pchip pchip-info" title="This tool compares facts to route the claim. It never decides what the policy covers or pays.">
              Coverage checked in the claims system
            </span>
          </span>
        </div>
        <div className="check-row">
          <span className="check-label">Photo evidence</span>
          <span className="check-chips">
            <span className={`pchip ${failed.length ? "pchip-neutral" : "pchip-match"}`}>
              {failed.length ? `${passed} of ${d.evidenceChecklist.length} passed` : `✓ All ${d.evidenceChecklist.length} passed`}
            </span>
            {failed.map((c) => (
              <span key={c.label} className="pchip pchip-mismatch" title={c.detail}>
                ✕ {c.label}
                {ruleTag(c.label)}
              </span>
            ))}
          </span>
        </div>
        <details className="fold" open={mismatch}>
          <summary>All checks, with what's on file</summary>
          <table className="t">
            <thead>
              <tr>
                <th />
                <th>Check</th>
                <th>On file</th>
                <th>From the photos and rules</th>
              </tr>
            </thead>
            <tbody>
              {d.policyChecks.map((p) => (
                <tr key={p.label}>
                  <td className={`pc pc-${p.status}`}>{icon[p.status]}</td>
                  <td>
                    <b>{p.label}</b>
                  </td>
                  <td>{p.onFile}</td>
                  <td>
                    {p.observed}
                    {p.note && <div className="hint">{p.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="checklist" style={{ marginTop: 10 }}>
            {d.evidenceChecklist.map((c) => (
              <li key={c.label} title={c.detail}>
                <span className={c.ok ? "tick" : "cross"}>{c.ok ? "✓" : "✕"}</span>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}

function Thread(props: {
  item: CaseItem;
  decision: Decision | null;
  onThread: (id: string, entry: Omit<ThreadEntry, "id" | "at">) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  const { item, decision, mode } = props;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an
  // effect must return nothing or a cleanup function.
  // Only follow new messages added while the claim is open. Opening a claim starts at the top.
  const seen = useRef(item.thread.length);
  useEffect(() => {
    if (item.thread.length > seen.current && seen.current > 0) {
      end.current?.scrollIntoView({ block: "nearest" });
    }
    seen.current = item.thread.length;
  }, [item.thread.length]);

  const history = () => {
    const pairs: { question: string; answer: string }[] = [];
    item.thread.forEach((t, i) => {
      if (t.kind === "question" && item.thread[i + 1]?.kind === "answer") pairs.push({ question: t.text, answer: item.thread[i + 1].text });
    });
    return pairs.slice(-5);
  };

  const submit = async () => {
    const q = text.trim();
    if (!q) return;
    setErr(null);
    if (mode === "comment") {
      props.onThread(item.id, { kind: "comment", author: REVIEWER.name, text: q });
      setText("");
      props.setMode(null);
      return;
    }
    setBusy(true);
    props.onThread(item.id, { kind: "question", author: REVIEWER.name, text: q });
    setText("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: q,
          photos: item.photos.filter((p) => p.base64).map((p) => ({ name: p.name, base64: p.base64 })),
          facts: item.assessment?.ok ? item.assessment.extraction : null,
          route: decision?.routeLabel ?? ROUTE_LABELS.manual_triage,
          reasons: decision?.reasons.map((r) => `${r.title}: ${r.reason}`) ?? [],
          history: history(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The AI couldn't answer right now.");
      props.onThread(item.id, { kind: "answer", author: "AI assistant", text: body.answer });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The AI couldn't answer right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Case thread</h3>
        <span className="sub">The assistant can explain, but can&apos;t change the route</span>
      </div>
      <div className="card-body">
        <div className="thread">
          {item.thread.map((t) => (
            <div key={t.id} className={`entry ${t.kind === "note" || t.kind === "answer" ? "ai" : t.kind}`}>
              <div className="entry-head">
                <b>{t.author}</b>
                <span>{t.kind === "question" ? "asked" : t.kind === "comment" ? "commented" : t.kind === "action" ? "" : ""}</span>
                <span style={{ marginLeft: "auto" }}>{new Date(t.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              </div>
              <div className="entry-body">{t.text}</div>
            </div>
          ))}
          {busy && (
            <div className="entry ai">
              <div className="entry-head">
                <b>AI assistant</b>
              </div>
              <div className="entry-body">
                <span className="spinner" /> Looking at the photos...
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
        {(mode === "comment" || mode === "ask") && (
          <div className="composer">
            <textarea
              autoFocus
              placeholder={mode === "ask" ? 'Ask about this claim, e.g. "What makes this structural?"' : "Add a comment for the file"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
              }}
            />
            {err && <div className="err">{err}</div>}
            <div className="composer-row">
              <button className="btn btn-sm btn-ghost" onClick={() => props.setMode(null)}>
                Cancel
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => void submit()} disabled={busy || !text.trim()}>
                {mode === "ask" ? "Ask" : "Add comment"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBar(props: {
  item: CaseItem;
  route: Route;
  d: Decision | null;
  settings: Settings;
  mode: Mode;
  setMode: (m: Mode) => void;
  message: string;
  channel: Channel | null;
  setChannel: (c: Channel) => void;
  sendUpdate: boolean;
  setSendUpdate: (b: boolean) => void;
  setMessage: (m: string) => void;
  onComplete: (id: string, outcome: Omit<CaseOutcome, "at">) => void;
  onThread: (id: string, entry: Omit<ThreadEntry, "id" | "at">) => void;
  onReassess: (id: string) => void;
  onCustomerPhotos: (id: string, photos: CasePhoto[]) => void;
}) {
  const { item, route, d, mode, setMode, channel } = props;
  const [callOpen, setCallOpen] = useState(false);
  const [newRoute, setNewRoute] = useState<Route>(route === "adjuster" ? "photo_estimate" : "adjuster");
  const [reason, setReason] = useState("");
  const e = d?.requiredOutputs.estimate;
  // The amount the reviewer approves: the most likely figure unless they change it.
  const [amount, setAmount] = useState(String(e?.likelyUsd ?? e?.highUsd ?? ""));
  const [to, setTo] = useState("dana");
  const [note, setNote] = useState("");
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const done = (outcome: Omit<CaseOutcome, "at">) => {
    props.onComplete(item.id, outcome);
    setMode(null);
  };
  // Records a message to the customer in the case thread. In production this goes out
  // through the carrier's texting or email system.
  const tellCustomer = (text: string) => {
    if (!channel || !text.trim()) return "";
    props.onThread(item.id, { kind: "action", author: REVIEWER.name, text: `${sentVia(item.claim, channel)}: "${messagePreview(text)}"` });
    return ` ${channel === "text" ? "Texted" : "Emailed"} the customer an update.`;
  };
  const withUpdate = (text: string | null) => (props.sendUpdate && text ? tellCustomer(text) : "");
  const open = (m: Mode) => {
    setReason("");
    setMode(mode === m ? null : m);
  };

  // While a form is open, its own button is the only way forward.
  const formOpen = mode === "adjust" || mode === "change" || mode === "send" || mode === "contact" || mode === "update";
  const name = firstName(item.claim) ?? "the customer";
  const contactable = channels(item.claim).length > 0;
  const [adhoc, setAdhoc] = useState(`Hi ${firstName(item.claim) ?? "there"},\n\n`);
  const [hideRequest, setHideRequest] = useState(false);
  // A hidden message is per claim: opening another claim shows its message again.
  useEffect(() => setHideRequest(false), [item.id]);
  const picker = contactable ? <ChannelPicker claim={item.claim} channel={channel} setChannel={props.setChannel} /> : null;
  const totalLoss = !!d?.reasons.some((r) => r.id === "C2");
  const adjusterTargets = totalLoss ? ["total_loss"] : ["field"];
  if (d?.siuReferral) adjusterTargets.push("siu");
  const names = (ids: string[]) => ids.map((id) => recipient(id).name.replace(/^(Estimating|Total|Field|Manual)/, (m) => m.toLowerCase())).join(" and ");

  // The reviewer's amount goes back through the same rules, so a correction can change the route.
  const amountN = Math.round(Number(amount));
  const loN = amountN;
  const hiN = amountN;
  const rangeValid = amount.trim() !== "" && Number.isFinite(amountN) && amountN >= 0;
  const preview =
    mode === "adjust" && rangeValid && item.assessment?.ok
      ? decide(item.assessment.extraction, item.claim, item.assessment.photos, props.settings, { reviewerRange: { lowUsd: loN, highUsd: hiN } })
      : null;
  const previewCostReasons = preview?.reasons.filter((r) => r.group === "cost") ?? [];
  const previewTotalLoss = !!preview?.reasons.some((r) => r.id === "C2");
  const previewTargets = preview?.route === "adjuster" ? [previewTotalLoss ? "total_loss" : "field", ...(preview.siuReferral ? ["siu"] : [])] : ["repair"];

  const extras = (
    <>
      <button className="btn btn-sm" onClick={() => open("send")}>
        Send to someone
      </button>
      {route !== "manual_triage" && (
        <button className="btn btn-sm" onClick={() => open("change")}>
          Change route
        </button>
      )}
      {route !== "more_evidence" && (
        <button className="btn btn-sm" onClick={() => open("contact")}>
          Contact customer
        </button>
      )}
      <button className="btn btn-sm" onClick={() => setMode(mode === "comment" ? null : "comment")}>
        Comment
      </button>
      {route !== "manual_triage" && (
        <button className="btn btn-sm" onClick={() => setMode(mode === "ask" ? null : "ask")}>
          Ask
        </button>
      )}
    </>
  );

  if (item.status === "done" && item.outcome) {
    const waiting = item.outcome.action === "message_sent";
    const holder = holderLine(item.outcome);
    return (
      <div className="actionbar">
        <div className="done-banner">
          Done: {item.outcome.summary}
          {item.outcome.reason && <> Reason: {item.outcome.reason}</>}
          {holder && <div className="done-holder">{holder}</div>}
        </div>
        {waiting && (
          <FollowUp
            item={item}
            channel={channel}
            onReminder={() => tellCustomer(reminder(item.claim))}
            onCall={() => setCallOpen((o) => !o)}
          />
        )}
        {callOpen && <CallForm claim={item.claim} onLog={(text) => { props.onThread(item.id, { kind: "action", author: REVIEWER.name, text }); setCallOpen(false); }} onCancel={() => setCallOpen(false)} />}
        {waiting && (
          <div className="actionbar-row">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={async (ev) => {
                const files = Array.from(ev.target.files ?? []);
                const bad = files.find((f) => kindOf(f) !== "image");
                if (bad) return setUploadErr("Only JPEG, PNG or WebP photos can be added.");
                setUploadErr(null);
                props.onCustomerPhotos(item.id, await Promise.all(files.map((f) => shrink(f, f.name, "upload"))));
              }}
            />
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
              Customer replied: add their photos
            </button>
            {item.demoKey === "B" && (
              <button
                className="btn"
                onClick={async () => props.onCustomerPhotos(item.id, [await loadDemoPhoto("/demo/A-straightforward/demo_A_civic.jpg")])}
                title="Demo only: attaches the wider photo of the same car"
              >
                Demo: attach the customer&apos;s retake
              </button>
            )}
          </div>
        )}
        {uploadErr && <div className="err">{uploadErr}</div>}
        <div className="actionbar-row">
          <button className="btn btn-sm btn-ghost" onClick={() => props.onReassess(item.id)}>
            Reopen and re-assess
          </button>
        </div>
      </div>
    );
  }

  const verb = channel === "email" ? "email" : "text";
  return (
    <div className="actionbar">
      {mode === "contact" && (
        <div className="contact-composer">
          <div className="contact-head">
            <b>Message {name}</b>
            {picker}
          </div>
          {contactable ? (
            <MessageBox value={adhoc} onChange={(ev) => setAdhoc(ev.target.value)} />
          ) : (
            <div className="hint">No phone or email on file. Add them under Edit details.</div>
          )}
          <div className="composer-row">
            <button className="btn btn-sm btn-ghost" onClick={() => setMode(null)}>
              Cancel
            </button>
            <button className="btn btn-sm" disabled={!item.claim.contact?.phone} onClick={() => setCallOpen((o) => !o)}>
              Log a call
            </button>
            <button
              className="btn btn-sm btn-primary"
              disabled={!contactable || !adhoc.replace(/^Hi [^,\n]*,\s*/, "").trim()}
              onClick={() => {
                tellCustomer(adhoc);
                setAdhoc(`Hi ${firstName(item.claim) ?? "there"},\n\n`);
                setMode(null);
              }}
            >
              Send {verb}
            </button>
          </div>
        </div>
      )}
      {mode === "update" && (
        <div className="contact-composer">
          <div className="contact-head">
            <b>Update for {name}, sent {route === "photo_estimate" ? "when you approve" : "when you send the claim on"}</b>
            {picker}
          </div>
          <MessageBox value={props.message} onChange={(ev) => props.setMessage(ev.target.value)} />
          <div className="composer-row">
            {route === "adjuster" && <span className="hint" style={{ marginRight: "auto" }}>Never mentions a total loss or a fraud review.</span>}
            <button className="btn btn-sm btn-primary" onClick={() => setMode(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      {callOpen && item.status !== "done" && (
        <CallForm
          claim={item.claim}
          onLog={(text) => {
            props.onThread(item.id, { kind: "action", author: REVIEWER.name, text });
            setCallOpen(false);
          }}
          onCancel={() => setCallOpen(false)}
        />
      )}
      {!formOpen && contactable && (route === "photo_estimate" || route === "adjuster") && (
        <div className="update-line">
          <label>
            <input type="checkbox" checked={props.sendUpdate} onChange={(ev) => props.setSendUpdate(ev.target.checked)} /> Also {verb} {name} an update
          </label>
          <button className="linkish" onClick={() => open("update")}>
            Edit message
          </button>
        </div>
      )}
      {mode === "send" && (
        <div className="inline-form">
          <div className="row">
            <label>
              Send to
              <select value={to} onChange={(ev) => setTo(ev.target.value)}>
                {DIRECTORY.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.role})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="hint">{recipient(to).forWhat}.</div>
          <label>
            Note for {recipient(to).name}
            <textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="What do you need from them?" />
          </label>
          <div className="composer-row">
            <button className="btn btn-sm btn-ghost" onClick={() => setMode(null)}>
              Cancel
            </button>
            <button
              className="btn btn-sm"
              title="Keeps the claim on your worklist and adds the request to the case thread"
              onClick={() => {
                props.onThread(item.id, {
                  kind: "comment",
                  author: REVIEWER.name,
                  text: `@${recipient(to).name}: second opinion requested.${note.trim() ? ` ${note.trim()}` : ""} The claim stays on my worklist.`,
                });
                setNote("");
                setMode(null);
              }}
            >
              Ask for a second opinion
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() =>
                done({
                  action: "handed_off",
                  route,
                  summary: `Handed off to ${recipient(to).name} (${recipient(to).role}) with the recommended route of ${ROUTE_LABELS[route]}.`,
                  reason: note.trim() || undefined,
                  sentTo: [to],
                })
              }
            >
              Hand off
            </button>
          </div>
        </div>
      )}
      {mode === "change" && (
        <div className="inline-form">
          <div className="row">
            <label>
              New route
              <select value={newRoute} onChange={(ev) => setNewRoute(ev.target.value as Route)}>
                {(["photo_estimate", "more_evidence", "adjuster"] as Route[])
                  .filter((r) => r !== route)
                  .map((r) => (
                    <option key={r} value={r}>
                      {ROUTE_LABELS[r]}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="hint">Goes to the {names([ROUTE_OWNER[newRoute]])}. Your reason is saved with the decision and can become a test case.</div>
          <label>
            Reason (required)
            <textarea rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="What did the AI or the rules get wrong?" />
          </label>
          <div className="composer-row">
            <button className="btn btn-sm btn-ghost" onClick={() => setMode(null)}>
              Cancel
            </button>
            {!reason.trim() && <span className="hint">Add a reason to continue</span>}
            <button
              className="btn btn-sm btn-primary"
              disabled={!reason.trim()}
              onClick={() =>
                done({
                  action: "route_changed",
                  route: newRoute,
                  summary: `Changed the route from ${ROUTE_LABELS[route]} to ${ROUTE_LABELS[newRoute]} and sent it to the ${names([ROUTE_OWNER[newRoute]])}.`,
                  reason: reason.trim(),
                  sentTo: [ROUTE_OWNER[newRoute]],
                })
              }
            >
              Change route
            </button>
          </div>
        </div>
      )}
      {mode === "adjust" && e && (
        <div className="inline-form">
          <div className="row">
            <label>
              Estimate to approve (USD)
              <input type="number" min={0} value={amount} onChange={(ev) => setAmount(ev.target.value)} />
            </label>
          </div>
          {!rangeValid ? (
            <div className="err">Enter the amount you want to approve.</div>
          ) : preview ? (
            <div className={`adjust-preview route-${preview.route}`}>
              <b>At {usd(amountN)} the rules say: {preview.routeLabel}.</b>{" "}
              {previewCostReasons.length ? previewCostReasons.map((r) => `${r.reason} (rule ${r.id})`).join(" ") : `It's within your ${usd(props.settings.fastPathLimitUsd)} approval limit.`}
            </div>
          ) : null}
          <label>
            Why (optional, saved as feedback on the AI&apos;s price)
            <textarea rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. quarter panel needs replacing, not repair" />
          </label>
          <div className="composer-row">
            <button className="btn btn-sm btn-ghost" onClick={() => setMode(null)}>
              Cancel
            </button>
            <button
              className={`btn btn-sm ${preview?.route === "adjuster" ? "btn-danger" : "btn-primary"}`}
              disabled={!preview}
              onClick={() => {
                if (!preview) return;
                const range = `${usd(amountN)} (the price guide said ${usd(e.likelyUsd ?? e.highUsd!)}, range ${usd(e.lowUsd!)} to ${usd(e.highUsd!)})`;
                // The message names the approved amount, so redraft it for the new one.
                const update = withUpdate(customerUpdate(preview, item.claim));
                done(
                  preview.route === "adjuster"
                    ? {
                        action: "assigned_adjuster",
                        route: "adjuster",
                        summary: `Changed the estimate to ${range}. That's over the approval limit, so it went to the ${names(previewTargets)}.${update}`,
                        reason: reason.trim() || undefined,
                        adjustedRange: { lowUsd: loN, highUsd: hiN },
                        sentTo: previewTargets,
                      }
                    : {
                        action: "approved",
                        route: preview.route,
                        summary: `Approved a repair estimate of ${range}, within the ${usd(props.settings.fastPathLimitUsd)} approval limit. Sent to repair and payment.${update}`,
                        reason: reason.trim() || undefined,
                        adjustedRange: { lowUsd: loN, highUsd: hiN },
                        sentTo: previewTargets,
                      },
                );
              }}
            >
              {preview?.route === "adjuster" ? `Send to ${names(previewTargets)}` : `Approve ${usd(amountN)} estimate`}
            </button>
          </div>
        </div>
      )}

      {!formOpen && route === "photo_estimate" && e && e.lowUsd !== null && (
        <div className="actionbar-row">
          <button
            className="btn btn-primary"
            onClick={() =>
              done({
                action: "approved",
                route,
                summary: `Approved a repair estimate of ${usd(e.likelyUsd ?? e.highUsd!)} (range ${usd(e.lowUsd!)} to ${usd(e.highUsd!)}), within the ${usd(props.settings.fastPathLimitUsd)} approval limit. Sent to repair and payment.${withUpdate(props.message)}`,
                sentTo: ["repair"],
              })
            }
          >
            Approve {usd(e.likelyUsd ?? e.highUsd!)} estimate
          </button>
          <button className="btn" onClick={() => open("adjust")}>
            Change amount
          </button>
        </div>
      )}
      {!formOpen && route === "more_evidence" && (
        hideRequest ? (
          <div className="contact-composer contact-collapsed">
            <div className="contact-head">
              <b>Recommended: ask {name} for {d?.retakes.length ?? 1} photo{(d?.retakes.length ?? 1) === 1 ? "" : "s"}</b>
              <span className="hint">Message hidden</span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-sm btn-warn" onClick={() => setHideRequest(false)}>
                Show message
              </button>
            </div>
          </div>
        ) : (
          <div className="contact-composer">
            <div className="contact-head">
              <b>Recommended: ask {name} for {d?.retakes.length ?? 1} photo{(d?.retakes.length ?? 1) === 1 ? "" : "s"}</b>
              {picker ?? <span className="hint">No phone or email on file; send it outside the tool, then mark it sent.</span>}
              <span style={{ flex: 1 }} />
              <button className="btn btn-sm btn-ghost" onClick={() => setHideRequest(true)}>
                Hide
              </button>
            </div>
            <MessageBox value={props.message} onChange={(ev) => props.setMessage(ev.target.value)} />
            <div className="composer-row">
              <span className="hint" style={{ marginRight: "auto" }}>
                Includes an upload link. The claim then waits, with a follow-up date.
              </span>
              <button className="btn btn-sm" disabled={!item.claim.contact?.phone} onClick={() => setCallOpen((o) => !o)}>
                Log a call
              </button>
              <button
                className="btn btn-sm btn-warn"
                onClick={() => {
                  const n = d?.retakes.length ?? 1;
                  const what = `${n} photo${n === 1 ? "" : "s"}`;
                  const due = shortDate(followUpDate(new Date().toISOString()));
                  const how = channel ? sentVia(item.claim, channel) : "Sent the customer a message";
                  tellCustomer(props.message);
                  done({
                    action: "message_sent",
                    route,
                    summary: `${how} asking for ${what}. Follow up by ${due} if there's no reply.`,
                    sentTo: [],
                  });
                }}
                disabled={!props.message.trim()}
              >
                {channel === "text" ? `Text ${name}` : channel === "email" ? `Email ${name}` : "Mark as sent"}
              </button>
            </div>
          </div>
        )
      )}
      {!formOpen && route === "adjuster" && (
        <div className="actionbar-row">
          <button
            className="btn btn-danger"
            onClick={() =>
              done({
                action: "assigned_adjuster",
                route,
                summary: `Sent to the ${names(adjusterTargets)}${d?.siuReferral ? " for review before any payment" : ""}.${withUpdate(props.message)}`,
                sentTo: adjusterTargets,
              })
            }
          >
            Send to {names(adjusterTargets)}
          </button>
        </div>
      )}
      {!formOpen && route === "manual_triage" && (
        <div className="actionbar-row">
          <button className="btn btn-primary" onClick={() => done({ action: "assigned_manual", route, summary: "Sent to the manual triage queue (the existing process).", sentTo: ["manual"] })}>
            Send to manual triage
          </button>
          <button className="btn" onClick={() => props.onReassess(item.id)}>
            Retry assessment
          </button>
        </div>
      )}
      <div className="actionbar-row">{extras}</div>
    </div>
  );
}

function ChannelPicker({ claim, channel, setChannel }: { claim: CaseItem["claim"]; channel: Channel | null; setChannel: (c: Channel) => void }) {
  const available = channels(claim);
  return (
    <span className="picker">
      <span className="seg seg-sm">
        {available.map((c) => (
          <button key={c} className={channel === c ? "on" : ""} onClick={() => setChannel(c)}>
            {c === "text" ? "Text" : "Email"}
          </button>
        ))}
      </span>
      <span className="hint">to {channel === "email" ? claim.contact?.email : claim.contact?.phone}</span>
    </span>
  );
}

function FollowUp({ item, channel, onReminder, onCall }: { item: CaseItem; channel: Channel | null; onReminder: () => void; onCall: () => void }) {
  const due = followUpDate(item.outcome!.at);
  const overdue = Date.now() > due.getTime();
  const reminders = item.thread.filter((t) => t.text.includes("A quick reminder") || / reminder/.test(t.text)).length;
  return (
    <div className={`followup ${overdue ? "overdue" : ""}`}>
      <div>
        <b>Task: follow up with {firstName(item.claim) ?? "the customer"}</b> by {shortDate(due)} if the photos haven&apos;t arrived.
        {reminders > 0 && <span className="hint"> Reminder sent.</span>}
      </div>
      <div className="followup-actions">
        <button className="btn btn-sm" disabled={!channel} onClick={onReminder}>
          Send a reminder{channel ? ` by ${channel}` : ""}
        </button>
        <button className="btn btn-sm" disabled={!item.claim.contact?.phone} onClick={onCall}>
          Log a call
        </button>
      </div>
    </div>
  );
}

function CallForm({ claim, onLog, onCancel }: { claim: CaseItem["claim"]; onLog: (text: string) => void; onCancel: () => void }) {
  const [outcome, setOutcome] = useState<(typeof CALL_OUTCOMES)[number]>(CALL_OUTCOMES[0]);
  const [note, setNote] = useState("");
  return (
    <div className="inline-form" style={{ marginTop: 8 }}>
      <div className="row">
        <label>
          Called {firstName(claim) ?? "the customer"} at {claim.contact?.phone}
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as (typeof CALL_OUTCOMES)[number])}>
            {CALL_OUTCOMES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Note (optional)
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. will send photos after work today" />
      </label>
      <div className="composer-row">
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => onLog(`Called ${firstName(claim) ?? "the customer"} at ${claim.contact?.phone}: ${outcome.toLowerCase()}.${note.trim() ? ` ${note.trim()}` : ""}`)}
        >
          Save call
        </button>
      </div>
    </div>
  );
}

/** A message box that grows to fit its message, up to a cap, so the whole draft is visible. */
function MessageBox({ value, onChange }: { value: string; onChange: (ev: React.ChangeEvent<HTMLTextAreaElement>) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} rows={3} value={value} onChange={onChange} className="message-box" />;
}

// How often the reviewer agrees with the recommendation. Every final decision is logged with
// the route the AI and rules recommended, the route the reviewer chose, and why. The log is
// kept separately from the claims, so a claim that is re-assessed (say, after a retake)
// doesn't erase the earlier decision. In production this is the audit log that feeds
// override-rate monitoring, and each disagreement becomes a candidate test case.

import { decide, type Decision } from "../policy/engine.ts";
import { ROUTE_LABELS, type Route, type Settings } from "../policy/protocol.ts";
import { recipient, recommendedTeams, REVIEWER, type Agreement, type CaseItem, type CaseOutcome } from "./cases.ts";

export type { Agreement };

export const AGREEMENT_LABELS: Record<Agreement, string> = {
  kept: "Kept the recommendation",
  adjusted_range: "Changed the amount",
  changed_route: "Changed the route",
  changed_team: "Sent to a different team",
};

export interface ReviewLogEntry {
  id: string;
  caseId: string;
  claimId: string;
  at: string;
  reviewer: string;
  recommendedRoute: Route;
  finalRoute: Route;
  /** Who the recommendation would send it to, and who the reviewer sent it to. */
  recommendedTo: string[];
  sentTo: string[];
  agreement: Agreement;
  action: CaseOutcome["action"];
  aiRange: { lowUsd: number; highUsd: number } | null;
  adjustedRange?: { lowUsd: number; highUsd: number };
  reason?: string;
  rulesFired: string[];
  photos: string[];
  vehicle: { make: string | null; model: string | null; colour: string | null };
}

/** The recommendation before the reviewer touched it: no reviewer range applied. */
export function recommendation(c: CaseItem, settings: Settings): Decision | null {
  if (!c.assessment?.ok) return null;
  try {
    return decide(c.assessment.extraction, c.claim, c.assessment.photos, settings);
  } catch {
    return null;
  }
}

/**
 * A route change is always a disagreement. A new amount counts as "adjusted" when the route
 * holds, and as a route change when the new range moves the claim to a different route.
 * Handing off on the recommended route is agreement only when it goes to the team the
 * recommendation names: a total loss sent to a field adjuster, or a simple claim sent to a
 * supervisor, is a different decision.
 */
export function agreementOf(recommended: Route, o: Pick<CaseOutcome, "action" | "route" | "adjustedRange" | "sentTo">, recommendedTo?: string[]): Agreement {
  if (o.action === "route_changed" || o.route !== recommended) return "changed_route";
  if (o.action === "handed_off" && recommendedTo && o.sentTo?.some((t) => !recommendedTo.includes(t))) return "changed_team";
  if (o.adjustedRange) return "adjusted_range";
  return "kept";
}

export function logEntry(c: CaseItem, o: CaseOutcome, rec: Decision | null): ReviewLogEntry {
  const recommendedRoute = rec?.route ?? "manual_triage";
  const recommendedTo = recommendedTeams(rec);
  const e = rec?.requiredOutputs.estimate;
  const v = rec?.requiredOutputs.vehicle;
  return {
    id: `${c.id}-${o.at}`,
    caseId: c.id,
    claimId: c.claim.claimId,
    at: o.at,
    reviewer: REVIEWER.name,
    recommendedRoute,
    finalRoute: o.route,
    recommendedTo,
    sentTo: o.sentTo ?? [],
    agreement: agreementOf(recommendedRoute, o, recommendedTo),
    action: o.action,
    aiRange: e && e.lowUsd !== null && e.highUsd !== null ? { lowUsd: e.lowUsd, highUsd: e.highUsd } : null,
    adjustedRange: o.adjustedRange,
    reason: o.reason,
    rulesFired: rec?.reasons.map((r) => r.id) ?? [],
    photos: c.photos.map((p) => p.url ?? p.name),
    vehicle: { make: v?.make.value ?? null, model: v?.model.value ?? null, colour: v?.colour.value ?? null },
  };
}

export interface AgreementSummary {
  total: number;
  kept: number;
  adjusted: number;
  changed: number;
  team: number;
}

export function summarize(log: ReviewLogEntry[]): AgreementSummary {
  const n = (a: Agreement) => log.filter((e) => e.agreement === a).length;
  return { total: log.length, kept: n("kept"), adjusted: n("adjusted_range"), changed: n("changed_route"), team: n("changed_team") };
}

const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every decision, one row each: the file a data lead would load to track the override rate. */
export function logCsv(log: ReviewLogEntry[]): string {
  const head = ["claim_id", "decided_at", "reviewer", "recommended_route", "final_route", "agreement", "action", "ai_low_usd", "ai_high_usd", "reviewer_low_usd", "reviewer_high_usd", "reason", "rules_fired", "recommended_to", "sent_to"];
  const rows = log.map((e) =>
    [
      e.claimId,
      e.at,
      e.reviewer,
      e.recommendedRoute,
      e.finalRoute,
      e.agreement,
      e.action,
      e.aiRange?.lowUsd,
      e.aiRange?.highUsd,
      e.adjustedRange?.lowUsd,
      e.adjustedRange?.highUsd,
      e.reason,
      e.rulesFired.join(" "),
      e.recommendedTo.join(" "),
      e.sentTo.join(" "),
    ]
      .map(cell)
      .join(","),
  );
  return [head.join(","), ...rows].join("\n") + "\n";
}

function bandFor(high: number, s: Settings) {
  if (high < 1000) return "under_1000";
  if (high <= s.fastPathLimitUsd) return "1000_2500";
  return "2500_to_total_loss";
}

/** A disagreement as a labelled test case, in the same shape as eval/cases.csv. */
export function testCaseRow(e: ReviewLogEntry, settings: Settings): string {
  const cols = [
    `REVIEW_${e.claimId}`,
    e.photos.join(";"),
    "BLANK",
    "",
    "",
    e.finalRoute,
    e.finalRoute,
    e.finalRoute === "adjuster" ? "yes" : "no",
    "",
    e.vehicle.make ?? "CANT_TELL",
    e.vehicle.model ?? "CANT_TELL",
    e.vehicle.colour ?? "CANT_TELL",
    e.adjustedRange ? bandFor(e.adjustedRange.highUsd, settings) : "unsure",
    (
      e.reason ??
      (e.agreement === "changed_team"
        ? `Reviewer sent it to ${e.sentTo.map((t) => recipient(t).name).join(" and ")} instead of ${e.recommendedTo.map((t) => recipient(t).name).join(" and ")}`
        : `Reviewer chose ${ROUTE_LABELS[e.finalRoute]} over ${ROUTE_LABELS[e.recommendedRoute]}`)
    ).replace(/[,\n]/g, ";"),
    "Reviewer correction",
    "draft (reviewer)",
  ];
  return cols.join(",") + "\n";
}

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

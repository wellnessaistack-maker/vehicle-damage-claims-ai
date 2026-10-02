// Worklist state lives in the browser tab only. Refreshing the page clears it.

import type { ClaimContext } from "../claims/types.ts";
import type { Assessment } from "../pipeline.ts";
import { decide, type Decision } from "../policy/engine.ts";
import { ROUTE_LABELS, usd, type Route, type Settings } from "../policy/protocol.ts";
import type { CasePhoto } from "./intake.ts";

export type CaseStatus = "queued" | "processing" | "ready" | "done";

export interface ThreadEntry {
  id: string;
  kind: "note" | "comment" | "question" | "answer" | "action";
  author: string;
  text: string;
  at: string;
}

export type OutcomeAction = "approved" | "message_sent" | "assigned_adjuster" | "assigned_manual" | "route_changed" | "handed_off";

/** Who a claim can be sent to. Mock names; in production this is the carrier's own directory and queues. */
export interface Recipient {
  id: string;
  name: string;
  role: string;
  /** What the recipient is for, shown when choosing. */
  forWhat: string;
}

export const DIRECTORY: Recipient[] = [
  { id: "repair", name: "Repair and payment", role: "Claims payments", forWhat: "Pays the approved estimate and helps the customer book a repair" },
  { id: "estimating", name: "Estimating team", role: "Senior desk appraisers", forWhat: "Supplements from the shop, and estimates above a reviewer's approval limit" },
  { id: "field", name: "Field adjuster queue", role: "Field adjusters", forWhat: "Inspects the car in person" },
  { id: "total_loss", name: "Total loss unit", role: "Total loss specialists", forWhat: "Valuation and settlement when repair may cost more than the car is worth" },
  { id: "siu", name: "Special Investigations Unit", role: "SIU", forWhat: "Possible fraud, such as reused photos" },
  { id: "manual", name: "Manual triage queue", role: "Claims handlers", forWhat: "Today's process, for anything the tool couldn't assess" },
  { id: "dana", name: "Dana Kim", role: "Senior appraiser", forWhat: "Second opinion on a price or a borderline route" },
  { id: "marcus", name: "Marcus Hill", role: "Claims supervisor", forWhat: "Escalations, complaints and exceptions to the protocol" },
];

export const recipient = (id: string) => DIRECTORY.find((r) => r.id === id)!;

/**
 * Who the recommendation would send the claim to. On the adjuster route that depends on why:
 * the total loss unit when the repair may cost more than the car is worth, a field adjuster
 * otherwise, and SIU as well when fraud signs fired.
 */
export function recommendedTeams(d: Decision | null): string[] {
  if (!d) return ["manual"];
  if (d.route !== "adjuster") return [ROUTE_OWNER[d.route]];
  const teams = [d.reasons.some((r) => r.id === "C2") ? "total_loss" : "field"];
  if (d.siuReferral) teams.push("siu");
  return teams;
}

/** Where a claim goes next on each route when the reviewer accepts it. */
export const ROUTE_OWNER: Record<Route, string> = {
  photo_estimate: "repair",
  more_evidence: "estimating",
  adjuster: "field",
  manual_triage: "manual",
};

/** How the reviewer's decision compares with the recommendation. See review-log.ts. */
export type Agreement = "kept" | "adjusted_range" | "changed_route" | "changed_team";

export interface CaseOutcome {
  action: OutcomeAction;
  route: Route;
  /** The route the AI and rules recommended before the reviewer acted. */
  recommendedRoute?: Route;
  agreement?: Agreement;
  summary: string;
  reason?: string;
  adjustedRange?: { lowUsd: number; highUsd: number };
  /** Who holds the claim now. Empty while it waits on the customer. */
  sentTo?: string[];
  at: string;
}

export interface CaseItem {
  id: string;
  claim: ClaimContext;
  photos: CasePhoto[];
  status: CaseStatus;
  assessment?: Assessment;
  requestError?: string;
  thread: ThreadEntry[];
  outcome?: CaseOutcome;
  /** Set on demo cases, e.g. "B", so the demo can attach the customer's retake. */
  demoKey?: string;
  folder?: string | null;
  addedAt: string;
}

export const REVIEWER = { name: "Jordan Reyes", role: "Desk appraiser", initials: "JR" };

let counter = 0;
export const uid = (p = "id") => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
export const now = () => new Date().toISOString();

export function newClaimId(): string {
  return `NEW-${Math.floor(10000 + Math.random() * 89999)}`;
}

/** The decision under the current settings and claim details. Rules only, no AI call. */
export function currentDecision(c: CaseItem, settings: Settings): Decision | null {
  if (!c.assessment?.ok) return null;
  return decide(c.assessment.extraction, c.claim, c.assessment.photos, settings, { reviewerRange: c.outcome?.adjustedRange });
}

/** Plain-language "Now with ..." line for a finished claim. */
export function holderLine(o: CaseOutcome): string {
  if (o.action === "message_sent") return "Waiting on the customer";
  if (!o.sentTo?.length) return "";
  return `Now with ${o.sentTo.map((id) => recipient(id).name).join(" and ")}`;
}

/** For lists: a claim whose data can't be decided shows as manual triage instead of breaking the list. */
export function safeDecision(c: CaseItem, settings: Settings): Decision | null {
  try {
    return currentDecision(c, settings);
  } catch {
    return null;
  }
}

export function routeOf(c: CaseItem, settings: Settings): Route | null {
  if (!c.assessment) return null;
  if (!c.assessment.ok) return "manual_triage";
  return safeDecision(c, settings)?.route ?? "manual_triage";
}

export function vehicleLine(c: CaseItem, d: Decision | null): string {
  const v = d?.requiredOutputs.vehicle;
  if (v && (v.make.value || v.model.value)) {
    return [v.colour.value, v.make.value, v.model.value].filter(Boolean).join(" ");
  }
  const pv = c.claim.policyVehicle;
  const onPolicy = [pv.year, pv.make, pv.model].filter(Boolean).join(" ");
  return onPolicy ? `Policy: ${onPolicy}` : "Vehicle not identified";
}

export function firstReviewNote(d: Decision): string {
  const top = d.reasons.filter((r) => r.effect !== "review")[0];
  const e = d.requiredOutputs.estimate;
  const parts = [`${d.requiredOutputs.damageSummary}.`.replace(/\.\.$/, ".")];
  if (e.status === "provisional" && e.lowUsd !== null) parts.push(`Provisional estimate from what's visible: ${usd(e.lowUsd)} to ${usd(e.highUsd!)}, not reliable yet.`);
  else if (e.status !== "withheld" && e.lowUsd !== null)
    parts.push(`Rough repair estimate ${usd(e.lowUsd)} to ${usd(e.highUsd!)}${e.ceilingUsd && e.ceilingUsd > e.highUsd! ? `, up to ${usd(e.ceilingUsd)} if hidden damage is found` : ""}.`);
  parts.push(
    top
      ? `Recommended route: ${d.routeLabel}, because ${lowerFirst(top.reason ?? top.title)}`
      : `Recommended route: ${d.routeLabel}. No concerns found.`,
  );
  if (d.route !== "adjuster" && d.humanReview.required) parts.push(`Flagged for review: ${d.humanReview.reasons.map(lowerFirst).join(" ")}`);
  return parts.join(" ");
}

export function failureNote(c: CaseItem): string {
  if (!c.assessment || c.assessment.ok) return "";
  return `The AI assessment didn't complete (${c.assessment.failure.message}) This claim goes to manual triage, which is today's normal process. Nothing was guessed.`;
}

export function routeLabel(r: Route) {
  return ROUTE_LABELS[r];
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

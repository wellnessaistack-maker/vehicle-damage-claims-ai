// Runs the routing protocol. The AI's extraction goes in; a route, the reasons
// for it and the brief's required outputs come out. Pure and deterministic:
// the same inputs always give the same decision.

import type { ClaimContext, PhotoMetrics } from "../claims/types.ts";
import type { Extraction } from "../extraction/schema.ts";
import { citationsFor, policyChecks, type Citation, type PolicyCheck } from "./citations.ts";
import { buildCostRange, type CostDriver, type CostRange } from "./cost.ts";
import {
  PHOTO_QUALITY_THRESHOLDS,
  PROTOCOL_VERSION,
  ROUTE_LABELS,
  RULES,
  type Effect,
  type RetakeRequest,
  type Route,
  type RuleGroup,
  type Settings,
  usd,
} from "./protocol.ts";

export interface RuleResult {
  id: string;
  title: string;
  group: RuleGroup;
  tier: "locked" | "configurable";
  effect: Effect;
  fired: boolean;
  reason?: string;
  evidence?: string;
  /** What this rule checked and where each fact came from (fired rules only). */
  citations?: Citation[];
}

export interface OutputField {
  value: string | null;
  note?: string;
}

export interface EstimateOutput {
  /**
   * shown: usable on the photo path. reference_only: for the adjuster.
   * provisional: what the photos show so far; never used for routing or quoted to the customer.
   * withheld: nothing to price (no car or no damage).
   */
  status: "shown" | "reference_only" | "provisional" | "withheld";
  lowUsd: number | null;
  highUsd: number | null;
  drivers: CostDriver[];
  note: string;
  fastPathLimitUsd: number;
  totalLossLineUsd: number | null;
  accuracyNote: string;
  /** How the items were priced, and the AI's own total for the same items as a cross-check. */
  pricing?: CostRange["pricing"];
  aiItemsUsd?: CostRange["aiItemsUsd"];
  /** The most likely cost, and the cautious figure once possible extras are added. */
  likelyUsd?: number;
  ceilingUsd?: number;
  workings?: string[];
}

export interface ChecklistItem {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface Decision {
  protocolVersion: string;
  settings: Settings;
  route: Route;
  routeLabel: string;
  humanReview: { required: boolean; reasons: string[] };
  siuReferral: boolean;
  requiredOutputs: {
    vehicle: {
      make: OutputField;
      model: OutputField;
      colour: OutputField;
      yearRange: string | null;
      vehicleClass: string;
    };
    damageSummary: string;
    estimate: EstimateOutput;
  };
  /** Rules that fired, most serious first. These are the reasons shown to the reviewer. */
  reasons: RuleResult[];
  /** Every rule in the protocol, fired or not. */
  ruleResults: RuleResult[];
  retakes: RetakeRequest[];
  customerMessage: string | null;
  evidenceChecklist: ChecklistItem[];
  /** The policy and claim facts compared with the photos, whether or not a rule fired. */
  policyChecks: PolicyCheck[];
}

const EFFECT_ORDER: Record<Effect, number> = { adjuster: 0, more_evidence: 1, review: 2 };

export const ACCURACY_NOTE = "Accuracy not yet measured. We need your final paid costs to check it.";

export interface DecideOptions {
  /** A reviewer's corrected range. The rules re-run on it, so a correction can change the route. */
  reviewerRange?: { lowUsd: number; highUsd: number } | null;
}

export function decide(x: Extraction, claim: ClaimContext, photos: PhotoMetrics[], settings: Settings, opts: DecideOptions = {}): Decision {
  const aiCost = buildCostRange(x, settings, claim);
  const cost = aiCost && opts.reviewerRange ? reviewerCost(aiCost, opts.reviewerRange) : aiCost;
  const firedSoFar: string[] = [];
  const ruleResults: RuleResult[] = [];
  const retakes: RetakeRequest[] = [];
  let siuReferral = false;

  for (const rule of RULES) {
    const hit = rule.check({ x, claim, photos, settings, cost, firedSoFar });
    const effect = hit?.effect ?? rule.effect;
    ruleResults.push({
      id: rule.id,
      title: rule.title,
      group: rule.group,
      tier: rule.tier,
      effect,
      fired: !!hit,
      reason: hit?.reason,
      evidence: hit?.evidence || undefined,
      citations: hit ? citationsFor(rule, { x, claim, photos, settings, cost }) : undefined,
    });
    if (!hit) continue;
    firedSoFar.push(rule.id);
    if (hit.referToSiu) siuReferral = true;
    for (const r of hit.retakes ?? []) {
      if (!retakes.some((t) => t.view === r.view)) retakes.push(r);
    }
  }

  const fired = ruleResults.filter((r) => r.fired);
  const reasons = [...fired].sort((a, b) => EFFECT_ORDER[a.effect] - EFFECT_ORDER[b.effect]);

  // The most cautious route wins.
  let route: Route = "photo_estimate";
  if (fired.some((r) => r.effect === "adjuster")) route = "adjuster";
  else if (fired.some((r) => r.effect === "more_evidence")) route = "more_evidence";

  const reviewReasons = fired.filter((r) => r.effect === "review").map((r) => r.reason!);
  const humanReview =
    route === "adjuster"
      ? { required: true, reasons: ["An adjuster reviews every claim on this route.", ...reviewReasons] }
      : { required: reviewReasons.length > 0, reasons: reviewReasons };

  const evidenceFired = fired.some((r) => r.group === "evidence" && r.effect === "more_evidence") ||
    fired.some((r) => r.id === "E7");

  const estimate = estimateOutput(x, claim, settings, cost, route, fired.map((r) => r.id), evidenceFired);

  return {
    protocolVersion: PROTOCOL_VERSION,
    settings,
    route,
    routeLabel: ROUTE_LABELS[route],
    humanReview,
    siuReferral,
    requiredOutputs: {
      vehicle: vehicleOutputs(x, photos),
      damageSummary: damageSummary(x),
      estimate,
    },
    reasons,
    ruleResults,
    retakes: route === "more_evidence" ? retakes : [],
    customerMessage: route === "more_evidence" ? customerMessage(claim, retakes) : null,
    evidenceChecklist: checklist(x, photos, settings, fired.map((r) => r.id)),
    // Policy checks only mention the estimate when the reviewer can see one.
    policyChecks: policyChecks({ x, claim, photos, settings, cost: estimate.status === "shown" || estimate.status === "reference_only" ? cost : null }),
  };
}

function reviewerCost(ai: CostRange, r: { lowUsd: number; highUsd: number }): CostRange {
  return {
    ...ai,
    lowUsd: r.lowUsd,
    highUsd: r.highUsd,
    likelyUsd: Math.round((r.lowUsd + r.highUsd) / 2),
    // The reviewer's range is their judgment of the full cost, extras included.
    possibleExtraUsd: 0,
    ceilingUsd: r.highUsd,
    workings: [`The reviewer set the range to ${usd(r.lowUsd)} to ${usd(r.highUsd)}.`],
    drivers: [
      { label: "Reviewer's adjusted range", lowUsd: r.lowUsd, highUsd: r.highUsd, source: "rule_adjustment", note: `Replaces the estimated range of ${usd(ai.lowUsd)} to ${usd(ai.highUsd)}` },
    ],
  };
}

function vehicleOutputs(x: Extraction, photos: PhotoMetrics[]): Decision["requiredOutputs"]["vehicle"] {
  const v = x.vehicle;
  if (!v.vehicle_present) {
    const none = { value: null, note: "No vehicle in the photos" };
    return { make: none, model: none, colour: none, yearRange: null, vehicleClass: "none" };
  }
  const identified = v.identification_basis !== "not_identifiable";
  const idNote = identified ? `Identified from ${v.identification_basis === "badge_or_logo_visible" ? "a visible badge or logo" : "the body shape"}` : undefined;
  const unknownId = { value: null, note: "Not determinable from these photos" };

  const greyscale = photos.some((p) => p.greyscale) || x.evidence.photo_issues.includes("black_and_white");
  let colour: OutputField;
  if (greyscale) colour = { value: null, note: "Not determinable: black-and-white photo" };
  else if (!v.colour) colour = { value: null, note: "Not determinable from these photos" };
  else colour = { value: v.colour };

  return {
    make: identified && v.make ? { value: v.make, note: idNote } : unknownId,
    model: identified && v.model ? { value: v.model, note: idNote } : unknownId,
    colour,
    yearRange: identified ? v.year_range : null,
    vehicleClass: v.vehicle_class,
  };
}

function damageSummary(x: Extraction): string {
  if (!x.vehicle.vehicle_present) return "No vehicle visible, so no damage could be assessed.";
  if (x.damage.no_visible_damage || x.damage.items.length === 0) return "No damage visible in these photos.";
  return x.damage.summary;
}

function estimateOutput(
  x: Extraction,
  claim: ClaimContext,
  s: Settings,
  cost: ReturnType<typeof buildCostRange>,
  route: Route,
  firedIds: string[],
  evidenceFired: boolean,
): EstimateOutput {
  const base = {
    fastPathLimitUsd: s.fastPathLimitUsd,
    totalLossLineUsd: claim.vehicleValueUsd ? Math.round(claim.vehicleValueUsd * s.totalLossRatio) : null,
    accuracyNote: ACCURACY_NOTE,
  };
  const withheld = (note: string): EstimateOutput => ({ ...base, status: "withheld", lowUsd: null, highUsd: null, drivers: [], note });
  const priced = cost ? { pricing: cost.pricing, aiItemsUsd: cost.aiItemsUsd, likelyUsd: cost.likelyUsd, ceilingUsd: cost.ceilingUsd, workings: cost.workings } : {};

  if (!x.vehicle.vehicle_present) return withheld("No vehicle in the photos, so there's nothing to estimate.");
  if (x.damage.no_visible_damage || x.damage.items.length === 0) return withheld("No damage visible, so there's nothing to estimate.");
  if (!cost) return withheld("No damage items to price.");
  if (cost.ceilingUsd === 0) return withheld("The AI couldn't put a price on the damage in these photos.");
  // Still give a figure from what can be seen, clearly marked as provisional.
  const provisional = (note: string): EstimateOutput => ({ ...base, ...priced, status: "provisional", lowUsd: cost.lowUsd, highUsd: cost.highUsd, drivers: cost.drivers, note });
  if (firedIds.includes("P1")) return provisional("Not a normal road car, so our repair pricing doesn't really apply. A rough guide only; an adjuster will assess it.");
  if (firedIds.includes("I2")) return provisional("The photos seem to show different cars, so this may mix them up. A rough guide only.");
  if (evidenceFired) return provisional("Based only on what the photos show so far. It will change once we have the photos we asked for.");

  if (route === "adjuster") {
    return {
      ...base,
      ...priced,
      status: "reference_only",
      lowUsd: cost.lowUsd,
      highUsd: cost.highUsd,
      drivers: cost.drivers,
      note: "For the adjuster's reference only. Not used to settle the claim.",
    };
  }
  return {
    ...base,
    ...priced,
    status: "shown",
    lowUsd: cost.lowUsd,
    highUsd: cost.highUsd,
    drivers: cost.drivers,
    note: "Rough estimate, not a payable amount. The final estimate is written in the estimating system.",
  };
}

export function customerMessage(claim: ClaimContext, retakes: RetakeRequest[]): string {
  const onFile = claim.policyholder && !/not on file|unknown/i.test(claim.policyholder);
  const firstName = onFile ? claim.policyholder.split(" ")[0] : "there";
  const list = retakes.map((r, i) => `${i + 1}. ${r.view}, ${r.why}.`).join("\n");
  return [
    `Hi ${firstName},`,
    "",
    `Thanks for sending photos for claim ${claim.claimId}. To keep things moving, could you send us a few more?`,
    "",
    list,
    "",
    "A few tips: take them in daylight if you can, hold your phone steady, and keep the whole damaged area in the frame.",
    "",
    `Add them with this secure link: claims.example.com/upload/${claim.claimId}, or simply reply with the photos.`,
    "",
    "Thanks,",
    "Your claims team",
  ].join("\n");
}

function checklist(x: Extraction, photos: PhotoMetrics[], s: Settings, firedIds: string[]): ChecklistItem[] {
  const t = PHOTO_QUALITY_THRESHOLDS[s.photoQuality];
  const issues = x.evidence.photo_issues;
  const names = (ps: PhotoMetrics[]) => ps.map((p) => p.name).join(", ");
  // Same rule as the protocol: with several photos, one good photo is enough.
  const allFail = (bad: (p: PhotoMetrics) => boolean) => (photos.length > 0 && photos.every(bad) ? photos : []);
  const dark = allFail((p) => p.brightness < t.minBrightness);
  const soft = allFail((p) => p.sharpness < t.minSharpness);
  const small = allFail((p) => Math.min(p.width, p.height) < t.minShortEdgePx);
  const grey = allFail((p) => p.greyscale);

  return [
    { label: "Vehicle in the photos", ok: x.vehicle.vehicle_present },
    {
      label: "Car identified from a badge or body shape",
      ok: x.vehicle.vehicle_present && x.vehicle.identification_basis !== "not_identifiable",
      detail: x.vehicle.identification_evidence,
    },
    { label: "Whole damaged area in frame", ok: !firedIds.includes("E3") },
    { label: "Bright enough", ok: dark.length === 0 && !issues.includes("too_dark"), detail: dark.length ? names(dark) : undefined },
    { label: "Sharp enough", ok: soft.length === 0 && !issues.includes("blur"), detail: soft.length ? names(soft) : undefined },
    { label: "High enough resolution", ok: small.length === 0 && !issues.includes("low_resolution"), detail: small.length ? names(small) : undefined },
    { label: "No glare or obstruction over the damage", ok: !issues.includes("glare_over_damage") && !issues.includes("damage_obstructed") },
    { label: "Colour photo", ok: grey.length === 0 && !issues.includes("black_and_white"), detail: grey.length ? names(grey) : undefined },
    { label: "Only one car in the photo", ok: !x.vehicle.multiple_vehicles_in_frame },
    { label: "Not seen on a past claim", ok: !firedIds.includes("I1") },
  ];
}

// Routing protocol v0.1 (illustrative, draft for historical validation).
//
// This file is the single source of truth for routing. The engine runs these
// rules, and the "Routing protocol" panel in the app is rendered from them, so
// the document a claims expert signs off and the code that runs can't drift.
//
// Two tiers:
//   locked       safety, scope and evidence guardrails. Changing one means a new
//                protocol version, a test run against the labelled cases and
//                sign-off. Not editable in the app.
//   configurable business settings with safe bounds, editable by a protocol
//                owner. Every change is a new version that can be tested first.
//
// All dollar amounts and percentages are illustrative placeholders, not
// sourced figures. They get replaced with the carrier's own numbers.

import type { ClaimContext, PhotoMetrics } from "../claims/types.ts";
import type { Area, DamageItem, Extraction, RiskSign } from "../extraction/schema.ts";
import type { CostRange } from "./cost.ts";
import { totalLossLine } from "./states.ts";

export const PROTOCOL_VERSION = "0.1";

export type Route = "photo_estimate" | "more_evidence" | "adjuster" | "manual_triage";

export const ROUTE_LABELS: Record<Route, string> = {
  photo_estimate: "Ready to approve",
  more_evidence: "Request more evidence",
  adjuster: "Adjuster / total loss",
  manual_triage: "Not assessed: manual triage",
};

// ---------------------------------------------------------------------------
// Configurable settings
// ---------------------------------------------------------------------------

export type PhotoQualityLevel = "lenient" | "standard" | "strict";

export interface Settings {
  fastPathLimitUsd: number;
  totalLossRatio: number;
  wideRangeOverLimitPct: number;
  sensorZoneHandling: "review_flag" | "adjuster";
  photoQuality: PhotoQualityLevel;
  maxEvidenceRequests: number;
  hiddenDamageAllowancePct: number;
  partialViewWideningPct: number;
  sensorCalibrationLowUsd: number;
  sensorCalibrationHighUsd: number;
  pricing: "rate_card" | "ai";
  estimateBandPct: number;
  labourRateUsd: number;
  paintMaterialsUsd: number;
}

export const DEFAULT_SETTINGS: Settings = {
  fastPathLimitUsd: 2500,
  totalLossRatio: 0.6,
  wideRangeOverLimitPct: 50,
  sensorZoneHandling: "review_flag",
  photoQuality: "standard",
  maxEvidenceRequests: 2,
  hiddenDamageAllowancePct: 25,
  partialViewWideningPct: 50,
  sensorCalibrationLowUsd: 250,
  sensorCalibrationHighUsd: 600,
  pricing: "rate_card",
  estimateBandPct: 15,
  labourRateUsd: 65,
  paintMaterialsUsd: 45,
};

interface NumberSetting {
  key: keyof Settings;
  kind: "number";
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  unit: "usd" | "pct" | "ratio" | "count";
}

interface ChoiceSetting {
  key: keyof Settings;
  kind: "choice";
  label: string;
  help: string;
  options: { value: string; label: string }[];
}

export type SettingDef = NumberSetting | ChoiceSetting;

export const SETTING_DEFS: SettingDef[] = [
  {
    key: "pricing",
    kind: "choice",
    label: "How damage is priced",
    help: "Rate card: the AI describes each repair and the carrier's labour times and rates price it. AI only: the AI's own rough price for each item.",
    options: [
      { value: "rate_card", label: "Carrier rate card" },
      { value: "ai", label: "AI only" },
    ],
  },
  {
    key: "estimateBandPct",
    kind: "number",
    label: "Estimate range width",
    help: "How far either side of the most likely rate-card cost the range runs. In production, set from paid claims so an agreed share of final costs land inside it.",
    min: 5,
    max: 50,
    step: 5,
    unit: "pct",
  },
  {
    key: "labourRateUsd",
    kind: "number",
    label: "Base labour rate (per hour)",
    help: "The carrier's base body and paint labour rate. Each claim's ZIP code scales it for the local market (see the rate card below).",
    min: 30,
    max: 150,
    step: 1,
    unit: "usd",
  },
  {
    key: "paintMaterialsUsd",
    kind: "number",
    label: "Paint materials (per paint hour)",
    help: "Paint and materials allowance for each hour of refinish labour.",
    min: 10,
    max: 100,
    step: 1,
    unit: "usd",
  },
  {
    key: "fastPathLimitUsd",
    kind: "number",
    label: "Approval limit",
    help: "The most a desk appraiser can approve from photos. Under it, the reviewer approves the estimate; above it, the claim goes to an adjuster. Carriers set these authority limits by role; $2,500 is a placeholder for this carrier's number.",
    min: 500,
    max: 10000,
    step: 250,
    unit: "usd",
  },
  {
    key: "totalLossRatio",
    kind: "number",
    label: "Total-loss line (where the state sets none)",
    help: "Share of the vehicle's value at which a repair may not be worth doing. Used only where the claim's state has no rule of its own; see the state rules under the rate card.",
    min: 0.5,
    max: 1,
    step: 0.05,
    unit: "ratio",
  },
  {
    key: "wideRangeOverLimitPct",
    kind: "number",
    label: "Wide range past the limit",
    help: "If a range starts under the approval limit but its high end runs this far above it, send the claim to an adjuster instead of only flagging a price check.",
    min: 10,
    max: 200,
    step: 10,
    unit: "pct",
  },
  {
    key: "sensorZoneHandling",
    kind: "choice",
    label: "Damage in a sensor area",
    help: "Whether damage near cameras or radar only flags the claim for review, or sends it to an adjuster.",
    options: [
      { value: "review_flag", label: "Flag for review" },
      { value: "adjuster", label: "Send to adjuster" },
    ],
  },
  {
    key: "photoQuality",
    kind: "choice",
    label: "Photo quality bar",
    help: "How strict the automatic checks for dark, soft or low-resolution photos are.",
    options: [
      { value: "lenient", label: "Lenient" },
      { value: "standard", label: "Standard" },
      { value: "strict", label: "Strict" },
    ],
  },
  {
    key: "maxEvidenceRequests",
    kind: "number",
    label: "Photo requests before escalating",
    help: "After this many requests for more photos, send the claim to an adjuster instead of asking again.",
    min: 1,
    max: 3,
    step: 1,
    unit: "count",
  },
  {
    key: "hiddenDamageAllowancePct",
    kind: "number",
    label: "Hidden-damage allowance",
    help: "Added to the top of the range for damage that may be hidden behind the panels: moderate damage to the front or rear ends, or any severe damage.",
    min: 0,
    max: 50,
    step: 5,
    unit: "pct",
  },
  {
    key: "partialViewWideningPct",
    kind: "number",
    label: "Widening when damage is only partly visible",
    help: "Added to the top of the range when the photos don't show the whole damaged area.",
    min: 0,
    max: 100,
    step: 10,
    unit: "pct",
  },
  {
    key: "sensorCalibrationLowUsd",
    kind: "number",
    label: "Sensor recalibration, low",
    help: "Placeholder cost added when damage is in a sensor area.",
    min: 0,
    max: 2000,
    step: 50,
    unit: "usd",
  },
  {
    key: "sensorCalibrationHighUsd",
    kind: "number",
    label: "Sensor recalibration, high",
    help: "Placeholder cost added when damage is in a sensor area.",
    min: 0,
    max: 3000,
    step: 50,
    unit: "usd",
  },
];

/** Keep every setting inside its bounds, whatever the UI sends. */
export function clampSettings(input: Partial<Settings>): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const def of SETTING_DEFS) {
    const v = input[def.key];
    if (v === undefined) continue;
    if (def.kind === "number" && typeof v === "number" && Number.isFinite(v)) {
      (out[def.key] as number) = Math.min(def.max, Math.max(def.min, v));
    } else if (def.kind === "choice" && def.options.some((o) => o.value === v)) {
      (out[def.key] as string) = v as string;
    }
  }
  if (out.sensorCalibrationHighUsd < out.sensorCalibrationLowUsd) {
    out.sensorCalibrationHighUsd = out.sensorCalibrationLowUsd;
  }
  return out;
}

/**
 * Pixel thresholds for the photo quality bar. Calibrated on the demo and test
 * images only, so treat them as a starting point.
 */
export const PHOTO_QUALITY_THRESHOLDS: Record<
  PhotoQualityLevel,
  { minBrightness: number; minSharpness: number; minShortEdgePx: number; maxClippedHighlights: number }
> = {
  lenient: { minBrightness: 35, minSharpness: 100, minShortEdgePx: 360, maxClippedHighlights: 0.25 },
  standard: { minBrightness: 50, minSharpness: 200, minShortEdgePx: 480, maxClippedHighlights: 0.15 },
  strict: { minBrightness: 65, minSharpness: 400, minShortEdgePx: 720, maxClippedHighlights: 0.08 },
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type RuleGroup = "safety" | "scope" | "integrity" | "evidence" | "cost" | "review";
export type Effect = "adjuster" | "more_evidence" | "review";

export interface RetakeRequest {
  view: string;
  why: string;
}

export interface RuleContext {
  x: Extraction;
  claim: ClaimContext;
  photos: PhotoMetrics[];
  settings: Settings;
  cost: CostRange | null;
  /** IDs of rules that have already fired, in protocol order. */
  firedSoFar: string[];
}

export interface RuleHit {
  reason: string;
  evidence?: string;
  retakes?: RetakeRequest[];
  /** Overrides the rule's default effect, e.g. a setting that escalates instead of flagging. */
  effect?: Effect;
  referToSiu?: boolean;
}

/**
 * The facts a rule can check, and where each comes from. Every reason shown to
 * the reviewer cites these, so it's clear what was checked against what.
 */
export type SourceKey =
  | "policy.vehicle"
  | "policy.value"
  | "policy.powertrain"
  | "claim.injury"
  | "claim.drivable"
  | "claim.impact"
  | "claim.requests"
  | "ai.vehicle"
  | "ai.damage"
  | "ai.evidence"
  | "ai.risk"
  | "photo.checks"
  | "photo.pastClaims"
  | "estimate";

export interface Rule {
  id: string;
  group: RuleGroup;
  tier: "locked" | "configurable";
  effect: Effect;
  title: string;
  /** The rule in plain language, as it appears in the protocol document. */
  when: string;
  settings?: (keyof Settings)[];
  /** Where the facts this rule checks come from. Shown on every reason it gives. */
  uses: SourceKey[];
  check: (ctx: RuleContext) => RuleHit | null;
}

const hasSign = (x: Extraction, sign: RiskSign) => x.risk_signs.find((r) => r.sign === sign);
const evidenceFor = (x: Extraction, ...signs: RiskSign[]) =>
  x.risk_signs
    .filter((r) => signs.includes(r.sign))
    .map((r) => r.evidence)
    .join("; ");

const EVIDENCE_RULES = ["E1", "E2", "E3", "E4", "E5", "E6"];

/** Cost rules only apply when the photos are good enough to price from. */
const usableCost = ({ cost, firedSoFar }: RuleContext) =>
  firedSoFar.some((id) => EVIDENCE_RULES.includes(id)) ? null : cost;

export const RULES: Rule[] = [
  // --- Safety: always a person ------------------------------------------------
  {
    id: "S1",
    uses: ["claim.injury"],
    group: "safety",
    tier: "locked",
    effect: "adjuster",
    title: "Injury reported",
    when: "The customer reported an injury on the claim.",
    check: ({ claim }) => (claim.injuryReported ? { reason: "The customer reported an injury." } : null),
  },
  {
    id: "S2",
    uses: ["claim.drivable"],
    group: "safety",
    tier: "locked",
    effect: "adjuster",
    title: "Car can't be driven",
    when: "The customer said the car can't be driven.",
    check: ({ claim }) =>
      claim.vehicleDrivable === false ? { reason: "The customer said the car can't be driven." } : null,
  },
  {
    id: "S3",
    uses: ["ai.risk"],
    group: "safety",
    tier: "locked",
    effect: "adjuster",
    title: "Airbags deployed",
    when: "The photos show deployed airbags.",
    check: ({ x }) =>
      hasSign(x, "airbag_deployed")
        ? { reason: "Airbags have deployed.", evidence: evidenceFor(x, "airbag_deployed") }
        : null,
  },
  {
    id: "S4",
    uses: ["ai.risk", "ai.damage"],
    group: "safety",
    tier: "locked",
    effect: "adjuster",
    title: "Signs of structural damage",
    when: "The photos show a bent frame, pillar or roof, a displaced wheel, or severe damage to the underbody or pillars.",
    check: ({ x }) => {
      const signs = evidenceFor(x, "structural_deformation", "wheel_or_suspension_displaced");
      const severeStructural = x.damage.items.filter(
        (i) => (["pillar", "roof", "underbody"] as Area[]).includes(i.area) && i.severity === "severe",
      );
      if (!signs && severeStructural.length === 0) return null;
      return {
        reason: "There are signs of structural damage, which a photo estimate can't price safely.",
        evidence: [signs, ...severeStructural.map((i) => i.visible_evidence)].filter(Boolean).join("; "),
      };
    },
  },
  {
    id: "S5",
    uses: ["ai.risk"],
    group: "safety",
    tier: "locked",
    effect: "adjuster",
    title: "Fire or flood damage",
    when: "The photos show fire or flood damage.",
    check: ({ x }) =>
      hasSign(x, "fire_damage") || hasSign(x, "flood_damage")
        ? {
            reason: "Fire or flood damage usually hides more than a photo shows.",
            evidence: evidenceFor(x, "fire_damage", "flood_damage"),
          }
        : null,
  },
  {
    id: "S6",
    uses: ["policy.powertrain", "ai.vehicle", "ai.damage"],
    group: "safety",
    tier: "locked",
    effect: "adjuster",
    title: "Electric or hybrid car, damage near the battery",
    when: "The car is electric or hybrid and there is damage to the underbody, sills or rear, or any severe damage.",
    check: ({ x, claim }) => {
      const electrified =
        claim.policyVehicle.powertrain === "electric" ||
        claim.policyVehicle.powertrain === "hybrid" ||
        x.vehicle.powertrain_hint === "likely_ev_or_hybrid";
      if (!electrified) return null;
      const near = x.damage.items.filter(
        (i) =>
          (["underbody", "side_sill", "rear_bumper", "rear_quarter_panel", "boot_or_tailgate"] as Area[]).includes(
            i.area,
          ) || i.severity === "severe",
      );
      if (near.length === 0) return null;
      return {
        reason: "It's an electric or hybrid car with damage where the high-voltage battery may be affected.",
        evidence: near.map((i) => i.visible_evidence).join("; "),
      };
    },
  },

  // --- Scope: vehicles the photo path doesn't cover ----------------------------
  {
    id: "P1",
    uses: ["ai.vehicle"],
    group: "scope",
    tier: "locked",
    effect: "adjuster",
    title: "Not a road car",
    when: "The vehicle is a race car or another vehicle not normally covered by a personal auto policy.",
    check: ({ x }) =>
      x.vehicle.vehicle_present && (x.vehicle.vehicle_class === "race_or_non_road" || x.vehicle.vehicle_class === "other")
        ? {
            reason: "This isn't a normal road car, so it can't be approved from photos.",
            evidence: x.vehicle.identification_evidence,
          }
        : null,
  },
  {
    id: "P2",
    uses: ["ai.vehicle"],
    group: "scope",
    tier: "locked",
    effect: "adjuster",
    title: "Motorcycle or commercial vehicle",
    when: "The vehicle is a motorcycle or a commercial vehicle, which are outside the pilot segment.",
    check: ({ x }) =>
      x.vehicle.vehicle_class === "motorcycle" || x.vehicle.vehicle_class === "commercial"
        ? { reason: `A ${x.vehicle.vehicle_class === "motorcycle" ? "motorcycle" : "commercial vehicle"} is outside the pilot segment.` }
        : null,
  },

  // --- Integrity: possible reuse or tampering ----------------------------------
  {
    id: "I1",
    uses: ["photo.pastClaims"],
    group: "integrity",
    tier: "locked",
    effect: "adjuster",
    title: "Photo matches a past claim",
    when: "A photo is a close match (including a mirrored copy) of a photo on a past claim.",
    check: ({ photos }) => {
      const dup = photos.find((p) => p.nearDuplicateOf);
      return dup
        ? {
            reason: `A photo closely matches one already submitted on claim ${dup.nearDuplicateOf}.`,
            evidence: dup.name,
            referToSiu: true,
          }
        : null;
    },
  },
  {
    id: "I2",
    uses: ["ai.vehicle"],
    group: "integrity",
    tier: "locked",
    effect: "adjuster",
    title: "Photos show different cars",
    when: "The photos in one claim appear to show more than one vehicle.",
    check: ({ x, photos }) =>
      photos.length > 1 && !x.vehicle.same_vehicle_in_all_photos
        ? {
            reason: "The photos seem to show different cars. That could be a mix-up or something worth checking.",
            referToSiu: true,
          }
        : null,
  },
  {
    id: "I3",
    uses: ["ai.risk"],
    group: "integrity",
    tier: "locked",
    effect: "adjuster",
    title: "Photo of a screen or printout",
    when: "A photo looks like it was taken of a screen or a printed picture rather than the car.",
    check: ({ x }) =>
      hasSign(x, "photo_of_screen_or_print")
        ? {
            reason: "A photo looks like a picture of a screen or printout, not the car itself.",
            evidence: evidenceFor(x, "photo_of_screen_or_print"),
            referToSiu: true,
          }
        : null,
  },

  // --- Evidence: ask the customer for better photos ----------------------------
  {
    id: "E1",
    uses: ["ai.vehicle"],
    group: "evidence",
    tier: "locked",
    effect: "more_evidence",
    title: "No vehicle in the photos",
    when: "No vehicle can be seen in any photo.",
    check: ({ x }) =>
      !x.vehicle.vehicle_present
        ? {
            reason: "We couldn't see a vehicle in the photos.",
            retakes: [{ view: "A photo of your car showing the damaged area", why: "we couldn't see a car in the photos you sent" }],
          }
        : null,
  },
  {
    id: "E2",
    uses: ["ai.vehicle"],
    group: "evidence",
    tier: "locked",
    effect: "more_evidence",
    title: "Can't identify the car",
    when: "Make and model can't be confirmed from a badge or a clearly recognisable body shape. We don't guess.",
    check: ({ x }) =>
      x.vehicle.vehicle_present && x.vehicle.identification_basis === "not_identifiable"
        ? {
            reason: "We can't tell which car this is from the photos, so we haven't guessed.",
            evidence: x.vehicle.identification_evidence,
            retakes: [
              {
                view: `A photo of the whole ${sideLabel(x.damage.items)} of the car, including the brand badge`,
                why: "so we can confirm which car this is",
              },
            ],
          }
        : null,
  },
  {
    id: "E3",
    uses: ["ai.evidence"],
    group: "evidence",
    tier: "locked",
    effect: "more_evidence",
    title: "Damage isn't fully in frame",
    when: "The damage runs off the edge of the photo, or the photos are all close-ups.",
    check: ({ x }) => {
      const closeUp = x.evidence.view_type === "close_up" || x.evidence.view_type === "detail";
      if (!x.vehicle.vehicle_present || (!x.evidence.damage_extends_beyond_frame && !closeUp)) return null;
      return {
        reason: x.evidence.damage_extends_beyond_frame
          ? "The damage runs off the edge of the photo, so we can't see how far it goes."
          : "The photos are close-ups, so we can't see the full extent of the damage.",
        retakes: [
          {
            view: `A photo from about 3 metres back showing the whole ${sideLabel(x.damage.items)} of the car`,
            why: "so we can see the full size of the damage",
          },
        ],
      };
    },
  },
  {
    id: "E4",
    uses: ["photo.checks", "ai.evidence"],
    group: "evidence",
    tier: "locked",
    effect: "more_evidence",
    title: "Photo quality too poor",
    when: "The photos are too dark, too soft, too small or washed out (with several photos, only if none is good enough), or glare or an obstruction hides the damage. The pixel checks follow the photo quality bar setting.",
    settings: ["photoQuality"],
    check: ({ x, photos, settings }) => {
      const t = PHOTO_QUALITY_THRESHOLDS[settings.photoQuality];
      const problems: string[] = [];
      const retakes: RetakeRequest[] = [];
      // With several photos, a problem only counts if no photo is free of it.
      const allFail = (bad: (p: PhotoMetrics) => boolean) => (photos.length > 0 && photos.every(bad) ? photos : []);
      const dark = allFail((p) => p.brightness < t.minBrightness);
      const soft = allFail((p) => p.sharpness < t.minSharpness);
      const small = allFail((p) => Math.min(p.width, p.height) < t.minShortEdgePx);
      const washed = allFail((p) => p.clippedHighlights > t.maxClippedHighlights);
      const issues = x.evidence.photo_issues;
      if (dark.length || issues.includes("too_dark")) {
        problems.push(dark.length ? `too dark (${dark.map((p) => p.name).join(", ")})` : "too dark");
        retakes.push({ view: "The same photos in daylight or a well-lit spot", why: "the photo is too dark to see the damage clearly" });
      }
      if (soft.length || issues.includes("blur")) {
        problems.push(soft.length ? `blurry or very soft (${soft.map((p) => p.name).join(", ")})` : "blurry");
        retakes.push({ view: "The same photos, holding the phone steady", why: "the photo is blurry" });
      }
      if (small.length || issues.includes("low_resolution")) {
        problems.push("low resolution");
        retakes.push({ view: "The original photo from your phone, not a forwarded copy", why: "the copy we got is too small to see detail" });
      }
      if (washed.length) problems.push("washed out");
      if (issues.includes("glare_over_damage")) {
        problems.push("glare over the damage");
        retakes.push({ view: "A photo of the damage from a slightly different angle", why: "light is reflecting off the damaged area" });
      }
      if (issues.includes("damage_obstructed")) {
        problems.push("something is blocking the damage");
        retakes.push({ view: "A clear photo of the damaged area", why: "something is in the way of the damage" });
      }
      if (problems.length === 0) return null;
      return { reason: `Photo quality: ${problems.join(", ")}.`, retakes };
    },
  },
  {
    id: "E5",
    uses: ["ai.damage"],
    group: "evidence",
    tier: "locked",
    effect: "more_evidence",
    title: "No damage visible",
    when: "A vehicle is visible but no damage can be seen. We don't invent damage.",
    check: ({ x }) =>
      x.vehicle.vehicle_present && (x.damage.no_visible_damage || x.damage.items.length === 0)
        ? {
            reason: "We can see the car but no damage in these photos.",
            retakes: [{ view: "A close photo of where the car is damaged, plus one from further back", why: "we couldn't see any damage in the photos" }],
          }
        : null,
  },
  {
    id: "E6",
    uses: ["ai.vehicle"],
    group: "evidence",
    tier: "locked",
    effect: "more_evidence",
    title: "More than one car in the photo",
    when: "More than one vehicle is in frame, so it isn't clear which one is insured.",
    check: ({ x }) =>
      x.vehicle.multiple_vehicles_in_frame
        ? {
            reason: "There's more than one car in the photo, so it isn't clear which one is on the policy.",
            retakes: [{ view: "A photo of just your car", why: "there's more than one car in the photo" }],
          }
        : null,
  },
  {
    id: "E7",
    uses: ["claim.requests"],
    group: "evidence",
    tier: "configurable",
    effect: "adjuster",
    title: "Asked for photos too many times",
    when: "More photos are still needed, but we've already asked the customer the maximum number of times. A person takes over instead of asking again.",
    settings: ["maxEvidenceRequests"],
    check: ({ claim, settings, firedSoFar }) =>
      firedSoFar.some((id) => EVIDENCE_RULES.includes(id)) && claim.priorEvidenceRequests >= settings.maxEvidenceRequests
        ? {
            reason: `We've already asked this customer for photos ${claim.priorEvidenceRequests} time${claim.priorEvidenceRequests === 1 ? "" : "s"}. A person should take over rather than ask again.`,
          }
        : null,
  },

  // --- Cost: where the range sits against the limits ---------------------------
  {
    id: "C1",
    uses: ["estimate"],
    group: "cost",
    tier: "configurable",
    effect: "adjuster",
    title: "Estimate is over the approval limit",
    when: "The low end of the estimate is above the approval limit.",
    settings: ["fastPathLimitUsd"],
    check: (ctx) => {
      const cost = usableCost(ctx);
      const { settings } = ctx;
      return cost && cost.lowUsd > settings.fastPathLimitUsd
        ? {
            reason:
              cost.lowUsd === cost.highUsd
                ? `The estimate (${usd(cost.lowUsd)}) is above the ${usd(settings.fastPathLimitUsd)} approval limit.`
                : `Even the low end of the estimate (${usd(cost.lowUsd)}) is above the ${usd(settings.fastPathLimitUsd)} approval limit.`,
          }
        : null;
    },
  },
  {
    id: "C2",
    uses: ["estimate", "policy.value"],
    group: "cost",
    tier: "configurable",
    effect: "adjuster",
    title: "Repair may cost more than the car is worth",
    when: "The estimate, including possible hidden damage, reaches the total-loss line: the claim's state rule, or the carrier's setting where the state has none.",
    settings: ["totalLossRatio"],
    check: (ctx) => {
      const cost = usableCost(ctx);
      const { claim, settings } = ctx;
      const tl = totalLossLine(claim.vehicleValueUsd, claim.zip, settings);
      if (!cost || !tl) return null;
      return cost.ceilingUsd >= tl.lineUsd
        ? {
            reason: `${cost.ceilingUsd > cost.highUsd ? `With possible hidden damage the estimate could reach ${usd(cost.ceilingUsd)}, which` : `The high end of the estimate (${usd(cost.highUsd)})`} reaches the total-loss line of ${usd(tl.lineUsd)}: ${tl.basis}.`,
          }
        : null;
    },
  },
  {
    id: "C4",
    uses: ["estimate"],
    group: "cost",
    tier: "configurable",
    effect: "adjuster",
    title: "Estimate runs far past the approval limit",
    when: "The likely range starts under the approval limit, but with possible hidden damage it could run well above it (by the set percentage), so the claim is too uncertain to approve from photos.",
    settings: ["fastPathLimitUsd", "wideRangeOverLimitPct"],
    check: (ctx) => {
      const cost = usableCost(ctx);
      const { settings } = ctx;
      const ceiling = settings.fastPathLimitUsd * (1 + settings.wideRangeOverLimitPct / 100);
      return cost && cost.lowUsd <= settings.fastPathLimitUsd && cost.ceilingUsd > ceiling
        ? { reason: `The estimate could run up to ${usd(cost.ceilingUsd)}, more than ${settings.wideRangeOverLimitPct}% above the ${usd(settings.fastPathLimitUsd)} approval limit, so it's too uncertain to approve from photos.` }
        : null;
    },
  },
  {
    id: "C3",
    uses: ["estimate"],
    group: "cost",
    tier: "configurable",
    effect: "review",
    title: "Estimate straddles the approval limit",
    when: "The approval limit falls inside the estimate, counting possible hidden damage, so the claim can still be approved, but the price needs a closer check.",
    settings: ["fastPathLimitUsd"],
    check: (ctx) => {
      const cost = usableCost(ctx);
      const { settings } = ctx;
      // A very wide range is already sent to an adjuster by C4.
      if (ctx.firedSoFar.includes("C4")) return null;
      return cost && cost.lowUsd <= settings.fastPathLimitUsd && cost.ceilingUsd > settings.fastPathLimitUsd
        ? {
            reason:
              cost.highUsd > settings.fastPathLimitUsd
                ? `The ${usd(settings.fastPathLimitUsd)} approval limit falls inside the estimate range, so the price needs a check.`
                : `The likely range is under the ${usd(settings.fastPathLimitUsd)} limit, but possible hidden damage could take it to ${usd(cost.ceilingUsd)}, so the price needs a check.`,
          }
        : null;
    },
  },

  // --- Review flags: stays on its route, but a person checks -------------------
  {
    id: "R1",
    uses: ["ai.risk"],
    group: "review",
    tier: "configurable",
    effect: "review",
    title: "Damage in a sensor area",
    when: "Damage is near cameras or radar (bumpers, grille, windscreen, mirrors), so sensors may need recalibrating. By default this flags the claim; the protocol owner can make it send claims to an adjuster.",
    settings: ["sensorZoneHandling"],
    check: ({ x, settings }) =>
      hasSign(x, "sensor_zone_damage")
        ? {
            reason: "The damage is near driver-assistance sensors, which may need recalibrating after repair.",
            evidence: evidenceFor(x, "sensor_zone_damage"),
            effect: settings.sensorZoneHandling === "adjuster" ? "adjuster" : "review",
          }
        : null,
  },
  {
    id: "R2",
    uses: ["policy.vehicle", "ai.vehicle"],
    group: "review",
    tier: "locked",
    effect: "review",
    title: "Car doesn't match the policy",
    when: "The make or colour in the photos is clearly different from the vehicle on the policy.",
    check: ({ x, claim }) => {
      const pv = claim.policyVehicle;
      const mismatches: string[] = [];
      if (x.vehicle.identification_basis !== "not_identifiable" && x.vehicle.make && pv.make && !sameMake(x.vehicle.make, pv.make)) {
        mismatches.push(`make looks like ${x.vehicle.make}, policy says ${pv.make}`);
      }
      if (x.vehicle.colour && pv.colour && !sameColour(x.vehicle.colour, pv.colour)) {
        mismatches.push(`colour looks ${x.vehicle.colour.toLowerCase()}, policy says ${pv.colour.toLowerCase()}`);
      }
      return mismatches.length
        ? { reason: `The car in the photos doesn't match the policy: ${mismatches.join("; ")}.` }
        : null;
    },
  },
  {
    id: "R3",
    uses: ["claim.impact", "ai.damage"],
    group: "review",
    tier: "locked",
    effect: "review",
    title: "Damage doesn't match the customer's description",
    when: "The damage is on a different part of the car from where the customer said it was hit.",
    check: ({ x, claim }) => {
      if (claim.reportedImpactArea === "unknown" || x.damage.items.length === 0) return null;
      const zones = new Set(x.damage.items.flatMap(zonesFor));
      return zones.has(claim.reportedImpactArea)
        ? null
        : {
            reason: `The customer reported damage to the ${claim.reportedImpactArea}, but the photos show damage to the ${[...zones].join(" and ") || "car"}.`,
          };
    },
  },
  {
    id: "R4",
    uses: ["ai.risk"],
    group: "review",
    tier: "locked",
    effect: "review",
    title: "May include older damage",
    when: "Some damage looks old (rust, faded or weathered), so we shouldn't pay for it as new.",
    check: ({ x }) =>
      hasSign(x, "possible_prior_damage")
        ? {
            reason: "Some of the damage looks older than this incident.",
            evidence: evidenceFor(x, "possible_prior_damage"),
          }
        : null,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function usd(n: number) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function zonesFor(item: DamageItem): string[] {
  const zones: string[] = [];
  if (item.area.startsWith("front") || ["grille", "hood", "headlight", "windscreen"].includes(item.area)) zones.push("front");
  if (item.area.startsWith("rear") && item.area !== "rear_door") zones.push("rear");
  if (["boot_or_tailgate", "tail_light", "rear_glass"].includes(item.area)) zones.push("rear");
  if (item.side === "left" || item.side === "right") zones.push(item.side);
  if (item.side === "front" || item.side === "rear") zones.push(item.side);
  return zones;
}

function sideLabel(items: DamageItem[]): string {
  const sides = items.map((i) => i.side);
  const zones = items.flatMap(zonesFor);
  const lr = sides.find((s) => s === "left" || s === "right");
  const fr = zones.find((z) => z === "front" || z === "rear");
  if (lr && fr) return `${fr} ${lr} side`;
  if (lr) return `${lr} side`;
  if (fr) return fr;
  return "damaged side";
}

export function sameMake(a: string, b: string) {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  return n(a).includes(n(b)) || n(b).includes(n(a));
}

const COLOUR_FAMILIES = [
  ["silver", "grey", "gray", "charcoal", "gunmetal", "graphite"],
  ["white", "pearl", "ivory", "cream"],
  ["black", "onyx"],
  ["red", "maroon", "burgundy", "crimson"],
  ["blue", "navy"],
  ["green", "olive"],
  ["brown", "bronze", "tan", "beige", "gold"],
  ["orange"],
  ["yellow"],
];

export function sameColour(a: string, b: string) {
  const fam = (s: string) => {
    const l = s.toLowerCase();
    return COLOUR_FAMILIES.findIndex((f) => f.some((c) => l.includes(c)));
  };
  const fa = fam(a);
  const fb = fam(b);
  if (fa === -1 || fb === -1) return true; // can't tell, don't flag
  return fa === fb;
}

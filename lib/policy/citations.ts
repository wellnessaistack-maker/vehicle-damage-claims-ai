// Traceability: where each fact behind a decision comes from.
//
// Every reason shown to a reviewer cites the facts it checked (policy record,
// claim form, what the AI saw in the photo, the code's photo checks) and the
// protocol rule and settings that applied. The policy checks list shows the
// comparison between the policy and the photos even when nothing fired.
//
// This tool compares facts. It does not decide coverage or deductibles.

import type { ClaimContext, PhotoMetrics } from "../claims/types.ts";
import type { Extraction } from "../extraction/schema.ts";
import type { CostRange } from "./cost.ts";
import { areaLabel } from "./ratecard.ts";
import { totalLossLine } from "./states.ts";
import { PROTOCOL_VERSION, SETTING_DEFS, sameColour, sameMake, usd, zonesFor, type Effect, type Rule, type Settings, type SourceKey } from "./protocol.ts";

export type SourceKind = "Policy record" | "Claim form" | "Photo (AI)" | "Photo check (code)" | "Past claims" | "Estimate" | "Protocol";

export interface Citation {
  source: SourceKind;
  text: string;
}

export interface PolicyCheck {
  label: string;
  onFile: string;
  observed: string;
  status: "match" | "mismatch" | "not_compared" | "info";
  note?: string;
}

interface Ctx {
  x: Extraction;
  claim: ClaimContext;
  photos: PhotoMetrics[];
  settings: Settings;
  cost: CostRange | null;
}

const THEN: Record<Effect, string> = {
  adjuster: "send it to an adjuster",
  more_evidence: "ask the customer for more photos",
  review: "keep the route, and flag it for a person to check",
};

/** The rule itself, in words: "Rule S2, locked. When: ... Then: send it to an adjuster." */
export function ruleStatement(rule: Rule, effect: Effect = rule.effect): string {
  const who = rule.tier === "locked" ? "locked" : "set by the carrier";
  return `Rule ${rule.id}, ${who} (routing protocol v${PROTOCOL_VERSION}). When: ${rule.when} Then: ${THEN[effect]}.`;
}

export function citationsFor(rule: Rule, ctx: Ctx, effect: Effect = rule.effect): Citation[] {
  const out: Citation[] = [{ source: "Protocol", text: ruleStatement(rule, effect) }, ...rule.uses.map((k) => cite(k, ctx))];
  for (const key of rule.settings ?? []) {
    const def = SETTING_DEFS.find((d) => d.key === key)!;
    out.push({ source: "Protocol", text: `Setting "${def.label}": ${formatSetting(key, ctx.settings)}` });
  }
  return out;
}

function cite(key: SourceKey, { x, claim, photos, cost }: Ctx): Citation {
  const v = x.vehicle;
  const pv = claim.policyVehicle;
  switch (key) {
    case "policy.vehicle":
      return { source: "Policy record", text: `Insured vehicle: ${policyVehicle(claim)}` };
    case "policy.value":
      return { source: "Policy record", text: `Vehicle value: ${claim.vehicleValueUsd ? usd(claim.vehicleValueUsd) : "not on file"} (mock)` };
    case "policy.powertrain":
      return { source: "Policy record", text: `Powertrain: ${pv.powertrain === "unknown" ? "not on file" : pv.powertrain}` };
    case "claim.injury":
      return { source: "Claim form", text: `Injury reported: ${claim.injuryReported ? "yes" : "no"}` };
    case "claim.drivable":
      return { source: "Claim form", text: `Car can be driven: ${claim.vehicleDrivable === null ? "not said" : claim.vehicleDrivable ? "yes" : "no"}` };
    case "claim.impact":
      return { source: "Claim form", text: `Reported point of impact: ${claim.reportedImpactArea === "unknown" ? "not given" : claim.reportedImpactArea}` };
    case "claim.requests":
      return { source: "Claim form", text: `Photo requests already sent: ${claim.priorEvidenceRequests}` };
    case "ai.vehicle":
      return {
        source: "Photo (AI)",
        text: !v.vehicle_present
          ? "No vehicle seen"
          : `${[v.colour, v.make, v.model].filter(Boolean).join(" ") || "Vehicle not identified"} (${v.vehicle_class.replace(/_/g, " ")}; ${v.identification_basis.replace(/_/g, " ")})`,
      };
    case "ai.damage":
      return {
        source: "Photo (AI)",
        text: x.damage.items.length ? x.damage.items.map((i) => `${i.side === "unknown" ? "" : i.side + " "}${areaLabel(i.area)} (${i.severity})`).join(", ") : "No damage seen",
      };
    case "ai.evidence":
      return {
        source: "Photo (AI)",
        text: `Best view: ${x.evidence.view_type.replace(/_/g, " ")}; damage ${x.evidence.damage_extends_beyond_frame ? "runs out of frame" : "fully in frame"}${x.evidence.photo_issues.length ? `; issues: ${x.evidence.photo_issues.join(", ").replace(/_/g, " ")}` : ""}`,
      };
    case "ai.risk":
      return { source: "Photo (AI)", text: x.risk_signs.length ? `Risk signs: ${x.risk_signs.map((r) => r.sign.replace(/_/g, " ")).join(", ")}` : "No risk signs seen" };
    case "photo.checks":
      return {
        source: "Photo check (code)",
        text: photos.map((p, i) => `Photo ${i + 1}: brightness ${Math.round(p.brightness)}, sharpness ${Math.round(p.sharpness)}, ${p.width} x ${p.height}`).join("; ") || "No photos",
      };
    case "photo.pastClaims": {
      const hit = photos.find((p) => p.nearDuplicateOf);
      return { source: "Past claims", text: hit ? `Photo ${photos.indexOf(hit) + 1} matches a photo on claim ${hit.nearDuplicateOf}` : "No match against past-claim photos" };
    }
    case "estimate":
      return { source: "Estimate", text: cost ? `${cost.lowUsd === cost.highUsd ? usd(cost.highUsd) : `Range ${usd(cost.lowUsd)} to ${usd(cost.highUsd)}`}${cost.ceilingUsd > cost.highUsd ? `, up to ${usd(cost.ceilingUsd)} with possible hidden damage` : ""} (${cost.drivers.some((d) => d.label === "Reviewer's amount") ? "reviewer's amount" : cost.pricing.source === "rate_card" ? `estimating guide at ${usd(cost.pricing.labourRateUsd)}/h` : "AI item prices"})` : "No estimate" };
  }
}

export function policyChecks({ x, claim, settings, cost }: Ctx): PolicyCheck[] {
  const v = x.vehicle;
  const pv = claim.policyVehicle;
  const identified = v.vehicle_present && v.identification_basis !== "not_identifiable";
  const checks: PolicyCheck[] = [];

  const seenVehicle = identified ? [v.make, v.model].filter(Boolean).join(" ") : "Not identified from the photos";
  const policyMake = pv.make ? [pv.year, pv.make, pv.model].filter(Boolean).join(" ") : "Not on file";
  checks.push({
    label: "Insured vehicle",
    onFile: policyMake,
    observed: seenVehicle,
    status: !pv.make || !identified || !v.make ? "not_compared" : sameMake(v.make, pv.make) ? "match" : "mismatch",
    note: !identified ? "Can't compare until a photo shows the badge or a clearly recognisable body shape." : undefined,
  });

  checks.push({
    label: "Color",
    onFile: pv.colour ?? "Not on file",
    observed: v.colour ?? "Not determinable",
    status: !pv.colour || !v.colour ? "not_compared" : sameColour(v.colour, pv.colour) ? "match" : "mismatch",
  });

  const zones = [...new Set(x.damage.items.flatMap(zonesFor))];
  checks.push({
    label: "Point of impact",
    onFile: claim.reportedImpactArea === "unknown" ? "Not given on the claim form" : `${cap(claim.reportedImpactArea)} (claim form)`,
    observed: zones.length ? `Damage on the ${zones.join(" and ")}` : "No damage located",
    status: claim.reportedImpactArea === "unknown" || zones.length === 0 ? "not_compared" : zones.includes(claim.reportedImpactArea) ? "match" : "mismatch",
  });

  const tl = totalLossLine(claim.vehicleValueUsd, claim.zip, settings);
  checks.push({
    label: "Vehicle value",
    onFile: claim.vehicleValueUsd ? `${usd(claim.vehicleValueUsd)} (mock)` : "Not on file",
    observed: tl ? `Total-loss line ${usd(tl.lineUsd)}: ${tl.basis}${cost ? `; estimate could reach ${usd(cost.ceilingUsd)}` : ""}` : "No total-loss check possible",
    status: "info",
  });

  const electrified = pv.powertrain === "electric" || pv.powertrain === "hybrid" || v.powertrain_hint === "likely_ev_or_hybrid";
  checks.push({
    label: "Powertrain",
    onFile: pv.powertrain === "unknown" ? "Not on file" : cap(pv.powertrain),
    observed: electrified ? "Battery-damage rule applies" : "Battery-damage rule doesn't apply",
    status: "info",
  });

  checks.push({
    label: "Coverage and deductible",
    onFile: "Not checked by this tool",
    observed: "Confirmed by the adjuster in the claims system",
    status: "info",
    note: "This tool compares facts to route the claim. It never decides what the policy covers or pays.",
  });

  return checks;
}

function policyVehicle(claim: ClaimContext) {
  const pv = claim.policyVehicle;
  const s = [pv.year, pv.colour, pv.make, pv.model].filter(Boolean).join(" ");
  return s || "not on file";
}

function formatSetting(key: keyof Settings, s: Settings): string {
  const def = SETTING_DEFS.find((d) => d.key === key)!;
  const v = s[key];
  if (def.kind === "choice") return def.options.find((o) => o.value === v)?.label ?? String(v);
  if (def.unit === "usd") return usd(v as number);
  if (def.unit === "pct") return `${v}%`;
  if (def.unit === "ratio") return `${Math.round((v as number) * 100)}% of vehicle value`;
  return String(v);
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

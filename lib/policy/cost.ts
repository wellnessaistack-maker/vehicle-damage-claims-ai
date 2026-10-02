// The rough repair-cost range.
//
// The AI describes each damaged part: where, how badly, and whether it would be
// repaired, replaced or refinished. By default the carrier's rate card prices
// that description (ratecard.ts), because the AI is much more consistent about
// what is damaged than about what it costs. The AI's own price for each item is
// kept as a cross-check, and is used for any part the rate card has no line for.
// Code adds the items up into a likely range for what the photos show. What the
// photos can't show (damage behind the panels, parts flagged for inspection, a
// partial view) is listed separately as possible extras, so the likely range stays
// tight and the uncertainty is explicit. The routing rules use the cautious figure:
// the high end plus every possible extra.
// Every hour, rate and adjustment is an illustrative placeholder set in the protocol.
//
// The range is never a payable amount.

import type { Area, DamageItem, Extraction } from "../extraction/schema.ts";
import { usd, type Settings } from "./protocol.ts";
import type { ClaimContext } from "../claims/types.ts";
import { HIGH_VOLTAGE_HOURS, marketFor, partsTierFor, priceItem, type PartsTier, type PriceOption } from "./ratecard.ts";

export interface CostDriver {
  label: string;
  lowUsd: number;
  highUsd: number;
  source: "rate_card" | "ai_estimate" | "rule_adjustment";
  note?: string;
  /** "possible": not in the likely range; could be added if hidden damage is confirmed. */
  kind?: "visible" | "possible";
  /** What in the photo shows this, in the AI's words. */
  evidence?: string;
  /** The working: "4.5 h body x $65 + 3.5 h paint x $110 = $678". */
  math?: string;
  /** Repair against replace, when both are possible. */
  options?: PriceOption[];
  /** Why the chosen option, when it isn't simply the AI's call. */
  decision?: string;
  /** A damaged part the AI described from the photos, as opposed to a rule or claim adjustment. */
  fromPhotos?: boolean;
}

export interface CostRange {
  /** The likely range for the damage the photos show. */
  lowUsd: number;
  highUsd: number;
  likelyUsd: number;
  /** What hidden or unconfirmed damage could add on top of the likely range. */
  possibleExtraUsd: number;
  /** The high end plus every possible extra: the cautious figure the routing rules use. */
  ceilingUsd: number;
  drivers: CostDriver[];
  /** How the items were priced, for the reviewer. */
  pricing: {
    source: "rate_card" | "ai";
    tier: PartsTier;
    /** Why that parts tier: "BMW parts", "car worth under $10,000". */
    tierWhy: string;
    /** The labour rate actually used: the base rate scaled by the market. */
    labourRateUsd: number;
    baseLabourRateUsd: number;
    market: { name: string; factor: number; zip: string | null };
    bandPct: number;
    paintMaterialsUsd: number;
    /** The car on the policy, as it sets the parts tier: "2019 Toyota RAV4". */
    claimVehicle: string | null;
    vehicleValueUsd: number | null;
    /** Where the make used for the parts tier came from. */
    makeFrom: "claim" | "photos" | null;
    /** Where an electric or hybrid powertrain came from, if the car is one. */
    electrifiedFrom: "claim" | "photos" | null;
  };
  /** The AI's own total for the same items, before extras. A cross-check on the rate card. */
  aiItemsUsd: { lowUsd: number; highUsd: number };
  /** How the range and the cautious figure were worked out, step by step. */
  workings: string[];
}

const ROUND_TO = 50;
const ROAD_CARS: string[] = ["passenger_car", "suv", "pickup", "van"];

const HIDDEN_DAMAGE_AREAS: Area[] = ["front_bumper", "grille", "hood", "headlight", "front_fender", "rear_bumper", "boot_or_tailgate", "tail_light", "rear_quarter_panel", "wheel_or_tyre", "underbody"];

/** The claim facts that change the price: where the car is repaired, what it is, and what it's worth. */
export type PricingClaim = Partial<Pick<ClaimContext, "zip" | "vehicleValueUsd" | "policyVehicle">>;

export function buildCostRange(x: Extraction, s: Settings, claim: PricingClaim = {}): CostRange | null {
  if (!x.vehicle.vehicle_present || x.damage.items.length === 0) return null;

  // Where: the claim's ZIP picks a labour market. What: the make and value set the parts tier.
  const market = marketFor(claim.zip);
  const labourRateUsd = Math.round(s.labourRateUsd * market.factor);
  const { tier, why: tierWhy } = partsTierFor(claim.vehicleValueUsd, claim.policyVehicle?.make ?? x.vehicle.make);
  const makeFrom = claim.policyVehicle?.make ? "claim" : x.vehicle.make ? "photos" : null;
  const pv = claim.policyVehicle;
  const claimVehicle = pv ? [pv.year, pv.make, pv.model].filter(Boolean).join(" ") || null : null;
  const rates = { labourRateUsd, paintMaterialsUsd: s.paintMaterialsUsd, tier };
  // The rate card covers ordinary road cars. Anything else keeps the AI's own price.
  const onCard = s.pricing === "rate_card" && ROAD_CARS.includes(x.vehicle.vehicle_class);
  let aiLow = 0;
  let aiHigh = 0;
  const visible: CostDriver[] = [];
  const possible: CostDriver[] = [];

  for (const item of x.damage.items) {
    const [low, high] = saneRange(item.cost_low_usd, item.cost_high_usd);
    aiLow += low;
    aiHigh += high;
    const card = onCard ? priceItem(item, rates) : null;
    if (card) {
      visible.push({
        label: describeItem(item),
        lowUsd: card.likelyUsd,
        highUsd: card.likelyUsd,
        source: "rate_card",
        note: card.breakdown,
        kind: "visible",
        evidence: item.visible_evidence,
        math: card.math,
        options: card.options.length > 1 ? card.options : undefined,
        decision: card.decision,
        fromPhotos: true,
      });
      if (card.possibleExtraUsd > 0) {
        possible.push({
          label: `If the ${partName(item)} needs replacing`,
          lowUsd: 0,
          highUsd: card.possibleExtraUsd,
          source: "rate_card",
          note: "The AI flagged it for inspection: damage behind it can't be seen yet",
          kind: "possible",
          math: card.possibleExtraMath,
        });
      }
    } else {
      visible.push({
        label: describeItem(item),
        lowUsd: low,
        highUsd: high,
        source: "ai_estimate",
        note: s.pricing !== "rate_card" ? undefined : onCard ? "Not on the rate card, so the AI's own price" : "Rate card covers road cars only, so the AI's own price",
        kind: "visible",
        evidence: item.visible_evidence,
        math: `The AI's own estimate: ${usd(low)} to ${usd(high)}`,
        fromPhotos: true,
      });
    }
  }

  // Electric and hybrid cars need the high-voltage system made safe before body work.
  const electrifiedOnClaim = claim.policyVehicle?.powertrain === "electric" || claim.policyVehicle?.powertrain === "hybrid";
  const electrified = electrifiedOnClaim || x.vehicle.powertrain_hint === "likely_ev_or_hybrid";
  if (onCard && electrified) {
    const hv = HIGH_VOLTAGE_HOURS * labourRateUsd;
    visible.push({
      label: "High-voltage safety procedure",
      lowUsd: hv,
      highUsd: hv,
      source: "rate_card",
      note: "Electric or hybrid car",
      kind: "visible",
      math: `${HIGH_VOLTAGE_HOURS} h x $${labourRateUsd} = $${Math.round(hv)}`,
    });
  }

  // The likely range for what the photos show. Rate-card prices are one figure per job,
  // so the range is a set band either side of it; the AI's own prices come as ranges.
  const visLow = sum(visible.map((d) => d.lowUsd));
  const visHigh = sum(visible.map((d) => d.highUsd));
  const allCard = visible.every((d) => d.source === "rate_card");
  const band = s.estimateBandPct / 100;
  const likely = (visLow + visHigh) / 2;
  const low = allCard ? likely * (1 - band) : visLow;
  const high = allCard ? likely * (1 + band) : visHigh;
  const base = allCard ? likely : visHigh;

  if (x.risk_signs.some((r) => r.sign === "sensor_zone_damage") && s.sensorCalibrationHighUsd > 0) {
    possible.push({
      label: "Sensor recalibration",
      lowUsd: s.sensorCalibrationLowUsd,
      highUsd: s.sensorCalibrationHighUsd,
      source: "rule_adjustment",
      note: "Damage is near driver-assistance sensors. Placeholder amount",
      kind: "possible",
      math: `Protocol setting: ${usd(s.sensorCalibrationLowUsd)} to ${usd(s.sensorCalibrationHighUsd)}`,
    });
  }

  // Damage behind the panels is likely where brackets, sensors and crash
  // structure sit (the front and rear ends), or when anything is severe. A dent
  // in a door skin doesn't get the allowance.
  const hiddenLikely = x.damage.items.some(
    (i) => i.severity === "severe" || (i.severity === "moderate" && HIDDEN_DAMAGE_AREAS.includes(i.area)),
  );
  if (hiddenLikely && s.hiddenDamageAllowancePct > 0) {
    possible.push({
      label: "Damage behind the panels",
      lowUsd: 0,
      highUsd: base * (s.hiddenDamageAllowancePct / 100),
      source: "rule_adjustment",
      note: `Front or rear impact, or severe damage: up to ${s.hiddenDamageAllowancePct}% more. Placeholder`,
      kind: "possible",
      math: `${s.hiddenDamageAllowancePct}% x ${usd(base)} = ${usd(base * (s.hiddenDamageAllowancePct / 100))}`,
    });
  }

  const partial =
    x.evidence.damage_extends_beyond_frame || x.evidence.view_type === "close_up" || x.evidence.view_type === "detail";
  if (partial && s.partialViewWideningPct > 0) {
    possible.push({
      label: "Damage only partly visible",
      lowUsd: 0,
      highUsd: base * (s.partialViewWideningPct / 100),
      source: "rule_adjustment",
      note: `The photos don't show all of it: up to ${s.partialViewWideningPct}% more. Placeholder`,
      kind: "possible",
      math: `${s.partialViewWideningPct}% x ${usd(base)} = ${usd(base * (s.partialViewWideningPct / 100))}`,
    });
  }

  const extra = sum(possible.map((d) => d.highUsd));
  // Line amounts stay exact so they match the math shown; only the range is rounded out.
  const r10 = (n: number) => Math.round(n);
  const lowR = roundDown(Math.max(0, low));
  const highR = roundUp(Math.max(low, high));
  const ceilR = roundUp(highR + extra);
  const rateLine =
    market.factor === 1
      ? `Labour: ${usd(labourRateUsd)}/h (${market.name.toLowerCase() === "national average" ? "national average" : `${market.name} market`}). Parts: ${tier} (${tierWhy}).`
      : `Labour: ${usd(s.labourRateUsd)} base x ${market.factor} for the ${market.name} market = ${usd(labourRateUsd)}/h. Parts: ${tier} (${tierWhy}).`;
  const workings = allCard
    ? [
        rateLine,
        `Repairs add up to ${usd(likely)}.`,
        `Range: ${usd(likely)} less and plus ${s.estimateBandPct}% is ${usd(low)} to ${usd(high)}, rounded out to ${usd(lowR)} to ${usd(highR)}.`,
      ]
    : [`The AI's own prices add up to ${usd(visLow)} to ${usd(visHigh)}, rounded out to ${usd(lowR)} to ${usd(highR)}.`];
  if (extra > 0) workings.push(`If every possible extra turns up: ${usd(highR)} + ${usd(extra)} = ${usd(ceilR)}. The routing rules check this figure against the limits.`);
  return {
    lowUsd: lowR,
    highUsd: highR,
    likelyUsd: r10(likely),
    possibleExtraUsd: r10(extra),
    ceilingUsd: ceilR,
    workings,
    drivers: [...visible, ...possible].map((d) => ({ ...d, lowUsd: r10(d.lowUsd), highUsd: r10(d.highUsd) })),
    pricing: {
      source: onCard ? "rate_card" : "ai",
      tier,
      tierWhy,
      labourRateUsd,
      baseLabourRateUsd: s.labourRateUsd,
      market: { name: market.name, factor: market.factor, zip: claim.zip?.trim() || null },
      bandPct: s.estimateBandPct,
      paintMaterialsUsd: s.paintMaterialsUsd,
      claimVehicle,
      vehicleValueUsd: claim.vehicleValueUsd ?? null,
      makeFrom,
      electrifiedFrom: electrifiedOnClaim ? "claim" : electrified ? "photos" : null,
    },
    aiItemsUsd: { lowUsd: Math.round(aiLow), highUsd: Math.round(aiHigh) },
  };
}

const partName = (item: DamageItem) => `${item.side === "left" || item.side === "right" ? `${item.side} ` : ""}${item.area.replace(/_/g, " ")}`;

export function describeItem(item: DamageItem): string {
  const side = item.side === "unknown" || item.side === "centre" ? "" : `${item.side} `;
  const area = item.area.replace(/_/g, " ");
  const type = item.damage_type.replace(/_/g, " ");
  const repair = item.likely_repair.replace(/_/g, " ");
  return `${capitalise(side + area)}: ${item.severity} ${type}, ${repair}`;
}

function saneRange(a: number, b: number): [number, number] {
  const lo = Number.isFinite(a) ? Math.max(0, a) : 0;
  const hi = Number.isFinite(b) ? Math.max(0, b) : 0;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const roundDown = (n: number) => Math.floor(n / ROUND_TO) * ROUND_TO;
const roundUp = (n: number) => Math.ceil(n / ROUND_TO) * ROUND_TO;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

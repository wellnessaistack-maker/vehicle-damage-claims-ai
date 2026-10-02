// The carrier's rate card: how a described repair becomes a price.
//
// The AI is consistent about WHAT is damaged (which part, how badly, repair or
// replace) but much less consistent about what that costs. So the price comes
// from here instead: a labor time per part and repair type, priced at the
// carrier's own labor and materials rates, with a parts adjustment for the
// vehicle's value. Like a real labor guide, each job has one time, not a range;
// the uncertainty is handled separately (cost.ts).
//
// Every hour and dollar in this table is an ILLUSTRATIVE placeholder. In
// production the hours come from an estimating platform's labor times (CCC,
// Mitchell or Audatex) and the rates and parts pricing from the carrier, then
// the whole card is calibrated against the carrier's paid claims.

import type { Area, DamageItem } from "../extraction/schema.ts";

export interface PartCard {
  /** Body labor to repair the part, for moderate damage. */
  repairHours?: number;
  /** Body labor to remove and replace the part. */
  replaceHours?: number;
  /** Refinish labor, including blending into the panels next to it. */
  paintHours?: number;
  /** The replacement part, for a typical mid-range car. */
  partUsd?: number;
}

export const RATE_CARD: Partial<Record<Area, PartCard>> = {
  front_bumper: { repairHours: 2.5, replaceHours: 2, paintHours: 3, partUsd: 450 },
  rear_bumper: { repairHours: 2.5, replaceHours: 2, paintHours: 3, partUsd: 450 },
  grille: { replaceHours: 0.8, partUsd: 280 },
  hood: { repairHours: 3, replaceHours: 1.2, paintHours: 3.5, partUsd: 550 },
  headlight: { replaceHours: 0.8, partUsd: 450 },
  tail_light: { replaceHours: 0.5, partUsd: 250 },
  front_fender: { repairHours: 3, replaceHours: 2, paintHours: 3, partUsd: 330 },
  front_door: { repairHours: 3.5, replaceHours: 3.8, paintHours: 3.5, partUsd: 800 },
  rear_door: { repairHours: 3.5, replaceHours: 3.8, paintHours: 3.5, partUsd: 800 },
  side_mirror: { replaceHours: 0.8, paintHours: 0.8, partUsd: 300 },
  side_sill: { repairHours: 3, replaceHours: 5.5, paintHours: 2.5, partUsd: 250 },
  roof: { repairHours: 4.5, replaceHours: 20, paintHours: 4, partUsd: 650 },
  pillar: { repairHours: 4.5, replaceHours: 15, paintHours: 2.5, partUsd: 500 },
  rear_quarter_panel: { repairHours: 4.5, replaceHours: 16, paintHours: 3.5, partUsd: 650 },
  boot_or_tailgate: { repairHours: 3, replaceHours: 2.2, paintHours: 3.5, partUsd: 750 },
  wheel_or_tyre: { replaceHours: 0.8, partUsd: 350 },
  windscreen: { replaceHours: 2, partUsd: 550 },
  side_glass: { replaceHours: 1.2, partUsd: 250 },
  rear_glass: { replaceHours: 2, partUsd: 400 },
  underbody: { repairHours: 4, replaceHours: 8, partUsd: 800 },
  interior: { repairHours: 2, replaceHours: 2, partUsd: 500 },
};

/** The AI's part names use a few British terms; show them as a US shop would. */
const US_AREA_NAMES: Partial<Record<Area, string>> = {
  boot_or_tailgate: "trunk or tailgate",
  wheel_or_tyre: "wheel or tire",
  windscreen: "windshield",
  side_sill: "rocker panel",
};
export const areaLabel = (area: Area) => US_AREA_NAMES[area] ?? area.replace(/_/g, " ");

/** Repair labor scales with how bad the damage is. Replacement labor doesn't. */
const SEVERITY_FACTOR: Record<DamageItem["severity"], number> = { minor: 0.5, moderate: 1, severe: 1.6 };
/** Removing and refitting trim, handles and mouldings, and masking, for each panel that gets painted. */
const SETUP_HOURS = 1;
/** Hours to take a part off and look behind it, when the AI says "inspect". */
const INSPECT_HOURS = 1;
/** A diagnostic scan and calibration, when the AI says "calibrate". */
const CALIBRATE = { hours: 1.5, usd: 200 };

export type PartsTier = "economy" | "standard" | "premium";
export const PARTS_TIER_FACTOR: Record<PartsTier, number> = { economy: 0.8, standard: 1, premium: 1.5 };

/** Makes whose parts are priced at the premium tier whatever the car's value. */
export const PREMIUM_MAKES = [
  "Acura", "Alfa Romeo", "Aston Martin", "Audi", "Bentley", "BMW", "Cadillac", "Ferrari", "Genesis", "Infiniti", "Jaguar",
  "Lamborghini", "Land Rover", "Range Rover", "Lexus", "Lincoln", "Maserati", "McLaren", "Mercedes-Benz", "Mercedes", "Porsche",
  "Rolls-Royce", "Tesla", "Volvo",
];

/** Parts cost more on a luxury make or a valuable car, less on a cheap one. Unknown means standard. */
export function partsTierFor(vehicleValueUsd: number | null | undefined, make: string | null | undefined): { tier: PartsTier; why: string } {
  const m = make?.trim().toLowerCase();
  const premiumMake = m ? PREMIUM_MAKES.find((p) => m === p.toLowerCase() || m.startsWith(p.toLowerCase() + " ")) : undefined;
  if (premiumMake) return { tier: "premium", why: `${premiumMake} parts` };
  if (vehicleValueUsd && vehicleValueUsd > 40000) return { tier: "premium", why: "car worth over $40,000" };
  if (vehicleValueUsd && vehicleValueUsd < 10000) return { tier: "economy", why: "car worth under $10,000" };
  return { tier: "standard", why: vehicleValueUsd ? "mid-range car" : "car value not on file" };
}

/**
 * Labor rates vary a lot by market. A claim's ZIP picks a market, and the market scales the
 * carrier's base labor rate. Placeholder markets and multipliers: in production these come
 * from the carrier's own market rates and its agreements with partner shops.
 */
export interface Market {
  name: string;
  factor: number;
  /** Ranges of the first three digits of the ZIP code. */
  zip3: [number, number][];
}

export const MARKETS: Market[] = [
  { name: "San Francisco Bay Area", factor: 1.25, zip3: [[940, 951]] },
  { name: "New York City", factor: 1.22, zip3: [[100, 104], [110, 114]] },
  { name: "Los Angeles", factor: 1.15, zip3: [[900, 918]] },
  { name: "Boston", factor: 1.15, zip3: [[21, 24]] },
  { name: "Seattle", factor: 1.12, zip3: [[980, 981]] },
  { name: "Chicago", factor: 1.05, zip3: [[606, 608]] },
  { name: "Denver", factor: 1.03, zip3: [[800, 802]] },
  { name: "Columbus, Ohio", factor: 1.0, zip3: [[430, 432]] },
  { name: "Atlanta", factor: 0.98, zip3: [[300, 303]] },
  { name: "Dallas-Fort Worth", factor: 0.95, zip3: [[750, 753], [760, 762]] },
  { name: "Phoenix", factor: 0.95, zip3: [[850, 853]] },
  { name: "Iowa", factor: 0.82, zip3: [[500, 528]] },
  { name: "Mississippi", factor: 0.8, zip3: [[386, 397]] },
];

export const NATIONAL_AVERAGE: Market = { name: "National average", factor: 1, zip3: [] };

export function marketFor(zip: string | null | undefined): Market {
  const digits = zip?.replace(/\D/g, "") ?? "";
  if (digits.length < 3) return NATIONAL_AVERAGE;
  const z3 = Number(digits.slice(0, 3));
  return MARKETS.find((m) => m.zip3.some(([lo, hi]) => z3 >= lo && z3 <= hi)) ?? NATIONAL_AVERAGE;
}

/** Disconnecting and checking the high-voltage system before body work on an electric or hybrid car. */
export const HIGH_VOLTAGE_HOURS = 1.5;

export interface Rates {
  labourRateUsd: number;
  paintMaterialsUsd: number;
  tier: PartsTier;
}

export interface PriceOption {
  label: "Repair" | "Replace" | "Refinish";
  usd: number;
  /** "4.5 h body x $65 + 3.5 h paint x $110 = $678" */
  math: string;
  chosen: boolean;
}

export interface PricedItem {
  /** The cost of the repair as priced. */
  likelyUsd: number;
  /** What replacing it would add, when the AI could only flag it for inspection. */
  possibleExtraUsd: number;
  possibleExtraMath?: string;
  /** "4.5 h body, 3.5 h paint" */
  breakdown: string;
  /** The working for the chosen option. */
  math: string;
  /** Repair against replace, when both are possible for this part. */
  options: PriceOption[];
  /** Why the chosen option, when it differs from the AI's call. */
  decision?: string;
}

/** Price one damage item from the rate card, or null if the card has no line for it. */
export function priceItem(item: DamageItem, r: Rates): PricedItem | null {
  const card = RATE_CARD[item.area];
  if (!card) return null;
  const partsFactor = PARTS_TIER_FACTOR[r.tier];
  const paintRate = r.labourRateUsd + r.paintMaterialsUsd;
  const work = (body: number, paint: number, part: number) => job(body + (paint > 0 ? SETUP_HOURS : 0), paint, part, r.labourRateUsd, paintRate);

  if (item.likely_repair === "inspect") {
    // We can't see behind the panel yet: price the inspection, and show the replacement as a possible extra.
    const hrs = card.replaceHours ?? card.repairHours ?? 0;
    const partCost = (card.partUsd ?? 0) * partsFactor;
    const look = job(INSPECT_HOURS, 0, 0, r.labourRateUsd, paintRate);
    const replace = job(hrs, 0, partCost, r.labourRateUsd, paintRate);
    return {
      likelyUsd: look.usd,
      possibleExtraUsd: replace.usd,
      possibleExtraMath: replace.math,
      breakdown: `${fmt(INSPECT_HOURS)} h to look behind it`,
      math: look.math,
      options: [],
    };
  }
  if (item.likely_repair === "calibrate") {
    const c = job(CALIBRATE.hours, 0, CALIBRATE.usd, r.labourRateUsd, paintRate, "scan");
    return { likelyUsd: c.usd, possibleExtraUsd: 0, breakdown: c.parts, math: c.math, options: [] };
  }

  const part = (card.partUsd ?? 0) * partsFactor;
  const repair = card.repairHours !== undefined ? work(card.repairHours * SEVERITY_FACTOR[item.severity], card.paintHours ?? 0, 0) : null;
  const replace = card.replaceHours !== undefined ? work(card.replaceHours, card.paintHours ?? 0, part) : null;

  let chosen: { kind: PriceOption["label"]; j: Job } | null = null;
  let decision: string | undefined;
  if (item.likely_repair === "refinish_only") {
    // The whole panel is refinished whatever the size of the scuff.
    if (card.paintHours) chosen = { kind: "Refinish", j: work(0, card.paintHours, 0) };
  } else if (item.likely_repair === "repair_and_refinish") {
    if (repair) chosen = { kind: "Repair", j: repair };
    // An estimator replaces a part when repairing it would cost more.
    if (repair && replace && replace.usd < repair.usd) {
      chosen = { kind: "Replace", j: replace };
      decision = "Repairing would cost more than replacing, so it's priced as a replacement.";
    }
    if (!chosen && replace) chosen = { kind: "Replace", j: replace };
  } else {
    // The AI judged it needs replacing (torn, missing or crushed), so repair isn't an option.
    if (replace) chosen = { kind: "Replace", j: replace };
  }
  if (!chosen || chosen.j.usd <= 0) return null;

  const options: PriceOption[] = [];
  if (chosen.kind === "Refinish") options.push({ label: "Refinish", usd: chosen.j.usd, math: chosen.j.math, chosen: true });
  if (repair && chosen.kind !== "Refinish") options.push({ label: "Repair", usd: repair.usd, math: repair.math, chosen: chosen.kind === "Repair" });
  if (replace && chosen.kind !== "Refinish") options.push({ label: "Replace", usd: replace.usd, math: replace.math, chosen: chosen.kind === "Replace" });
  if (!decision && chosen.kind === "Replace" && repair && (item.likely_repair === "replace" || item.likely_repair === "replace_and_refinish")) {
    decision = "The AI judged this part needs replacing, not repairing.";
  }
  return { likelyUsd: chosen.j.usd, possibleExtraUsd: 0, breakdown: chosen.j.parts, math: chosen.j.math, options, decision };
}

interface Job {
  usd: number;
  math: string;
  parts: string;
}

/** Labor, paint and a part, with the working shown. */
function job(body: number, paint: number, part: number, rate: number, paintRate: number, partWord = "part"): Job {
  const terms: string[] = [];
  const bits: string[] = [];
  if (body > 0) {
    terms.push(`${fmt(body)} h body x ${money(rate)}`);
    bits.push(`${fmt(body)} h body`);
  }
  if (paint > 0) {
    terms.push(`${fmt(paint)} h paint x ${money(paintRate)}`);
    bits.push(`${fmt(paint)} h paint`);
  }
  if (part > 0) {
    terms.push(`${money(part)} ${partWord}`);
    bits.push(`${partWord} ${money(part)}`);
  }
  const usd = body * rate + paint * paintRate + part;
  return { usd, math: `${terms.join(" + ")} = ${money(usd)}`, parts: bits.join(", ") };
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

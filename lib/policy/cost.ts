// The rough repair-cost range.
//
// The AI prices each damage item from its general knowledge of typical US
// repair costs. That is the "AI-generated estimate" the brief asks for. Code
// then adds the items up and applies a few visible, labelled adjustments.
// Every adjustment amount is an illustrative placeholder set in the protocol.
//
// The range is never a payable amount. Its main job is showing which side of
// the fast-path limit and the total-loss line a claim falls on.

import type { Area, DamageItem, Extraction } from "../extraction/schema.ts";
import type { Settings } from "./protocol.ts";

export interface CostDriver {
  label: string;
  lowUsd: number;
  highUsd: number;
  source: "ai_estimate" | "rule_adjustment";
  note?: string;
}

export interface CostRange {
  lowUsd: number;
  highUsd: number;
  drivers: CostDriver[];
}

const ROUND_TO = 50;

const HIDDEN_DAMAGE_AREAS: Area[] = ["front_bumper", "grille", "hood", "headlight", "front_fender", "rear_bumper", "boot_or_tailgate", "tail_light", "rear_quarter_panel", "wheel_or_tyre", "underbody"];

export function buildCostRange(x: Extraction, s: Settings): CostRange | null {
  if (!x.vehicle.vehicle_present || x.damage.items.length === 0) return null;

  const drivers: CostDriver[] = x.damage.items.map((item) => {
    const [low, high] = saneRange(item.cost_low_usd, item.cost_high_usd);
    return { label: describeItem(item), lowUsd: low, highUsd: high, source: "ai_estimate" };
  });

  const itemsHigh = sum(drivers.map((d) => d.highUsd));

  if (x.risk_signs.some((r) => r.sign === "sensor_zone_damage") && s.sensorCalibrationHighUsd > 0) {
    drivers.push({
      label: "Possible sensor recalibration",
      lowUsd: s.sensorCalibrationLowUsd,
      highUsd: s.sensorCalibrationHighUsd,
      source: "rule_adjustment",
      note: "Placeholder amount, illustrative",
    });
  }

  // Damage behind the panels is likely where brackets, sensors and crash
  // structure sit (the front and rear ends), or when anything is severe. A dent
  // in a door skin doesn't get the allowance.
  const hiddenLikely = x.damage.items.some(
    (i) => i.severity === "severe" || (i.severity === "moderate" && HIDDEN_DAMAGE_AREAS.includes(i.area)),
  );
  if (hiddenLikely && s.hiddenDamageAllowancePct > 0) {
    drivers.push({
      label: "Allowance for damage behind the panels",
      lowUsd: 0,
      highUsd: itemsHigh * (s.hiddenDamageAllowancePct / 100),
      source: "rule_adjustment",
      note: `+${s.hiddenDamageAllowancePct}% on the high end, illustrative`,
    });
  }

  const partial =
    x.evidence.damage_extends_beyond_frame || x.evidence.view_type === "close_up" || x.evidence.view_type === "detail";
  if (partial && s.partialViewWideningPct > 0) {
    drivers.push({
      label: "Damage only partly visible",
      lowUsd: 0,
      highUsd: itemsHigh * (s.partialViewWideningPct / 100),
      source: "rule_adjustment",
      note: `+${s.partialViewWideningPct}% on the high end, illustrative`,
    });
  }

  const low = sum(drivers.map((d) => d.lowUsd));
  const high = sum(drivers.map((d) => d.highUsd));

  return {
    lowUsd: roundDown(Math.max(0, low)),
    highUsd: roundUp(Math.max(low, high)),
    drivers: drivers.map((d) => ({ ...d, lowUsd: Math.round(d.lowUsd), highUsd: Math.round(d.highUsd) })),
  };
}

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

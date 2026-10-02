// Total-loss rules by state, found from the claim's ZIP code.
//
// States set the point at which a damaged car must be treated as a total loss in one of
// two ways: a fixed share of the car's value, or the "total loss formula" (repair cost plus
// salvage value at least the car's value). States with no rule here fall back to the
// carrier's own setting.
//
// UNVERIFIED: these rules come from a secondary source (carinsurance.com's state list and a
// 2018 law-firm chart), not each state's statute or insurance department. They are here to
// show the mechanism and must be checked against state law before anyone relies on them.
// In production, the carrier's compliance team owns this table, and salvage values come from
// salvage auction data rather than a fixed share.

import type { Settings } from "./protocol.ts";

export const TOTAL_LOSS_SOURCE = "https://www.carinsurance.com/Articles/total-loss-thresholds.aspx";

/** The two-letter state for a ZIP code, from its first three digits. */
const ZIP3_STATES: [number, number, string][] = [
  [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"], [50, 59, "VT"], [60, 69, "CT"], [70, 89, "NJ"],
  [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"], [200, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"],
  [247, 268, "WV"], [270, 289, "NC"], [290, 299, "SC"], [300, 319, "GA"], [320, 349, "FL"], [350, 369, "AL"],
  [370, 385, "TN"], [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"], [430, 458, "OH"], [460, 479, "IN"],
  [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"], [570, 577, "SD"], [580, 588, "ND"],
  [590, 599, "MT"], [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"], [700, 714, "LA"],
  [716, 729, "AR"], [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"], [832, 838, "ID"],
  [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"], [885, 885, "TX"], [889, 898, "NV"], [900, 961, "CA"],
  [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"],
];

export function stateForZip(zip: string | null | undefined): string | null {
  const digits = zip?.replace(/\D/g, "") ?? "";
  if (digits.length < 3) return null;
  const z3 = Number(digits.slice(0, 3));
  return ZIP3_STATES.find(([lo, hi]) => z3 >= lo && z3 <= hi)?.[2] ?? null;
}

export type StateRule = { kind: "percent"; percent: number } | { kind: "formula" };

/** From the secondary source above. Unverified. */
export const STATE_TOTAL_LOSS: Record<string, StateRule> = {
  TX: { kind: "percent", percent: 100 },
  CO: { kind: "percent", percent: 100 },
  FL: { kind: "percent", percent: 80 },
  MO: { kind: "percent", percent: 80 },
  OR: { kind: "percent", percent: 80 },
  NY: { kind: "percent", percent: 75 },
  NV: { kind: "percent", percent: 65 },
  OK: { kind: "percent", percent: 60 },
  CA: { kind: "formula" },
  IL: { kind: "formula" },
  OH: { kind: "formula" },
  PA: { kind: "formula" },
  WA: { kind: "formula" },
};

/** Placeholder salvage value for the total loss formula, as a share of the car's value. */
export const SALVAGE_SHARE = 0.2;

export interface TotalLossLine {
  lineUsd: number;
  /** "Ohio uses the total loss formula: ..." */
  basis: string;
  state: string | null;
}

/** The repair cost at which this car would be a total loss, and why. */
export function totalLossLine(vehicleValueUsd: number | null | undefined, zip: string | null | undefined, s: Settings): TotalLossLine | null {
  if (!vehicleValueUsd) return null;
  const state = stateForZip(zip);
  const rule = state ? STATE_TOTAL_LOSS[state] : undefined;
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  if (rule?.kind === "percent") {
    return {
      lineUsd: vehicleValueUsd * (rule.percent / 100),
      basis: `${state} threshold: ${rule.percent}% of the ${money(vehicleValueUsd)} value (state rule, unverified)`,
      state,
    };
  }
  if (rule?.kind === "formula") {
    const salvage = vehicleValueUsd * SALVAGE_SHARE;
    return {
      lineUsd: vehicleValueUsd - salvage,
      basis: `${state} uses the total loss formula: repair + salvage (placeholder ${money(salvage)}) reaching the ${money(vehicleValueUsd)} value (state rule, unverified)`,
      state,
    };
  }
  return {
    lineUsd: vehicleValueUsd * s.totalLossRatio,
    basis: `${Math.round(s.totalLossRatio * 100)}% of the ${money(vehicleValueUsd)} value (carrier setting${state ? `; no state rule on file for ${state}` : ""})`,
    state,
  };
}

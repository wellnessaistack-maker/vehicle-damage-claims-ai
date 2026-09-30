// Tidies the AI's answer before it is checked against the schema.
//
// The fixed categories (panel names, damage types and so on) are described to
// the model rather than hard-enforced, so an answer can come back as
// "Rear Door" instead of "rear_door". Near misses are repaired. Anything still
// unknown falls back to the cautious choice: an unknown view counts as a
// close-up (asks for more photos), an unknown vehicle type as "other" (goes to
// an adjuster), an unknown identification as "not identifiable" (no guessing).

import {
  AREAS,
  DAMAGE_TYPES,
  IDENTIFICATION_BASIS,
  PHOTO_ISSUES,
  POWERTRAIN_HINTS,
  REPAIR_ACTIONS,
  RISK_SIGNS,
  SEVERITIES,
  SIDES,
  VEHICLE_CLASSES,
  VIEW_TYPES,
} from "./schema.ts";

type Obj = Record<string, unknown>;

const key = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, "_");

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const k = key(v);
  return (allowed as readonly string[]).includes(k) ? (k as T) : fallback;
}

function pickOrDrop<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const k = key(v);
  return (allowed as readonly string[]).includes(k) ? (k as T) : null;
}

const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(String(v ?? "").replace(/[^0-9.]/g, "")) || 0);
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() && !/^(null|unknown|n\/a)$/i.test(v.trim()) ? v.trim() : null);

export function normaliseExtraction(raw: unknown): unknown {
  const r = obj(raw);
  const v = obj(r.vehicle);
  const d = obj(r.damage);
  const e = obj(r.evidence);
  return {
    vehicle: {
      vehicle_present: v.vehicle_present === true,
      multiple_vehicles_in_frame: v.multiple_vehicles_in_frame === true,
      same_vehicle_in_all_photos: v.same_vehicle_in_all_photos !== false,
      vehicle_class: pick(v.vehicle_class, VEHICLE_CLASSES, "other"),
      make: strOrNull(v.make),
      model: strOrNull(v.model),
      year_range: strOrNull(v.year_range),
      colour: strOrNull(v.colour),
      identification_basis: pick(v.identification_basis, IDENTIFICATION_BASIS, "not_identifiable"),
      identification_evidence: String(v.identification_evidence ?? ""),
      powertrain_hint: pick(v.powertrain_hint, POWERTRAIN_HINTS, "unknown"),
    },
    damage: {
      summary: String(d.summary ?? ""),
      no_visible_damage: d.no_visible_damage === true,
      items: arr(d.items).map((i) => {
        const it = obj(i);
        return {
          area: pick(it.area, AREAS, "other"),
          side: pick(it.side, SIDES, "unknown"),
          damage_type: pick(it.damage_type, DAMAGE_TYPES, "other"),
          severity: pick(it.severity, SEVERITIES, "moderate"),
          likely_repair: pick(it.likely_repair, REPAIR_ACTIONS, "inspect"),
          visible_evidence: String(it.visible_evidence ?? ""),
          cost_low_usd: num(it.cost_low_usd),
          cost_high_usd: num(it.cost_high_usd),
        };
      }),
    },
    evidence: {
      view_type: pick(e.view_type, VIEW_TYPES, "close_up"),
      damage_extends_beyond_frame: e.damage_extends_beyond_frame === true,
      visible_panels: arr(e.visible_panels).map((p) => pickOrDrop(p, AREAS)).filter(Boolean),
      photo_issues: arr(e.photo_issues).map((p) => pickOrDrop(p, PHOTO_ISSUES)).filter(Boolean),
    },
    risk_signs: arr(r.risk_signs)
      .map((s) => {
        const o = obj(s);
        const sign = pickOrDrop(o.sign, RISK_SIGNS) ?? closestSign(o.sign);
        return sign ? { sign, evidence: String(o.evidence ?? "") } : null;
      })
      .filter(Boolean),
  };
}

// Risk signs are safety signals, so a near miss is matched by keyword rather
// than dropped.
const SIGN_KEYWORDS: [RegExp, (typeof RISK_SIGNS)[number]][] = [
  [/airbag/, "airbag_deployed"],
  [/struct|frame|pillar|chassis|roof_crush/, "structural_deformation"],
  [/wheel|suspension|axle/, "wheel_or_suspension_displaced"],
  [/fluid|leak|oil|coolant/, "fluid_leak"],
  [/fire|burn|smoke/, "fire_damage"],
  [/flood|water|submerg/, "flood_damage"],
  [/sensor|adas|radar|camera|calibrat/, "sensor_zone_damage"],
  [/prior|old|rust|weather|pre_exist/, "possible_prior_damage"],
  [/screen|print|monitor|moire/, "photo_of_screen_or_print"],
];

function closestSign(v: unknown): (typeof RISK_SIGNS)[number] | null {
  const k = key(v);
  return SIGN_KEYWORDS.find(([re]) => re.test(k))?.[1] ?? null;
}

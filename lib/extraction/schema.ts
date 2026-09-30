// The contract between the AI and the routing rules.
//
// The model fills in this structure from the photos. It describes what it can
// see; it never chooses a route. Every field is something a claims reviewer
// could check by looking at the photo, which also makes it labellable and
// testable.

import { z } from "zod";

export const VEHICLE_CLASSES = [
  "passenger_car",
  "suv",
  "pickup",
  "van",
  "motorcycle",
  "commercial",
  "race_or_non_road",
  "other",
  "none",
] as const;

export const IDENTIFICATION_BASIS = [
  "badge_or_logo_visible",
  "distinctive_body_shape",
  "not_identifiable",
] as const;

export const POWERTRAIN_HINTS = ["likely_ev_or_hybrid", "likely_combustion", "unknown"] as const;

export const AREAS = [
  "front_bumper",
  "grille",
  "hood",
  "headlight",
  "front_fender",
  "windscreen",
  "front_door",
  "rear_door",
  "side_mirror",
  "side_sill",
  "roof",
  "pillar",
  "rear_quarter_panel",
  "boot_or_tailgate",
  "rear_bumper",
  "tail_light",
  "wheel_or_tyre",
  "underbody",
  "side_glass",
  "rear_glass",
  "interior",
  "other",
] as const;

export const SIDES = ["left", "right", "front", "rear", "centre", "unknown"] as const;

export const DAMAGE_TYPES = [
  "scratch_or_scuff",
  "dent",
  "crack",
  "tear_or_puncture",
  "broken_or_shattered",
  "crushed",
  "missing_part",
  "misaligned_gap",
  "burn",
  "water_line",
  "other",
] as const;

export const SEVERITIES = ["minor", "moderate", "severe"] as const;

export const REPAIR_ACTIONS = [
  "refinish_only",
  "repair_and_refinish",
  "replace",
  "replace_and_refinish",
  "calibrate",
  "inspect",
] as const;

export const VIEW_TYPES = ["wide", "three_quarter", "close_up", "detail", "interior", "no_vehicle"] as const;

export const PHOTO_ISSUES = [
  "blur",
  "too_dark",
  "glare_over_damage",
  "damage_obstructed",
  "low_resolution",
  "black_and_white",
] as const;

export const RISK_SIGNS = [
  "airbag_deployed",
  "structural_deformation",
  "wheel_or_suspension_displaced",
  "fluid_leak",
  "fire_damage",
  "flood_damage",
  "sensor_zone_damage",
  "possible_prior_damage",
  "photo_of_screen_or_print",
] as const;

export const damageItemSchema = z.object({
  area: z.enum(AREAS),
  side: z.enum(SIDES),
  damage_type: z.enum(DAMAGE_TYPES),
  severity: z.enum(SEVERITIES),
  likely_repair: z.enum(REPAIR_ACTIONS),
  visible_evidence: z.string().describe("What in the photo shows this, in a few words."),
  cost_low_usd: z.number().describe("Rough low end for this item, US retail repair, parts and labour."),
  cost_high_usd: z.number().describe("Rough high end for this item."),
});

export const extractionSchema = z.object({
  vehicle: z.object({
    vehicle_present: z.boolean(),
    multiple_vehicles_in_frame: z.boolean(),
    same_vehicle_in_all_photos: z.boolean().describe("False if the photos seem to show different vehicles."),
    vehicle_class: z.enum(VEHICLE_CLASSES),
    make: z.string().nullable(),
    model: z.string().nullable(),
    year_range: z.string().nullable(),
    colour: z.string().nullable(),
    identification_basis: z.enum(IDENTIFICATION_BASIS),
    identification_evidence: z.string().describe("What you used to identify it, or why you could not."),
    powertrain_hint: z.enum(POWERTRAIN_HINTS),
  }),
  damage: z.object({
    summary: z
      .string()
      .describe('One line, plain English, e.g. "Left rear door dent with scraping, extending to the wheel arch".'),
    no_visible_damage: z.boolean(),
    items: z.array(damageItemSchema),
  }),
  evidence: z.object({
    view_type: z.enum(VIEW_TYPES),
    damage_extends_beyond_frame: z.boolean(),
    visible_panels: z.array(z.enum(AREAS)),
    photo_issues: z.array(z.enum(PHOTO_ISSUES)),
  }),
  risk_signs: z.array(
    z.object({
      sign: z.enum(RISK_SIGNS),
      evidence: z.string().describe("What in the photo shows this."),
    }),
  ),
});

export type Extraction = z.infer<typeof extractionSchema>;
export type DamageItem = z.infer<typeof damageItemSchema>;
export type RiskSign = (typeof RISK_SIGNS)[number];
export type Area = (typeof AREAS)[number];

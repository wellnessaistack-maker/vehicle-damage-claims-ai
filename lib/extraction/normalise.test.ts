import { test } from "node:test";
import assert from "node:assert/strict";

import { normaliseExtraction } from "./normalise.ts";
import { extractionSchema } from "./schema.ts";

const answer = (over: Record<string, unknown> = {}) => ({
  vehicle: {
    vehicle_present: true,
    multiple_vehicles_in_frame: false,
    same_vehicle_in_all_photos: true,
    vehicle_class: "Passenger Car",
    make: "Honda",
    model: "Civic",
    year_range: "unknown",
    colour: "Silver",
    identification_basis: "badge or logo visible",
    identification_evidence: "Badge on boot",
    powertrain_hint: "likely-combustion",
  },
  damage: {
    summary: "Left rear door dent",
    no_visible_damage: false,
    items: [{ area: "Rear Door", side: "Left", damage_type: "dent", severity: "Moderate", likely_repair: "repair and refinish", visible_evidence: "crease", cost_low_usd: "$700", cost_high_usd: 1400 }],
  },
  evidence: { view_type: "Three quarter", damage_extends_beyond_frame: false, visible_panels: ["rear door", "spoiler"], photo_issues: [] },
  risk_signs: [],
  ...over,
});

test("near-miss category values are repaired and pass the schema", () => {
  const out = extractionSchema.parse(normaliseExtraction(answer()));
  assert.equal(out.vehicle.vehicle_class, "passenger_car");
  assert.equal(out.vehicle.identification_basis, "badge_or_logo_visible");
  assert.equal(out.vehicle.year_range, null);
  assert.equal(out.damage.items[0].area, "rear_door");
  assert.equal(out.damage.items[0].cost_low_usd, 700);
  assert.deepEqual(out.evidence.visible_panels, ["rear_door"]);
});

test("unknown values fall back to the cautious choice", () => {
  const raw = answer();
  (raw.vehicle as Record<string, unknown>).identification_basis = "pretty sure";
  (raw.vehicle as Record<string, unknown>).vehicle_class = "hovercraft";
  (raw.evidence as Record<string, unknown>).view_type = "aerial";
  const out = extractionSchema.parse(normaliseExtraction(raw));
  assert.equal(out.vehicle.identification_basis, "not_identifiable");
  assert.equal(out.vehicle.vehicle_class, "other");
  assert.equal(out.evidence.view_type, "close_up");
});

test("risk signs with slightly different names are kept, not dropped", () => {
  const out = extractionSchema.parse(
    normaliseExtraction(answer({ risk_signs: [{ sign: "airbags deployed", evidence: "bag visible" }, { sign: "Flooding", evidence: "waterline" }, { sign: "nonsense", evidence: "" }] })),
  );
  assert.deepEqual(out.risk_signs.map((r) => r.sign), ["airbag_deployed", "flood_damage"]);
});

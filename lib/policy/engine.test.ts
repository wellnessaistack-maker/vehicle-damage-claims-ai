import { test } from "node:test";
import assert from "node:assert/strict";

import { DEMO_CLAIMS } from "../claims/demo.ts";
import type { ClaimContext, PhotoMetrics } from "../claims/types.ts";
import type { Extraction } from "../extraction/schema.ts";
import { decide } from "./engine.ts";
import { clampSettings, DEFAULT_SETTINGS, RULES, SETTING_DEFS } from "./protocol.ts";

// --- Fixtures -----------------------------------------------------------------

const goodPhoto = (name = "photo.jpg"): PhotoMetrics => ({
  name,
  width: 1536,
  height: 1024,
  brightness: 110,
  sharpness: 2700,
  clippedHighlights: 0.001,
  greyscale: false,
  nearDuplicateOf: null,
});

/** Photo A: silver Civic, left rear door dent with scraping. */
function civicA(): Extraction {
  return {
    vehicle: {
      vehicle_present: true,
      multiple_vehicles_in_frame: false,
      same_vehicle_in_all_photos: true,
      vehicle_class: "passenger_car",
      make: "Honda",
      model: "Civic",
      year_range: "2016-2021",
      colour: "Silver",
      identification_basis: "badge_or_logo_visible",
      identification_evidence: "Honda logo and CIVIC badge on the boot lid",
      powertrain_hint: "likely_combustion",
    },
    damage: {
      summary: "Left rear door dent with scraping, extending towards the rear wheel arch",
      no_visible_damage: false,
      items: [
        {
          area: "rear_door",
          side: "left",
          damage_type: "dent",
          severity: "moderate",
          likely_repair: "repair_and_refinish",
          visible_evidence: "Crease and scrape marks across the lower rear door",
          cost_low_usd: 700,
          cost_high_usd: 1400,
        },
        {
          area: "rear_quarter_panel",
          side: "left",
          damage_type: "scratch_or_scuff",
          severity: "minor",
          likely_repair: "refinish_only",
          visible_evidence: "Scuffing at the leading edge of the wheel arch",
          cost_low_usd: 200,
          cost_high_usd: 450,
        },
      ],
    },
    evidence: {
      view_type: "three_quarter",
      damage_extends_beyond_frame: false,
      visible_panels: ["front_door", "rear_door", "rear_quarter_panel", "rear_bumper", "boot_or_tailgate"],
      photo_issues: [],
    },
    risk_signs: [],
  };
}

/** Photo B: close-up of the same door. No badge, damage runs out of frame. */
function closeupB(): Extraction {
  const x = civicA();
  x.vehicle.make = null;
  x.vehicle.model = null;
  x.vehicle.year_range = null;
  x.vehicle.identification_basis = "not_identifiable";
  x.vehicle.identification_evidence = "Only a door panel is visible; no badge or distinctive shape";
  x.evidence.view_type = "close_up";
  x.evidence.damage_extends_beyond_frame = true;
  x.evidence.visible_panels = ["rear_door"];
  return x;
}

/** Photo C: race-car crash. */
function raceC(): Extraction {
  return {
    vehicle: {
      vehicle_present: true,
      multiple_vehicles_in_frame: true,
      same_vehicle_in_all_photos: true,
      vehicle_class: "race_or_non_road",
      make: "McLaren",
      model: "Formula 1 car",
      year_range: null,
      colour: "Orange",
      identification_basis: "badge_or_logo_visible",
      identification_evidence: "Team livery and open-wheel single-seater body",
      powertrain_hint: "unknown",
    },
    damage: {
      summary: "Car airborne over another car with major front and side damage and debris",
      no_visible_damage: false,
      items: [
        {
          area: "underbody",
          side: "unknown",
          damage_type: "crushed",
          severity: "severe",
          likely_repair: "replace",
          visible_evidence: "Floor and sidepod torn, debris in the air",
          cost_low_usd: 50000,
          cost_high_usd: 250000,
        },
      ],
    },
    evidence: { view_type: "wide", damage_extends_beyond_frame: false, visible_panels: ["underbody"], photo_issues: [] },
    risk_signs: [
      { sign: "structural_deformation", evidence: "Chassis torn open" },
      { sign: "wheel_or_suspension_displaced", evidence: "Front wheel detached" },
    ],
  };
}

const claim = (overrides: Partial<ClaimContext> = {}): ClaimContext => ({ ...DEMO_CLAIMS.A, ...overrides });
const run = (x: Extraction, c: ClaimContext = claim(), photos = [goodPhoto()], settings = DEFAULT_SETTINGS) =>
  decide(x, c, photos, settings);
const firedIds = (d: ReturnType<typeof run>) => d.reasons.map((r) => r.id);

// --- Demo cases -----------------------------------------------------------------

test("A: clear photo of the Civic goes to the photo estimate path with every required output", () => {
  const d = run(civicA());
  assert.equal(d.route, "photo_estimate");
  assert.equal(d.routeLabel, "Ready to approve");
  assert.equal(d.humanReview.required, false);
  assert.deepEqual(firedIds(d), []);
  const out = d.requiredOutputs;
  assert.equal(out.vehicle.make.value, "Honda");
  assert.equal(out.vehicle.model.value, "Civic");
  assert.equal(out.vehicle.colour.value, "Silver");
  assert.match(out.damageSummary, /rear door/i);
  assert.equal(out.estimate.status, "shown");
  assert.ok(out.estimate.lowUsd! > 0 && out.estimate.highUsd! > out.estimate.lowUsd!);
  assert.ok(out.estimate.highUsd! <= DEFAULT_SETTINGS.fastPathLimitUsd);
  assert.equal(d.customerMessage, null);
});

test("A: the range shows its drivers, and a door dent gets no hidden-damage allowance", () => {
  const e = run(civicA()).requiredOutputs.estimate;
  assert.ok(e.drivers.every((d) => d.source === "rate_card"));
  assert.match(e.drivers[0].note!, /h body, .* h paint/);
  assert.match(e.accuracyNote, /final paid costs/);
});

// --- Rate card ---------------------------------------------------------------------

test("the rate card prices the described repair, so different AI prices for the same damage give the same estimate", () => {
  const a = civicA();
  const b = civicA();
  b.damage.items[0] = { ...b.damage.items[0], cost_low_usd: 1300, cost_high_usd: 2900 };
  const ea = run(a).requiredOutputs.estimate;
  const eb = run(b).requiredOutputs.estimate;
  assert.equal(ea.lowUsd, eb.lowUsd);
  assert.equal(ea.highUsd, eb.highUsd);
  const aiOnly = clampSettings({ pricing: "ai" });
  assert.notEqual(run(a, claim(), [goodPhoto()], aiOnly).requiredOutputs.estimate.highUsd, run(b, claim(), [goodPhoto()], aiOnly).requiredOutputs.estimate.highUsd);
});

test("each priced line shows what the AI saw, the math, and repair against replace", () => {
  const e = run(civicA()).requiredOutputs.estimate;
  const door = e.drivers[0];
  assert.match(door.evidence!, /Crease/);
  assert.deepEqual(door.options!.map((o) => [o.label, o.chosen]), [["Repair", true], ["Replace", false]]);
  assert.match(door.options![0].math, /h body x \$65 .* h paint x \$110 = \$/);
  assert.ok(door.options![1].usd > door.options![0].usd, "replacing the door costs more than repairing it");
  assert.match(e.workings!.join(" "), /Repairs add up to .* less and plus 15%/);
});

test("the carrier's labour rate changes the estimate", () => {
  const base = run(civicA()).requiredOutputs.estimate;
  const dearer = run(civicA(), claim(), [goodPhoto()], clampSettings({ labourRateUsd: 95 })).requiredOutputs.estimate;
  assert.ok(dearer.highUsd! > base.highUsd!);
});

test("the claim's ZIP code sets the labour market", () => {
  const columbus = run(civicA(), claim({ zip: "43215" })).requiredOutputs.estimate;
  const sf = run(civicA(), claim({ zip: "94110" })).requiredOutputs.estimate;
  const iowa = run(civicA(), claim({ zip: "50309" })).requiredOutputs.estimate;
  assert.equal(columbus.pricing!.labourRateUsd, 65);
  assert.equal(sf.pricing!.market.name, "San Francisco Bay Area");
  assert.ok(sf.highUsd! > columbus.highUsd! && columbus.highUsd! > iowa.highUsd!);
  assert.match(sf.workings![0], /\$65 base x 1\.25 for the San Francisco Bay Area market = \$81\/h/);
  assert.equal(run(civicA(), claim({ zip: null })).requiredOutputs.estimate.pricing!.market.name, "National average");
});

test("a luxury make gets premium parts whatever its value", () => {
  const x = civicA();
  x.damage.items = [{ ...x.damage.items[0], area: "headlight", likely_repair: "replace" }];
  const bmw = run(x, claim({ policyVehicle: { ...DEMO_CLAIMS.A.policyVehicle, make: "BMW" } })).requiredOutputs.estimate;
  assert.equal(bmw.pricing!.tier, "premium");
  assert.equal(bmw.pricing!.tierWhy, "BMW parts");
});

test("an electric car adds the high-voltage safety procedure", () => {
  const ev = run(civicA(), claim({ policyVehicle: { ...DEMO_CLAIMS.A.policyVehicle, powertrain: "electric" } })).requiredOutputs.estimate;
  assert.ok(ev.drivers.some((d) => d.label === "High-voltage safety procedure"));
  const petrol = run(civicA()).requiredOutputs.estimate;
  assert.ok(ev.highUsd! > petrol.highUsd!);
});

test("replacement parts cost more on a more valuable car", () => {
  const x = civicA();
  x.damage.items = [{ ...x.damage.items[0], area: "headlight", likely_repair: "replace" }];
  const cheap = run(x, claim({ vehicleValueUsd: 8000 })).requiredOutputs.estimate;
  const dear = run(x, claim({ vehicleValueUsd: 60000 })).requiredOutputs.estimate;
  assert.ok(dear.highUsd! > cheap.highUsd!);
});

test("a part the rate card doesn't cover keeps the AI's own price, labelled", () => {
  const x = civicA();
  x.damage.items[0] = { ...x.damage.items[0], area: "other" };
  const d = run(x).requiredOutputs.estimate.drivers[0];
  assert.equal(d.source, "ai_estimate");
  assert.match(d.note!, /Not on the rate card/);
});

test("vehicles that aren't road cars keep the AI's own price", () => {
  const d = run(raceC(), claim(DEMO_CLAIMS.C)).requiredOutputs.estimate.drivers[0];
  assert.equal(d.source, "ai_estimate");
});

test("moderate damage to a bumper adds a labelled hidden-damage allowance", () => {
  const x = civicA();
  x.damage.items[0] = { ...x.damage.items[0], area: "rear_bumper", side: "rear" };
  const e = run(x).requiredOutputs.estimate;
  assert.ok(e.drivers.some((d) => d.source === "rule_adjustment" && /behind the panels/.test(d.label)));
});

test("B: close-up doesn't guess the car, gives only a provisional estimate and asks for a wider photo", () => {
  const d = run(closeupB(), claim(DEMO_CLAIMS.B));
  assert.equal(d.route, "more_evidence");
  assert.deepEqual(firedIds(d).sort(), ["E2", "E3"]);
  assert.equal(d.requiredOutputs.vehicle.make.value, null);
  assert.equal(d.requiredOutputs.vehicle.make.note, "Not determinable from these photos");
  const e = d.requiredOutputs.estimate;
  assert.equal(e.status, "provisional");
  assert.ok(e.lowUsd! > 0 && e.highUsd! >= e.lowUsd!, "still gives a figure from what's visible");
  assert.match(e.note!, /so far/);
  assert.ok(d.customerMessage);
  assert.doesNotMatch(d.customerMessage!, /\$/, "the provisional figure is never sent to the customer");
  assert.match(d.customerMessage!, /Hi Daniel/);
  assert.match(d.customerMessage!, /3 metres back/);
  assert.match(d.customerMessage!, /rear left side/);
});

test("B: the customer's wider retake moves the claim to the photo estimate path", () => {
  const d = run(civicA(), claim({ ...DEMO_CLAIMS.B, priorEvidenceRequests: 1 }), [goodPhoto("closeup.jpg"), goodPhoto("retake.jpg")]);
  assert.equal(d.route, "photo_estimate");
});

test("damage the AI couldn't price shows no estimate rather than $0", () => {
  const x = raceC();
  x.damage.items = x.damage.items.map((i) => ({ ...i, cost_low_usd: 0, cost_high_usd: 0 }));
  const e = run(x, claim(DEMO_CLAIMS.C)).requiredOutputs.estimate;
  assert.equal(e.status, "withheld");
  assert.equal(e.lowUsd, null);
});

test("C: race car goes to an adjuster, with no estimate of our own", () => {
  const d = run(raceC(), claim(DEMO_CLAIMS.C));
  assert.equal(d.route, "adjuster");
  assert.equal(d.routeLabel, "Adjuster / total loss");
  assert.ok(firedIds(d).includes("P1"));
  assert.ok(firedIds(d).includes("S4"));
  assert.ok(firedIds(d).includes("S2"));
  const e = d.requiredOutputs.estimate;
  assert.equal(e.status, "withheld");
  assert.equal(e.lowUsd, null);
  assert.match(e.note, /rate card doesn't cover it/);
  assert.ok(e.aiItemsUsd!.highUsd > 0, "the AI's rough guess is kept for reference");
  assert.equal(d.humanReview.required, true);
  assert.equal(d.customerMessage, null, "don't ask for more photos when it's clearly serious");
});

// --- Safety and scope -------------------------------------------------------------

test("an injury on the claim always goes to an adjuster, whatever the photo shows", () => {
  const d = run(civicA(), claim({ injuryReported: true }));
  assert.equal(d.route, "adjuster");
  assert.deepEqual(firedIds(d), ["S1"]);
  assert.equal(d.requiredOutputs.estimate.status, "reference_only");
});

test("airbags deployed goes to an adjuster", () => {
  const x = civicA();
  x.risk_signs.push({ sign: "airbag_deployed", evidence: "Deflated airbag visible through the window" });
  assert.equal(run(x).route, "adjuster");
});

test("electric car with rear damage goes to an adjuster", () => {
  const x = civicA();
  x.damage.items.push({ ...x.damage.items[1], area: "rear_bumper", side: "rear" });
  const d = run(x, claim({ policyVehicle: { ...DEMO_CLAIMS.A.policyVehicle, powertrain: "electric" } }));
  assert.equal(d.route, "adjuster");
  assert.ok(firedIds(d).includes("S6"));
});

test("motorcycle is outside the pilot segment", () => {
  const x = civicA();
  x.vehicle.vehicle_class = "motorcycle";
  assert.ok(firedIds(run(x)).includes("P2"));
});

// --- Integrity ----------------------------------------------------------------------

test("a photo matching a past claim goes to an adjuster and is referred to SIU", () => {
  const d = run(civicA(), claim(), [{ ...goodPhoto(), nearDuplicateOf: "CLM-2026-10481" }]);
  assert.equal(d.route, "adjuster");
  assert.equal(d.siuReferral, true);
  assert.equal(d.evidenceChecklist.find((c) => c.label === "Not seen on a past claim")!.ok, false);
});

test("a folder with photos of different cars only gets a provisional estimate", () => {
  const x = civicA();
  x.vehicle.same_vehicle_in_all_photos = false;
  const d = run(x, claim(), [goodPhoto("a.jpg"), goodPhoto("b.jpg")]);
  assert.equal(d.route, "adjuster");
  assert.equal(d.siuReferral, true);
  assert.equal(d.requiredOutputs.estimate.status, "provisional");
});

// --- Evidence -------------------------------------------------------------------------

test("no vehicle in frame asks for a photo of the car and gives no estimate", () => {
  const x = civicA();
  x.vehicle.vehicle_present = false;
  x.vehicle.vehicle_class = "none";
  x.damage.items = [];
  const d = run(x);
  assert.equal(d.route, "more_evidence");
  assert.equal(d.requiredOutputs.vehicle.make.note, "No vehicle in the photos");
  assert.equal(d.requiredOutputs.estimate.status, "withheld");
});

test("an undamaged car doesn't get invented damage", () => {
  const x = civicA();
  x.damage.no_visible_damage = true;
  x.damage.items = [];
  const d = run(x);
  assert.equal(d.route, "more_evidence");
  assert.deepEqual(firedIds(d), ["E5"]);
  assert.equal(d.requiredOutputs.damageSummary, "No damage visible in these photos.");
});

test("a dark photo is caught by the pixel check even if the AI doesn't mention it", () => {
  const d = run(civicA(), claim(), [{ ...goodPhoto(), brightness: 26 }]);
  assert.equal(d.route, "more_evidence");
  assert.match(d.customerMessage!, /daylight/);
});

test("with several photos, one dark photo doesn't trigger a retake if another is fine", () => {
  const d = run(civicA(), claim(), [{ ...goodPhoto("night.jpg"), brightness: 26 }, goodPhoto("day.jpg")]);
  assert.equal(d.route, "photo_estimate");
});

test("glare reported by the AI asks for another angle", () => {
  const x = civicA();
  x.evidence.photo_issues = ["glare_over_damage"];
  const d = run(x);
  assert.equal(d.route, "more_evidence");
  assert.match(d.customerMessage!, /different angle/);
});

test("black-and-white photo: colour is not determinable rather than guessed", () => {
  const d = run(civicA(), claim(), [{ ...goodPhoto(), greyscale: true }]);
  assert.equal(d.requiredOutputs.vehicle.colour.value, null);
  assert.match(d.requiredOutputs.vehicle.colour.note!, /black-and-white/);
});

test("after the maximum number of photo requests, a person takes over", () => {
  const d = run(closeupB(), claim({ ...DEMO_CLAIMS.B, priorEvidenceRequests: 2 }));
  assert.equal(d.route, "adjuster");
  assert.ok(firedIds(d).includes("E7"));
  assert.equal(d.customerMessage, null);
  assert.equal(d.requiredOutputs.estimate.status, "provisional");
});

// --- Cost ----------------------------------------------------------------------------

// These tests set the price directly, so they price from the AI's numbers.
const AI_PRICING = clampSettings({ pricing: "ai" });

test("a range straddling the fast-path limit stays on the fast path with a review flag", () => {
  const x = civicA();
  x.damage.items[0].cost_low_usd = 1500;
  x.damage.items[0].cost_high_usd = 2400;
  const d = run(x, claim(), [goodPhoto()], AI_PRICING);
  assert.equal(d.route, "photo_estimate");
  assert.equal(d.humanReview.required, true);
  assert.deepEqual(firedIds(d), ["C3"]);
});

test("a range entirely above the fast-path limit goes to an adjuster", () => {
  const x = civicA();
  x.damage.items[0].cost_low_usd = 2600;
  x.damage.items[0].cost_high_usd = 3400;
  assert.ok(firedIds(run(x, claim(), [goodPhoto()], AI_PRICING)).includes("C1"));
});

test("the same damage on a cheap old car reaches the total-loss line", () => {
  const d = run(civicA(), claim({ vehicleValueUsd: 2000, zip: null }));
  assert.equal(d.route, "adjuster");
  assert.ok(firedIds(d).includes("C2"));
});

test("the total-loss line follows the claim's state: a fixed share, the formula, or the carrier's setting", () => {
  const line = (zip: string | null) => run(civicA(), claim({ vehicleValueUsd: 10000, zip })).requiredOutputs.estimate;
  assert.equal(line("75201").totalLossLineUsd, 10000); // Texas, 100%
  assert.equal(line("10001").totalLossLineUsd, 7500); // New York, 75%
  assert.equal(line("43215").totalLossLineUsd, 8000); // Ohio, formula with placeholder 20% salvage
  assert.match(line("43215").totalLossBasis!, /OH uses the total loss formula.*unverified/);
  assert.equal(line("30307").totalLossLineUsd, 6000); // Georgia: no rule on file, so the 60% setting
  assert.equal(line(null).totalLossLineUsd, 6000);
});

test("raising the fast-path limit changes the route without touching the AI output", () => {
  const x = civicA();
  x.damage.items[0].cost_low_usd = 2600;
  x.damage.items[0].cost_high_usd = 3400;
  assert.equal(run(x, claim(), [goodPhoto()], AI_PRICING).route, "adjuster");
  const relaxed = clampSettings({ fastPathLimitUsd: 5000, pricing: "ai" });
  assert.equal(run(x, claim(), [goodPhoto()], relaxed).route, "photo_estimate");
});

// --- Review flags ---------------------------------------------------------------------

test("sensor-area damage flags for review by default, and escalates when the setting says so", () => {
  const x = civicA();
  x.risk_signs.push({ sign: "sensor_zone_damage", evidence: "Rear bumper parking sensor area scuffed" });
  const flagged = run(x);
  assert.equal(flagged.route, "photo_estimate");
  assert.equal(flagged.humanReview.required, true);
  assert.ok(flagged.requiredOutputs.estimate.drivers.some((d) => /recalibration/.test(d.label)));
  const strict = run(x, claim(), [goodPhoto()], clampSettings({ sensorZoneHandling: "adjuster" }));
  assert.equal(strict.route, "adjuster");
});

test("damage on a different side from the customer's description is flagged", () => {
  const d = run(civicA(), claim({ reportedImpactArea: "front" }));
  assert.equal(d.route, "photo_estimate");
  assert.deepEqual(firedIds(d), ["R3"]);
});

test("a car that doesn't match the policy is flagged; silver and grey count as a match", () => {
  const x = civicA();
  assert.deepEqual(firedIds(run(x, claim({ policyVehicle: { ...DEMO_CLAIMS.A.policyVehicle, colour: "Grey" } }))), []);
  x.vehicle.make = "Toyota";
  assert.deepEqual(firedIds(run(x)), ["R2"]);
});

test("possible older damage is flagged", () => {
  const x = civicA();
  x.risk_signs.push({ sign: "possible_prior_damage", evidence: "Rust along the scrape" });
  assert.deepEqual(firedIds(run(x)), ["R4"]);
});

// --- Traceability ---------------------------------------------------------------------

test("every reason cites where its facts came from and which rule applied", () => {
  const d = run(civicA(), claim({ vehicleValueUsd: 2000, zip: null }));
  const c2 = d.reasons.find((r) => r.id === "C2")!;
  const text = c2.citations!.map((c) => `${c.source}: ${c.text}`).join(" | ");
  assert.match(text, /Policy record: Vehicle value: \$2,000/);
  assert.match(text, /Estimate: Range/);
  assert.match(text, /Protocol: Setting "Total-loss line \(where the state sets none\)": 60% of vehicle value/);
  assert.match(text, /Protocol: Rule C2, set by the carrier \(routing protocol v0\.1\)\. When: .+ Then: send it to an adjuster\./);
});

test("policy checks compare the policy with the photos even when nothing fires", () => {
  const d = run(civicA());
  const byLabel = Object.fromEntries(d.policyChecks.map((p) => [p.label, p]));
  assert.equal(byLabel["Insured vehicle"].status, "match");
  assert.equal(byLabel["Colour"].status, "match");
  assert.equal(byLabel["Point of impact"].status, "match");
  assert.match(byLabel["Coverage and deductible"].onFile, /Not checked/);
  const wrong = run(civicA(), claim({ reportedImpactArea: "front" }));
  assert.equal(wrong.policyChecks.find((p) => p.label === "Point of impact")!.status, "mismatch");
  const closeup = run(closeupB(), claim(DEMO_CLAIMS.B));
  assert.equal(closeup.policyChecks.find((p) => p.label === "Insured vehicle")!.status, "not_compared");
});

test("policy checks don't quote a provisional estimate", () => {
  const d = run(closeupB(), claim(DEMO_CLAIMS.B));
  assert.equal(d.requiredOutputs.estimate.status, "provisional");
  const value = d.policyChecks.find((p) => p.label === "Vehicle value")!;
  assert.doesNotMatch(value.observed, /estimate/);
});

test("a reviewer's adjusted range goes back through the rules", () => {
  const x = civicA();
  const c = claim();
  assert.equal(decide(x, c, [goodPhoto()], DEFAULT_SETTINGS).route, "photo_estimate");

  // Straddling the limit keeps the fast path but flags a price check.
  const straddle = decide(x, c, [goodPhoto()], DEFAULT_SETTINGS, { reviewerRange: { lowUsd: 1800, highUsd: 3000 } });
  assert.equal(straddle.route, "photo_estimate");
  assert.ok(firedIds(straddle).includes("C3"));
  assert.equal(straddle.requiredOutputs.estimate.highUsd, 3000);
  assert.match(straddle.requiredOutputs.estimate.drivers[0].label, /Reviewer/);

  // Entirely over the limit goes to an adjuster, and the citation says whose range it was.
  const over = decide(x, c, [goodPhoto()], DEFAULT_SETTINGS, { reviewerRange: { lowUsd: 2800, highUsd: 3400 } });
  assert.equal(over.route, "adjuster");
  const c1 = over.ruleResults.find((r) => r.id === "C1")!;
  assert.ok(c1.fired);
  assert.match(c1.citations!.map((t) => t.text).join(" "), /reviewer's amount/);
});

test("a wide range that runs far past the limit goes to an adjuster, not just a price check", () => {
  const x = civicA();
  const c = claim();
  const wide = decide(x, c, [goodPhoto()], DEFAULT_SETTINGS, { reviewerRange: { lowUsd: 1750, highUsd: 5350 } });
  assert.equal(wide.route, "adjuster");
  assert.ok(firedIds(wide).includes("C4"));
  assert.ok(!firedIds(wide).includes("C3"), "no double counting");
  // Just past the limit stays on the fast path with a price-check flag.
  const narrow = decide(x, c, [goodPhoto()], DEFAULT_SETTINGS, { reviewerRange: { lowUsd: 1750, highUsd: 3500 } });
  assert.equal(narrow.route, "photo_estimate");
  assert.ok(firedIds(narrow).includes("C3"));
  // The protocol owner can loosen it.
  const loose = decide(x, c, [goodPhoto()], { ...DEFAULT_SETTINGS, wideRangeOverLimitPct: 200 }, { reviewerRange: { lowUsd: 1750, highUsd: 5350 } });
  assert.equal(loose.route, "photo_estimate");
});

test("every rule says which facts it checks", () => {
  for (const r of RULES) assert.ok(r.uses.length > 0, r.id);
});

// --- Protocol hygiene ------------------------------------------------------------------

test("settings are always kept inside their bounds", () => {
  const s = clampSettings({ fastPathLimitUsd: 999999, totalLossRatio: 0.1, photoQuality: "nonsense" as never });
  assert.equal(s.fastPathLimitUsd, 10000);
  assert.equal(s.totalLossRatio, 0.5);
  assert.equal(s.photoQuality, "standard");
});

test("rule IDs are unique and every rule reads as plain language", () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of RULES) {
    assert.ok(r.title.length > 3 && r.when.length > 10, r.id);
  }
});

test("protocol text has no em dashes", () => {
  const text = JSON.stringify([RULES.map((r) => [r.title, r.when]), SETTING_DEFS]);
  assert.ok(!text.includes("\u2014") && !text.includes("\u2013"));
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { DEMO_CLAIMS } from "../claims/demo.ts";
import type { CaseItem } from "./cases.ts";
import { demoSecondOpinion } from "./second-opinion.ts";

const withVehicle = (vehicle_class: string, identification_evidence: string): CaseItem =>
  ({
    id: "x",
    claim: DEMO_CLAIMS.C,
    photos: [],
    status: "ready",
    thread: [],
    addedAt: "2026-10-02T10:00:00Z",
    assessment: { ok: true, extraction: { vehicle: { vehicle_class, identification_evidence } } },
  }) as unknown as CaseItem;

test("the demo second opinion on a Formula One car says it isn't covered, without judging the photo", () => {
  const reply = demoSecondOpinion(withVehicle("race_or_non_road", "Formula 1 race cars in a multi-car crash."), null);
  assert.match(reply, /To my knowledge, we don't cover Formula One cars/);
  assert.match(reply, /confirm coverage/);
  assert.doesNotMatch(reply, /photo|Special Investigations/);
});

test("another non-road vehicle gets the same coverage answer in general terms", () => {
  assert.match(demoSecondOpinion(withVehicle("race_or_non_road", "A go-kart on a track."), null), /we don't cover race cars/);
});

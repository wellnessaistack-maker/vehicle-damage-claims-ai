import { test } from "node:test";
import assert from "node:assert/strict";

import { DEMO_CLAIMS } from "../claims/demo.ts";
import type { CaseItem } from "./cases.ts";
import { agreementOf, logCsv, logEntry, summarize, testCaseRow } from "./review-log.ts";
import { DEFAULT_SETTINGS } from "../policy/protocol.ts";

test("approving or handing off with the recommended route counts as agreement", () => {
  assert.equal(agreementOf("photo_estimate", { action: "approved", route: "photo_estimate" }), "kept");
  assert.equal(agreementOf("adjuster", { action: "handed_off", route: "adjuster" }), "kept");
  assert.equal(agreementOf("more_evidence", { action: "message_sent", route: "more_evidence" }), "kept");
});

test("a new range is an adjustment, unless it moves the claim to another route", () => {
  const range = { lowUsd: 1200, highUsd: 1900 };
  assert.equal(agreementOf("photo_estimate", { action: "approved", route: "photo_estimate", adjustedRange: range }), "adjusted_range");
  assert.equal(agreementOf("photo_estimate", { action: "assigned_adjuster", route: "adjuster", adjustedRange: { lowUsd: 3000, highUsd: 4200 } }), "changed_route");
});

test("changing the route is always a disagreement", () => {
  assert.equal(agreementOf("more_evidence", { action: "route_changed", route: "adjuster" }), "changed_route");
});

const item = (claimId: string): CaseItem => ({
  id: claimId,
  claim: { ...DEMO_CLAIMS.A, claimId },
  photos: [{ name: "a.jpg", source: "upload" } as CaseItem["photos"][number]],
  status: "done",
  thread: [],
  addedAt: "2026-09-30T10:00:00Z",
});

test("the log totals agreement and exports one CSV row per decision", () => {
  const log = [
    logEntry(item("C-1"), { action: "approved", route: "photo_estimate", summary: "", at: "t1" }, null),
    logEntry(item("C-2"), { action: "route_changed", route: "adjuster", summary: "", reason: 'Frame damage, "clearly" structural', at: "t2" }, null),
  ];
  // With no decision the recommendation is manual triage, so both differ here; set one to agree.
  log[0] = { ...log[0], recommendedRoute: "photo_estimate", agreement: "kept" };
  assert.deepEqual(summarize(log), { total: 2, kept: 1, adjusted: 0, changed: 1 });
  const csv = logCsv(log).trim().split("\n");
  assert.equal(csv.length, 3);
  assert.match(csv[0], /^claim_id,decided_at,reviewer,recommended_route,final_route,agreement/);
  assert.match(csv[2], /"Frame damage, ""clearly"" structural"/, "commas and quotes are escaped");
});

test("a disagreement becomes a test case row in the eval format", () => {
  const e = logEntry(item("C-3"), { action: "route_changed", route: "adjuster", summary: "", reason: "Airbag, deployed", at: "t" }, null);
  const cols = testCaseRow(e, DEFAULT_SETTINGS).trim().split(",");
  assert.equal(cols.length, 16);
  assert.equal(cols[0], "REVIEW_C-3");
  assert.equal(cols[5], "adjuster");
  assert.equal(cols[13], "Airbag; deployed");
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { DEMO_CLAIMS } from "../claims/demo.ts";
import type { Decision } from "../policy/engine.ts";
import { channels, customerUpdate, defaultChannel, followUpDate, preview, reminder, sentVia } from "./customer.ts";

const decision = (route: Decision["route"]) => ({ route }) as Decision;

test("the adjuster update is neutral: no total loss, fraud or SIU", () => {
  const m = customerUpdate(decision("adjuster"), DEMO_CLAIMS.E)!;
  assert.match(m, /Hi Tom/);
  assert.match(m, /adjusters will contact you/);
  assert.doesNotMatch(m, /total loss|fraud|SIU|investigat|reused/i);
});

test("the photo estimate update says what happens next", () => {
  assert.match(customerUpdate(decision("photo_estimate"), DEMO_CLAIMS.A)!, /estimating team/);
  assert.equal(customerUpdate(decision("more_evidence"), DEMO_CLAIMS.B), null, "the photo request comes from the rules instead");
});

test("channel follows the customer's preference and what's on file", () => {
  assert.deepEqual(channels(DEMO_CLAIMS.A), ["text", "email"]);
  assert.equal(defaultChannel(DEMO_CLAIMS.A), "text");
  assert.equal(defaultChannel(DEMO_CLAIMS.C), "email");
  assert.equal(defaultChannel({ ...DEMO_CLAIMS.A, contact: { phone: null, email: "a@example.com", preferred: "text" } }), "email");
  assert.equal(defaultChannel({ ...DEMO_CLAIMS.A, contact: undefined }), null);
  assert.equal(sentVia(DEMO_CLAIMS.B, "text"), "Texted Daniel at (555) 010-0187");
});

test("follow-up is two business days later, skipping the weekend", () => {
  assert.equal(followUpDate("2026-10-01T15:00:00").getDate(), 5); // Thursday -> Monday
  assert.equal(followUpDate("2026-09-28T15:00:00").getDate(), 30); // Monday -> Wednesday
});

test("thread previews skip the greeting and sign-off", () => {
  const p = preview(reminder(DEMO_CLAIMS.B));
  assert.match(p, /^A quick reminder/);
  assert.ok(p.length <= 160);
});

test("a one-line message that starts with a greeting is kept", () => {
  assert.equal(preview("Hi Grace, an adjuster will call you tomorrow."), "Hi Grace, an adjuster will call you tomorrow.");
  assert.equal(preview("Hi Grace,\n\nAn adjuster will call.\n\nThanks,\nYour claims team"), "An adjuster will call.");
});

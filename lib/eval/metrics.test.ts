import { test } from "node:test";
import assert from "node:assert/strict";

import { fieldScore, plausibleLow } from "./metrics.ts";

test("a perfect score on a small set still has a wide plausible range", () => {
  assert.equal(Math.round(plausibleLow(11, 11)! * 100), 74);
  assert.equal(Math.round(plausibleLow(100, 100)! * 100), 96);
  assert.equal(plausibleLow(0, 0), null);
});

test("vehicle fields: not guessing counts as right when the label says it can't be told", () => {
  assert.equal(fieldScore("CANT_TELL", null), "correctly_unknown");
  assert.equal(fieldScore("CANT_TELL", "Toyota"), "guessed");
  assert.equal(fieldScore("Silver", "Grey"), "correct");
  assert.equal(fieldScore("Golf|Bora", "Golf"), "correct");
  assert.equal(fieldScore("Honda", "Toyota"), "wrong");
});

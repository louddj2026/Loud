import assert from "node:assert/strict";
import test from "node:test";
import {
  claimTransitionManualEq,
  mergeTransitionAutomatedEq,
} from "../lib/transition-eq-ownership.ts";

const current = { low: -12, mid: -6, high: 2 };
const automated = { low: -60, mid: -3, high: 0 };

test("automation owns all EQ bands until the operator claims one", () => {
  assert.deepEqual(mergeTransitionAutomatedEq({}, "A", current, automated), automated);
});

test("manual ownership is immutable, per deck, and limited to changed EQ bands", () => {
  const initial = {};
  const afterA = claimTransitionManualEq(initial, "A", { mid: -6, volume: 0.8 });
  const afterB = claimTransitionManualEq(afterA, "B", { low: -60 });

  assert.deepEqual(initial, {});
  assert.deepEqual(afterA, { A: { mid: true } });
  assert.deepEqual(afterB, { A: { mid: true }, B: { low: true } });
  assert.equal(claimTransitionManualEq(afterB, "C", {}), afterB);
});

test("a manually owned band keeps its live value while the remaining bands follow automation", () => {
  const ownership = claimTransitionManualEq({}, "A", { mid: current.mid });

  assert.deepEqual(mergeTransitionAutomatedEq(ownership, "A", current, automated), {
    low: automated.low,
    mid: current.mid,
    high: automated.high,
  });
  assert.deepEqual(mergeTransitionAutomatedEq(ownership, "B", current, automated), automated);
});

test("claiming all three bands gives the operator complete EQ ownership", () => {
  const ownership = claimTransitionManualEq({}, "C", current);

  assert.deepEqual(mergeTransitionAutomatedEq(ownership, "C", current, automated), current);
  assert.deepEqual(current, { low: -12, mid: -6, high: 2 });
  assert.deepEqual(automated, { low: -60, mid: -3, high: 0 });
});

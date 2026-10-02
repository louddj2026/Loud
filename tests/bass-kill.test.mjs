import assert from "node:assert/strict";
import test from "node:test";
import { bassKillDeck, nextBassOverride, overriddenBassLow } from "../lib/bass-kill.ts";

test("top-row and numpad bass keys address A, B and C independently", () => {
  for (const [digit, deck] of [[5, "A"], [6, "B"], [7, "C"]]) {
    assert.equal(bassKillDeck(`Digit${digit}`), deck);
    assert.equal(bassKillDeck(`Numpad${digit}`), deck);
  }
  assert.equal(bassKillDeck("Digit8"), null);
});

test("a manual kill survives preroll, bass swaps and the handoff restore", () => {
  const held = nextBassOverride(undefined, 0);
  for (const automatedLow of [-60, -24, -12, -6, 0, 3]) {
    assert.equal(overriddenBassLow(automatedLow, held), -60);
  }
});

test("the second press opens bass even when automation still wants it killed", () => {
  const held = nextBassOverride("kill", -60);
  assert.equal(held, "live");
  assert.equal(overriddenBassLow(-60, held), 0);
  assert.equal(nextBassOverride(held, 0), "kill");
  assert.equal(nextBassOverride(undefined, -60), "live");
});

test("manual restoration preserves the previous dial level outside a mix", () => {
  assert.equal(overriddenBassLow(-60, "live", -8), -8);
  assert.equal(overriddenBassLow(-14, undefined), -14);
});

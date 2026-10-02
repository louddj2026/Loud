import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findEntryCueCandidates, findExitCueCandidates } from "../lib/demo-set.ts";
import { assessLiveCandidate } from "../lib/live-crate.ts";

const load = (id) => readFile(new URL(`../public/analysis/${id}.json`, import.meta.url), "utf8").then(JSON.parse);

test("live phrase pairing considers an earlier outgoing bass hole against a late incoming phrase hole without forcing it", async () => {
  const [aphid, setherian] = await Promise.all([
    load("elements-fff7883388bb72"),
    load("elements-e41e33e7ac8c97"),
  ]);

  const aphidHole = findExitCueCandidates(aphid, { allowEarlyExit: true })
    .find((cue) => Math.abs(cue.time - 281.151) < .1);
  const setherianHoleEnd = findEntryCueCandidates(setherian, { allowLateEntry: true })
    .find((cue) => Math.abs(cue.time - 438.607) < .1);
  assert.ok(aphidHole, "the 4:41 Aphid Moon phrase boundary should be a live exit candidate");
  assert.ok(setherianHoleEnd, "the 7:18 Setherian phrase boundary around the reported 7:13 hole should be a live entry candidate");

  const result = assessLiveCandidate(
    { id: aphid.track.id, name: aphid.track.name, analysis: aphid },
    { id: setherian.track.id, name: setherian.track.name, analysis: setherian },
    { outgoingNotBefore: 250 },
  );

  assert.equal(result.accepted, true);
  const reportedOption = result.phraseAlternatives.find((option) =>
    Math.abs(option.exitHandoff - 281.151) < .1
    && Math.abs(option.entryDrop - 438.607) < .1);
  assert.ok(reportedOption, "the reported pair should survive into the assessed live options");
  assert.ok(reportedOption.bassSimilarity > .95);
  assert.ok([32, 64].includes(reportedOption.runwayBeats));
  assert.ok([64, 128].includes(reportedOption.blendBeats));
});

test("an incoming Aphid Moon cue preserves enough active tune for its 7:18 phrase exit to remain an option", async () => {
  const [setherian, aphid] = await Promise.all([
    load("elements-e41e33e7ac8c97"),
    load("elements-fff7883388bb72"),
  ]);
  const result = assessLiveCandidate(
    { id: setherian.track.id, name: setherian.track.name, analysis: setherian },
    { id: aphid.track.id, name: aphid.track.name, analysis: aphid },
  );
  const laterGap = findExitCueCandidates(aphid, { allowEarlyExit: true })
    .find((cue) => Math.abs(cue.time - 438.866) < .1);

  assert.equal(result.accepted, true);
  assert.ok(result.plan.tracks[1].entryDrop < 300, "Aphid Moon should not enter after most of its useful playing arc has passed");
  assert.ok(result.incomingActiveBassKickBeats >= 128);
  assert.ok(result.incomingNextExitHandoff !== null);
  assert.ok(laterGap, "the phrase gap around 7:17 should remain available to the later next-tune search");
  assert.ok(laterGap.time - result.plan.tracks[1].entryDrop > 100);
});

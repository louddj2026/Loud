import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { analyzeBeatGrid } from "../lib/beat-grid.ts";

const beatGridSource = await readFile(new URL("../lib/beat-grid.ts", import.meta.url), "utf8");

function syntheticTrack(bpm, { duration = 28, sampleRate = 4000, offset = 0.137, drift = 0, hatLevel = 0.12 } = {}) {
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  const basePeriod = 60 / bpm;
  let time = offset;
  let beat = 0;
  while (time < duration - 0.2) {
    const downbeat = beat % 4 === 0;
    const kickLength = Math.floor(sampleRate * 0.13);
    for (let index = 0; index < kickLength; index += 1) {
      const envelope = Math.exp(-index / (sampleRate * 0.035));
      samples[Math.floor(time * sampleRate) + index] += Math.sin(2 * Math.PI * 58 * index / sampleRate) * envelope * (downbeat ? 1 : 0.82);
    }
    if (beat % 4 === 1 || beat % 4 === 3) {
      const snareAt = Math.floor(time * sampleRate);
      for (let index = 0; index < sampleRate * 0.045; index += 1) {
        const deterministicNoise = Math.sin(index * 12.9898 + beat * 7.13) * Math.sin(index * 3.77 + 0.4);
        samples[snareAt + index] += deterministicNoise * Math.exp(-index / (sampleRate * 0.012)) * 0.34;
      }
    }
    for (const fraction of [0.5]) {
      const hatAt = Math.floor((time + basePeriod * fraction) * sampleRate);
      for (let index = 0; index < sampleRate * 0.018 && hatAt + index < samples.length; index += 1) {
        samples[hatAt + index] += Math.sin(index * 19.71) * Math.exp(-index / (sampleRate * 0.004)) * hatLevel;
      }
    }
    beat += 1;
    time += basePeriod * (1 + drift * beat / Math.max(1, duration / basePeriod));
  }
  return { samples, sampleRate, offset };
}

function syntheticPhraseTrack(bpm = 120, { duration = 84, sampleRate = 4000, offset = 0.137 } = {}) {
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  const period = 60 / bpm;
  const phraseLevels = [0.55, 1, 0.7, 1.15, 0.62];
  let beat = 0;
  for (let time = offset; time < duration - 0.2; time = offset + ++beat * period) {
    const phrase = Math.floor(beat / 32);
    const phraseLevel = phraseLevels[phrase % phraseLevels.length];
    const downbeat = beat % 4 === 0;
    for (let index = 0; index < sampleRate * 0.13; index += 1) {
      const envelope = Math.exp(-index / (sampleRate * 0.035));
      samples[Math.floor(time * sampleRate) + index] += Math.sin(2 * Math.PI * 58 * index / sampleRate) * envelope * phraseLevel * (downbeat ? 1 : 0.82);
    }
    if (beat % 32 === 0) {
      for (let index = 0; index < sampleRate * 0.35; index += 1) {
        const envelope = Math.exp(-index / (sampleRate * 0.1));
        samples[Math.floor(time * sampleRate) + index] += Math.sin(2 * Math.PI * 720 * index / sampleRate) * envelope * 0.55;
      }
    }
    if (phrase % 2 === 1 && beat % 2 === 1) {
      for (let index = 0; index < sampleRate * 0.025; index += 1) {
        samples[Math.floor(time * sampleRate) + index] += Math.sin(2 * Math.PI * 1100 * index / sampleRate) * Math.exp(-index / (sampleRate * 0.008)) * 0.18;
      }
    }
  }
  return { samples, sampleRate, offset, period };
}

function syntheticHalfBarCrashReset({ sustained = true } = {}) {
  const bpm = 120;
  const duration = 54;
  const sampleRate = 4000;
  const offset = 0.137;
  const period = 60 / bpm;
  const resetBeat = 66;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  const modelBeats = [];
  const modelDownbeats = [];
  for (let beat = 0, time = offset; time < duration - .4; beat += 1, time = offset + beat * period) {
    modelBeats.push(Math.round(time * 50) / 50);
    if (beat % 4 === 0) modelDownbeats.push(Math.round(time * 50) / 50);
    const level = beat < resetBeat ? .58 : 1.08;
    const start = Math.floor(time * sampleRate);
    for (let index = 0; index < sampleRate * .13 && start + index < samples.length; index += 1) {
      samples[start + index] += Math.sin(2 * Math.PI * 58 * index / sampleRate) * Math.exp(-index / (sampleRate * .035)) * level;
    }
    const hatStart = Math.floor((time + period / 2) * sampleRate);
    for (let index = 0; index < sampleRate * .018 && hatStart + index < samples.length; index += 1) {
      samples[hatStart + index] += Math.sin(index * 18.73 + beat) * Math.exp(-index / (sampleRate * .004)) * .16;
    }
  }
  const crashTime = offset + resetBeat * period;
  const crashStart = Math.floor(crashTime * sampleRate);
  const length = Math.floor(sampleRate * (sustained ? .9 : .035));
  const decay = sampleRate * (sustained ? .24 : .006);
  for (let index = 0; index < length && crashStart + index < samples.length; index += 1) {
    const noise = Math.sin(index * 12.9898 + .4) * Math.sin(index * 33.731 + 1.7);
    samples[crashStart + index] += noise * Math.exp(-index / decay) * .85;
  }
  return { samples, sampleRate, modelBeats, modelDownbeats, crashTime };
}

for (const bpm of [60, 72.3, 96, 120, 128, 138, 145.1, 150, 174]) {
  test(`maps the kick grid at ${bpm} BPM`, () => {
    const fixture = syntheticTrack(bpm);
    const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate);
    assert.ok(Math.abs(analysis.selected.bpm - bpm) < 0.35, `${analysis.selected.bpm} BPM selected`);
    const strong = analysis.beats.filter((beat) => beat.confidence >= 0.4 && beat.attackTime !== null);
    assert.ok(strong.length >= Math.floor(analysis.duration / (60 / bpm) * 0.7));
    assert.ok(Math.abs(analysis.selected.medianResidualMs) < 15, `${analysis.selected.medianResidualMs} ms median`);
    assert.ok(analysis.hypotheses.length >= 2);
  });
}

test("keeps half and double tempo alternatives instead of discarding ambiguity", () => {
  const fixture = syntheticTrack(145.1);
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate);
  assert.ok(analysis.hypotheses.some((hypothesis) => Math.abs(hypothesis.bpm - 72.55) < 0.8));
});

test("places the nominal phase on the kick attacks", () => {
  const fixture = syntheticTrack(138, { offset: 0.219 });
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate);
  const residuals = analysis.beats.filter((beat) => beat.residualMs !== null && beat.confidence >= 0.5).map((beat) => Math.abs(beat.residualMs));
  assert.ok(residuals.length > 30);
  assert.ok(residuals.sort((a, b) => a - b)[Math.floor(residuals.length * 0.9)] < 22);
});

test("only marks a clean repeated kick grid as verified", () => {
  const fixture = syntheticTrack(145.1, { duration: 36 });
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate);
  assert.equal(analysis.verification.status, "verified");
  assert.equal(analysis.verification.reviewBlocks, 0);
  assert.ok(analysis.verification.verifiedBeatCoverage > 0.98);
  assert.equal(analysis.kickWaveformDetailed.length, analysis.lowWaveformDetailed.length);
});

test("strong offbeat high percussion cannot become the kick grid", () => {
  const bpm = 145.1;
  const fixture = syntheticTrack(bpm, { duration: 36, hatLevel: 1.1 });
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate);
  assert.ok(Math.abs(analysis.selected.bpm - bpm) < 0.25, `${analysis.selected.bpm} BPM selected`);
  const residuals = analysis.beats.filter((beat) => beat.attackTime !== null && beat.confidence >= 0.4).map((beat) => Math.abs(beat.residualMs));
  assert.ok(residuals.length > 40);
  residuals.sort((left, right) => left - right);
  assert.ok(residuals[Math.floor(residuals.length / 2)] < 12);
});

test("a louder offbeat bassline cannot pull the grid half a beat away from the kicks", () => {
  const bpm = 145;
  const duration = 44;
  const fixture = syntheticTrack(bpm, { duration, offset: 0.18, hatLevel: 0.08 });
  const period = 60 / bpm;
  const modelBeats = [];
  const modelDownbeats = [];
  for (let beat = 0, time = fixture.offset; time < duration - 0.25; beat += 1, time = fixture.offset + beat * period) {
    modelBeats.push(Math.round(time * 50) / 50);
    if (beat % 4 === 0) modelDownbeats.push(Math.round(time * 50) / 50);
    const bassTime = time + period / 2;
    const bassStart = Math.floor(bassTime * fixture.sampleRate);
    for (let index = 0; index < fixture.sampleRate * 0.18 && bassStart + index < fixture.samples.length; index += 1) {
      const attack = 1 - Math.exp(-index / (fixture.sampleRate * 0.018));
      const decay = Math.exp(-index / (fixture.sampleRate * 0.075));
      fixture.samples[bassStart + index] += Math.sin(2 * Math.PI * 67 * index / fixture.sampleRate) * attack * decay * 1.65;
    }
  }
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate, { modelBeats, modelDownbeats });
  const distances = analysis.beats.map((beat) => Math.min(...modelBeats.map((time) => Math.abs(time - beat.time))) * 1000).sort((left, right) => left - right);
  assert.ok(distances[Math.floor(distances.length / 2)] < 22, `median kick error ${distances[Math.floor(distances.length / 2)].toFixed(1)} ms`);
  assert.ok(analysis.beats.every((beat) => beat.kickStatus && Number.isFinite(beat.auditStrength)), "every grid beat must be audited");
  const corrections = analysis.beats.map((beat) => Math.abs(beat.time - beat.nominalTime) * 1000);
  assert.ok(Math.max(...corrections) < 121, "kick refinement must never reach the half-beat phase");
});

test("a weaker secondary transient cannot make a wrong phase pass verification", () => {
  const bpm = 145.1;
  const duration = 40;
  const fixture = syntheticTrack(bpm, { duration, offset: 0.16 });
  const period = 60 / bpm;
  const trueBeats = [];
  const falseModelBeats = [];
  const falseModelDownbeats = [];
  for (let beat = 0, time = fixture.offset; time < duration - 0.2; beat += 1, time = fixture.offset + beat * period) {
    trueBeats.push(time);
    const secondary = time + 0.1;
    for (let index = 0; index < fixture.sampleRate * 0.08 && Math.floor(secondary * fixture.sampleRate) + index < fixture.samples.length; index += 1) {
      fixture.samples[Math.floor(secondary * fixture.sampleRate) + index] += Math.sin(2 * Math.PI * 66 * index / fixture.sampleRate) * Math.exp(-index / (fixture.sampleRate * 0.025)) * 0.3;
    }
    const proposal = Math.round(secondary * 50) / 50;
    falseModelBeats.push(proposal);
    if (beat % 4 === 0) falseModelDownbeats.push(proposal);
  }
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate, { modelBeats: falseModelBeats, modelDownbeats: falseModelDownbeats });
  const verified = analysis.verification.blocks.filter((block) => block.status === "verified");
  assert.ok(verified.length > 1);
  for (const block of verified) {
    const residuals = analysis.beats.filter((beat) => beat.time >= block.start && beat.time <= block.end).map((beat) => Math.min(...trueBeats.map((time) => Math.abs(time - beat.time))) * 1000).sort((left, right) => left - right);
    assert.ok(residuals[Math.floor(residuals.length / 2)] < 25, `false-green block at ${block.start.toFixed(1)}s`);
  }
});

test("weak sections are marked uncertain rather than inventing kick precision", () => {
  const fixture = syntheticTrack(128, { duration: 24 });
  fixture.samples.fill(0, Math.floor(8 * fixture.sampleRate), Math.floor(12 * fixture.sampleRate));
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate);
  assert.ok(analysis.uncertainty.some((region) => region.start < 10 && region.end > 10));
});

test("long passages without kick evidence cannot re-phase the grid", () => {
  const fixture = syntheticTrack(128, { duration: 48 });
  fixture.samples.fill(0, Math.floor(10 * fixture.sampleRate), Math.floor(30 * fixture.sampleRate));
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate);
  assert.ok(analysis.verification.blocks.some((block) => block.status === "no-evidence" && block.start < 24 && block.end > 16));
  const intervals = analysis.beats.slice(1).map((beat, index) => beat.time - analysis.beats[index].time);
  const expected = 60 / 128;
  assert.ok(Math.max(...intervals.map((interval) => Math.abs(interval - expected))) < 0.012);
});

test("a musical beat model establishes continuity before low-end refinement", () => {
  const bpm = 145.1;
  const fixture = syntheticTrack(bpm, { duration: 32, offset: 0.173 });
  const period = 60 / bpm;
  const modelBeats = [];
  const modelDownbeats = [];
  for (let beat = 0, time = fixture.offset; time < 32; beat += 1, time = fixture.offset + beat * period) {
    const quantised = Math.round((time + (beat % 5 === 0 ? 0.006 : -0.004)) * 50) / 50;
    modelBeats.push(quantised);
    if (beat % 4 === 0) modelDownbeats.push(quantised);
  }
  modelBeats.splice(31, 0, modelBeats[30] + period / 2);
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate, { modelBeats, modelDownbeats });
  assert.equal(analysis.evidenceMode, "beat-model-plus-multiband");
  assert.ok(Math.abs(analysis.selected.bpm - bpm) < 0.2, `${analysis.selected.bpm} BPM selected`);
  assert.ok(analysis.selected.medianResidualMs < 14);
  assert.ok(analysis.downbeats[0].probability > analysis.downbeats[1].probability);
  const intervals = analysis.beats.slice(1).map((beat, index) => beat.time - analysis.beats[index].time);
  const middle = [...intervals].sort((left, right) => left - right)[Math.floor(intervals.length / 2)];
  assert.ok(Math.max(...intervals.map((interval) => Math.abs(interval - middle))) < 0.012, "an isolated model error must not create a one-beat jump");
});

test("independent kick evidence rejects a model's spurious fast intro", () => {
  const fixture = syntheticTrack(146, { duration: 224, offset: .14 });
  const modelBeats = [];
  for (const [start, end, bpm] of [[0, 96, 150.873], [96, 224, 146]]) {
    for (let time = start + .14; time < end; time += 60 / bpm) modelBeats.push(Math.round(time * 50) / 50);
  }
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate, { modelBeats });
  assert.ok(analysis.tempoSectionEvidence?.some(check => check.decision === "contradicted-by-kicks"));
  assert.ok(analysis.tempoSections.every(section => Math.abs(section.bpm - 146) < .1), JSON.stringify({ sections: analysis.tempoSections, evidence: analysis.tempoSectionEvidence }));
  const errors = [];
  for (let time = 20 * 60 / 146 + .14; time < 90; time += 60 / 146) {
    errors.push(Math.min(...analysis.beats.map(beat => Math.abs(beat.time - time))));
  }
  errors.sort((a,b) => a-b);
  assert.ok(errors[Math.floor(errors.length * .9)] < .025, `90th percentile grid error ${errors[Math.floor(errors.length*.9)]}`);
});

test("one anomalous model window cannot create a separate intro tempo", () => {
  const bpm = 146;
  const fixture = syntheticTrack(bpm, { duration: 96, offset: .14 });
  const modelBeats = [];
  for (const [start, end, localBpm] of [[0, 16, 144.097], [16, 96, bpm]]) {
    for (let time = start + .14; time < end; time += 60 / localBpm) {
      modelBeats.push(Math.round(time * 50) / 50);
    }
  }
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate, { modelBeats });
  assert.equal(analysis.tempoSections.length, 1, JSON.stringify(analysis.tempoSections));
  assert.ok(Math.abs(analysis.tempoSections[0].bpm - bpm) < .1, JSON.stringify(analysis.tempoSections));
  assert.equal(analysis.tempoSectionEvidence?.[0].decision, "unconfirmed-edge");
  const intervals = analysis.beats.slice(1).map((beat, index) => beat.time - analysis.beats[index].time);
  assert.ok(Math.max(...intervals.map(interval => Math.abs(interval - 60 / bpm))) < .012,
    "an unconfirmed intro estimate must not create a boundary jump");
});

test("a short real tempo intro with independent support is preserved", () => {
  const sampleRate = 4000;
  const intro = syntheticTrack(120, { duration: 16, sampleRate, offset: .14 });
  const body = syntheticTrack(146, { duration: 80, sampleRate, offset: .14 });
  const samples = new Float32Array(96 * sampleRate);
  samples.set(intro.samples, 0);
  samples.set(body.samples, 16 * sampleRate);
  const modelBeats = [];
  for (const [start, end, bpm] of [[0, 16, 120], [16, 96, 146]]) {
    for (let time = start + .14; time < end; time += 60 / bpm) modelBeats.push(Math.round(time * 50) / 50);
  }
  const analysis = analyzeBeatGrid(samples, sampleRate, { modelBeats });
  assert.ok(analysis.tempoSections.length >= 2, JSON.stringify({ sections: analysis.tempoSections, evidence: analysis.tempoSectionEvidence }));
  assert.ok(analysis.tempoSections.some(section => Math.abs(section.bpm - 120) < .5));
  assert.ok(analysis.tempoSections.some(section => Math.abs(section.bpm - 146) < .5));
  assert.notEqual(analysis.tempoSectionEvidence?.[0].decision, "unconfirmed-edge");
});

test("sustained grid-speed changes become separate tempo sections", () => {
  const sampleRate = 4000;
  const first = syntheticTrack(120, { duration: 40, sampleRate, offset: 0.14 });
  const second = syntheticTrack(150, { duration: 40, sampleRate, offset: 0.14 });
  const samples = new Float32Array(80 * sampleRate);
  samples.set(first.samples, 0);
  samples.set(second.samples, 40 * sampleRate);
  const modelBeats = [];
  const modelDownbeats = [];
  for (const [start, bpm] of [[0, 120], [40, 150]]) {
    const period = 60 / bpm;
    for (let beat = 0, time = start + 0.14; time < start + 40; beat += 1, time = start + 0.14 + beat * period) {
      modelBeats.push(Math.round(time * 50) / 50);
      if (beat % 4 === 0) modelDownbeats.push(Math.round(time * 50) / 50);
    }
  }
  const analysis = analyzeBeatGrid(samples, sampleRate, { modelBeats, modelDownbeats });
  assert.ok(analysis.tempoSections.length >= 2, JSON.stringify(analysis.tempoSections));
  assert.ok(analysis.tempoSections.some((section) => Math.abs(section.bpm - 120) < 0.5));
  assert.ok(analysis.tempoSections.some((section) => Math.abs(section.bpm - 150) < 0.5));
  assert.equal(analysis.mode, "piecewise");
});

test("structural phrase beginnings become kick-anchored downbeats", () => {
  const fixture = syntheticPhraseTrack();
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate);
  assert.ok(analysis.phrases.length >= 3, `${analysis.phrases.length} phrase sections found`);
  const phraseStarts = analysis.beats.filter((beat) => beat.isPhraseStart);
  assert.equal(phraseStarts.length, analysis.phrases.length);
  assert.ok(phraseStarts.every((beat) => beat.isDownbeat), "every phrase start is also a bar downbeat");
  assert.ok(phraseStarts.some((beat) => Math.abs(beat.time - (fixture.offset + 32 * fixture.period)) < 0.03), "the first 32-beat structure change is identified");
  const audibleAnchors = phraseStarts.filter((beat) => beat.attackTime !== null);
  assert.ok(audibleAnchors.length >= 2);
  assert.ok(audibleAnchors.every((beat) => Math.abs(beat.attackTime - beat.time) < 0.015), "phrase anchors remain on the local kick attack");
});

test("a sustained crash can correct a structural phrase anchor by half a bar", () => {
  const fixture = syntheticHalfBarCrashReset();
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate, { modelBeats: fixture.modelBeats, modelDownbeats: fixture.modelDownbeats });
  const crashPhrase = analysis.phrases.find((phrase) => phrase.reason === "crash-confirmed" && Math.abs(phrase.start - fixture.crashTime) < .08);
  assert.ok(crashPhrase, `expected crash-confirmed phrase near ${fixture.crashTime.toFixed(3)}s; got ${analysis.phrases.map((phrase) => `${phrase.start.toFixed(3)}:${phrase.reason}`).join(", ")}`);
  const crashBeat = analysis.beats.reduce((nearest, beat) => Math.abs(beat.time - fixture.crashTime) < Math.abs(nearest.time - fixture.crashTime) ? beat : nearest, analysis.beats[0]);
  assert.equal(crashBeat.isPhraseStart, true);
  assert.equal(crashBeat.isDownbeat, false, "the crash correction must not require the model's existing bar rotation");
});

test("a short hat cannot move a structural phrase anchor off its downbeat", () => {
  const fixture = syntheticHalfBarCrashReset({ sustained: false });
  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate, { modelBeats: fixture.modelBeats, modelDownbeats: fixture.modelDownbeats });
  const targetBeat = analysis.beats.reduce((nearest, beat) => Math.abs(beat.time - fixture.crashTime) < Math.abs(nearest.time - fixture.crashTime) ? beat : nearest, analysis.beats[0]);
  assert.equal(targetBeat.isPhraseStart, false, JSON.stringify({ targetBeat, phrases: analysis.phrases }));
  assert.ok(!analysis.phrases.some((phrase) => phrase.reason === "crash-confirmed" && Math.abs(phrase.start - fixture.crashTime) < .08));
});

test("the grid follows a tune that drifts, instead of averaging it away", () => {
  // The beat tracker reports where every beat actually is. Fitting one BPM to
  // that and regenerating phase + n * period throws the report away: on a tune
  // locked to a click the two agree, and on one that drifts the metronome
  // splits the difference and is wrong at both ends. This is that case.
  const bpm = 145, duration = 60, drift = .03;
  const fixture = syntheticTrack(bpm, { duration, drift, offset: .137 });
  // The true beat positions, generated exactly as the audio was.
  const basePeriod = 60 / bpm;
  const truth = [];
  for (let time = fixture.offset, beat = 0; time < duration - .2; beat += 1) {
    truth.push(time);
    time += basePeriod * (1 + drift * beat / Math.max(1, duration / basePeriod));
  }
  // The model sees them on its 20 ms frame grid, quantisation noise and all.
  const modelBeats = truth.map((time) => Math.round(time * 50) / 50);
  const modelDownbeats = truth.filter((_, beat) => beat % 4 === 0).map((time) => Math.round(time * 50) / 50);

  const analysis = analyzeBeatGrid(fixture.samples, fixture.sampleRate, { modelBeats, modelDownbeats });
  const worst = truth.reduce((max, time) => {
    const nearest = analysis.beats.reduce((best, beat) =>
      Math.abs(beat.time - time) < Math.abs(best - time) ? beat.time : best, Infinity);
    return Math.max(max, Math.abs(nearest - time));
  }, 0);
  // A single fitted tempo across a 3% drift leaves the ends tens of ms out; a
  // grid that follows the trajectory stays inside a couple of frames.
  assert.ok(worst < .05, `worst beat is ${(worst * 1000).toFixed(0)}ms from where the tune actually plays it`);

  // And the grid must not have become a metronome again: real drift means the
  // intervals genuinely change across the track.
  const gaps = analysis.beats.slice(1).map((beat, index) => beat.time - analysis.beats[index].time);
  const early = gaps.slice(0, 24).reduce((s, v) => s + v, 0) / 24;
  const late = gaps.slice(-24).reduce((s, v) => s + v, 0) / 24;
  assert.ok(late > early, `grid did not speed up: ${early.toFixed(4)}s -> ${late.toFixed(4)}s per beat`);
});

test("the anchor may move the grid as far as it can see the kick", () => {
  // The move used to be capped at a flat 120 ms while dominantKickPhase looked
  // out to 47% of a beat. At 143 BPM that cap sat at 29% of a beat, so a grid
  // landing further out had its offset measured, reported in auditOffsetMs,
  // and then discarded — the correction returned 0 and the grid never moved.
  const source = beatGridSource;
  assert.match(source, /const maxMove = period \* MAX_ANCHOR_MOVE_FRACTION;/);
  assert.match(source, /&& move <= maxMove/);
  assert.doesNotMatch(source, /&& Math\.abs\(phase\.offset\) <= 0\.12/);
  // Distance is what protects against snapping onto the offbeat, not evidence.
  // A candidate beyond ~36% of a beat is usually the offbeat bassline, and it
  // arrives with crushing dominance because the offbeat is a real periodic
  // event — measured across the library, one such candidate carried a
  // dominance of 8.6 while pointing 45% of a beat away from a grid that was
  // already correct. Dominance cannot tell those apart; distance can.
  assert.match(source, /const MAX_ANCHOR_MOVE_FRACTION = \.36;/);
  assert.ok(.36 < .5, "the anchor bound must stop short of the offbeat");
  // Coverage was the guard actually refusing the library: the floor sat at
  // 0.35 while well-placed tracks averaged 0.264 and badly-placed ones 0.209,
  // so it turned away tracks holding a spread of 0.019 and a dominance of 9.7.
  assert.match(source, /const MIN_ANCHOR_COVERAGE = \.25;/);
  assert.match(source, /&& phase\.coverage >= MIN_ANCHOR_COVERAGE/);
  assert.doesNotMatch(source, /&& phase\.coverage >= 0\.35/);
  assert.match(source, /const dominanceFloor = move >= period \* LARGE_ANCHOR_MOVE_FRACTION \? LARGE_ANCHOR_MIN_DOMINANCE : 1\.14;/);
  assert.match(source, /const LARGE_ANCHOR_MOVE_FRACTION = \.25;/);
  assert.match(source, /const LARGE_ANCHOR_MIN_DOMINANCE = 1\.5;/);
  // The diagnostic must mirror the live rule, or it stops being a diagnosis.
  assert.match(source, /if \(move > period \* MAX_ANCHOR_MOVE_FRACTION\) fails\.push\("move"\);/);
  assert.match(source, /if \(phase\.coverage < MIN_ANCHOR_COVERAGE\) fails\.push\("coverage"\);/);
});

test("no onset feature tells a kick from an offbeat bass note", () => {
  // Recorded so the experiment is not repeated. dominantKickPhase has to
  // choose between two credible phases on a tune with a rolling offbeat
  // bassline, and the obvious fix is a feature that identifies the kick. There
  // is no such feature among the ones onsets carry.
  //
  // Measured over 9,505 onsets from six tracks whose grids are known good, so
  // an onset on the grid is a kick and one at the half-beat is the bassline.
  // Every interquartile range overlapped:
  //
  //   subDominance      kick 0.399 [0.355-0.470]   bass 0.464 [0.398-0.531]
  //   lowShare          kick 1.000 [1.000-1.000]   bass 1.000 [1.000-1.000]
  //   transientSupport  kick 0.483 [0.174-0.956]   bass 0.615 [0.157-1.111]
  //   kickEvidence      kick 0.289 [0.072-0.692]   bass 0.221 [0.052-0.586]
  //
  // subDominance runs backwards: in this genre the offbeat bass IS a sub while
  // the kick carries the click, so the kick is the LESS sub-dominant of the
  // two. A band-ratio feature would have made the choice worse, not better.
  assert.match(beatGridSource, /Can a kick be told from an offbeat bass note by its harmonics\?/);
  assert.match(beatGridSource, /export function onsetBandDiagnostics/);
  // lowShare is saturated at 1.000 on every onset measured, so it carries no
  // information at all — yet it still gates one of the correction paths.
  assert.match(beatGridSource, /onset\.lowShare < 0\.16/);
});

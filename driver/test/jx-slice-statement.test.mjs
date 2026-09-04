// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the run states which jx slices it executed.
//
// R6's scenario asserts `_driver/jx-lanes.json:fold.executes` exists, and nothing wrote it: a
// non-truncated grep over driver/, scripts/ and providers/ found exactly ONE `executes` assignment in
// the engine — jx-lanes.mjs's per-lane policy field, frozen at mint, which described the depth the lane
// was SOLD at rather than what ran. So on the 2026-08-09 R6 the SERP grid was 49/49 cells gapped on an
// exhausted quota, loud in the units record and silent in the fold. One record spoke, the other could
// not, and the assert was red on a delivered run.
//
// CLOSED THE OTHER HALF: that frozen field always read "candidates" and so asserted, from the
// source, that the deep China slices do not exist — they shipped. It is deleted, and the per-lane view
// is derived from this file's own fold.slices (reference-score.mjs laneExecutes). After the key
// `executes` appears in jx-lanes.json in exactly ONE place: fold.executes.
//
// THE TWO TRAPS THIS FILE EXISTS TO HOLD SHUT.
//
//   1. `exists` PASSES ON AN EMPTY STRING. scripts/e2e.mjs's op is `v !== null && v !== undefined`. Build
//      `executes` by joining the names of slices that ran and a run where nothing ran emits "" — the
//      assert goes green on a statement of nothing. It is the literal "none" instead.
//   2. units.json CANNOT SEPARATE never-armed FROM armed-but-refused. Every early gating leg returns
//      {ran:false, cause} and writes no unit record at all. And the arming itself cannot be read from the
//      skip EVENT: pipeline.mjs gates the nativeread block on CLEAROTRON_JX_NATIVEREAD || CLEAROTRON_JX_CONSUME
//      while the unit refuses on CLEAROTRON_JX_NATIVEREAD alone, so with CONSUME on and NATIVEREAD off a skip
//      event exists for a slice that was never armed. Arming comes from the ENV; the event supplies only
//      the `why`.
//
// Run:  node --test driver/test/jx-slice-statement.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { deriveJxSliceStatement, stateJxSlices, JX_SLICES } from "../jx.mjs";
import { decideJxLanes } from "../jx-lanes.mjs";
import { readJxLanes } from "../reference-score.mjs";

// item 8 deleted CLEAROTRON_JX_SERP_GRID / _NATIVEREAD / _CONSUME. The lane switch is the only one
// left, and it is fail-open, so "everything armed" is now simply an environment that kills nothing.
const ON = { CLEAROTRON_NATIVE_LANGUAGE_ZH: "1" };
/** The lane killed — the one remaining way to make a slice read `not-armed`. */
const LANE_OFF = { CLEAROTRON_NATIVE_LANGUAGE_ZH: "0" };
const sidecarOf = (lanes = { zh: {} }, fold = { zh: { degraded: false } }) => ({
  schema: 1, lanes, scope: ["CN"], fold: { executor: "x", lanes: fold, foldedAt: "2026-08-09T00:00:00Z" },
});
const unitsOf = (units) => ({ schema: 1, units, updatedAt: "2026-08-09T00:00:00Z" });

// ── The derivation ─────────────────────────────────────────────────────────────────────────────────

test("#552 all three slices ran ⇒ executes names all three, joined", () => {
  const { executes, slices } = deriveJxSliceStatement({
    sidecar: sidecarOf(), env: ON,
    units: unitsOf({ "serp-grid:zh": { done: true, degraded: false }, "nativeread:zh": { done: true, degraded: false } }),
  });
  assert.equal(executes, "candidates+serp-grid+nativeread");
  for (const s of JX_SLICES) assert.equal(slices[s.name].state, "ran", s.name);
});

test("#552 R6's shape: retrieval slices that did not run ⇒ executes is exactly 'candidates'", () => {
  // item 8 deleted the per-slice arms, so "the retrieval slices are off" no longer has a switch to
  // express it — and the one switch left kills the whole lane, slice 1 included, so it cannot express it
  // either. R6's property is unchanged and this is now how it is reached: the fold ran, neither unit
  // wrote a record, so neither retrieval slice may appear in `executes`.
  const { executes, slices } = deriveJxSliceStatement({ sidecar: sidecarOf(), env: {} });
  assert.equal(executes, "candidates",
    "R6's own why-this-path says `executes: \"candidates\"` must mean slices 2 and 3 did NOT run");
  // AND THE STATE IS `not-established`, NOT `not-armed`, which is the behaviour change item 8 is. Before,
  // an unset environment left both slices not-armed and a run shipped dark by default. `not-armed` reads
  // as a choice somebody made; `not-established` is an absence a reader has to chase, and that is the
  // honest answer for a slice that is armed and wrote nothing.
  assert.equal(slices["serp-grid"].state, "not-established");
  assert.equal(slices.nativeread.state, "not-established");
  assert.match(slices["serp-grid"].why, /CANNOT be established/);
});

test("#1149 item 8 — a KILLED lane is the one thing that still reads not-armed, and it names itself", () => {
  const { executes, slices } = deriveJxSliceStatement({ sidecar: sidecarOf(), env: LANE_OFF });
  assert.equal(executes, "none", "killing the lane stops slice 1 too — there is no partial kill any more");
  assert.equal(slices["serp-grid"].state, "not-armed");
  assert.match(slices["serp-grid"].basis, /^env CLEAROTRON_NATIVE_LANGUAGE_ZH/,
    "the basis names the switch that actually decided it, not a deleted one");
  assert.match(slices["serp-grid"].why, /the lane was killed, not merely idle/);
});

test("#552 a GAPPED grid is not named in executes — 49/49 gapped is not 'it executed'", () => {
  const cause = "49/49 cells gapped — below the coverage floor. Dominant cause (49/49): SerpAPI 429 quota";
  const { executes, slices } = deriveJxSliceStatement({
    sidecar: sidecarOf(), env: ON,
    units: unitsOf({ "serp-grid:zh": { degraded: true, degradedCause: cause, attempts: 3 } }),
  });
  assert.equal(executes, "candidates", "the gapped grid must not appear in the run's statement of what ran");
  assert.equal(slices["serp-grid"].state, "gapped");
  assert.equal(slices["serp-grid"].attempts, 3);
  assert.match(slices["serp-grid"].why, /SerpAPI 429/, "the cause travels with it — the units record already knew");
});

test("#552 executes is NEVER the empty string — `exists` would pass on one", () => {
  // Every slice failed or was never armed. The naive join emits "" and R6 goes green on nothing.
  const { executes } = deriveJxSliceStatement({
    sidecar: sidecarOf({ zh: {} }, { zh: { degraded: true, degradedCause: "executor threw" } }),
    env: ON, units: unitsOf({ "serp-grid:zh": { degraded: true, degradedCause: "429" } }),
  });
  assert.equal(executes, "none");
  assert.notEqual(executes, "");
});

test("#552 armed-but-refused is NOT not-armed — arming is read from the ENV, never from a skip event", () => {
  // The flag disagreement this was written for is gone with the arms ( item 8): the pipeline block
  // and the unit now share one condition, so they cannot disagree. The RULE it protects is not gone —
  // arming is read from the environment and never inferred from the presence of a skip event — and a
  // killed lane with a skip event beside it is still the case that would break it.
  const notArmed = deriveJxSliceStatement({
    sidecar: sidecarOf(), env: { CLEAROTRON_NATIVE_LANGUAGE_ZH: "0" },
    causes: { nativeread: "no zh evidence to read — slice 2 recorded nothing" },
  });
  assert.equal(notArmed.slices.nativeread.state, "not-armed",
    "the lane was killed — the record must say so, not report a structural refusal it never reached");
  // Armed, no unit record, but a captured structural cause ⇒ refused, quoting it.
  const refused = deriveJxSliceStatement({
    sidecar: sidecarOf(), env: ON, causes: { nativeread: "no zh evidence to read — slice 2 recorded nothing" },
  });
  assert.equal(refused.slices.nativeread.state, "refused");
  assert.match(refused.slices.nativeread.why, /no zh evidence to read/);
});

test("#552 armed, no record, no cause ⇒ not-established — an absence is a finding, never a pass", () => {
  const { slices } = deriveJxSliceStatement({ sidecar: sidecarOf(), env: ON });
  assert.equal(slices["serp-grid"].state, "not-established");
  assert.match(slices["serp-grid"].why, /CANNOT be established/);
  assert.notEqual(slices["serp-grid"].state, "ran");
});

test("#552 slice 1 never overstates across lanes — one gapped lane makes the slice gapped", () => {
  const { executes, slices } = deriveJxSliceStatement({
    sidecar: sidecarOf({ zh: {}, ja: {} }, { zh: { degraded: false }, ja: { degraded: true, degradedCause: "executor threw" } }),
    env: { CLEAROTRON_NATIVE_LANGUAGE_ZH: "1", CLEAROTRON_NATIVE_LANGUAGE_JA: "1" },
  });
  assert.equal(slices.candidates.state, "gapped");
  assert.deepEqual(slices.candidates.lanes, { zh: "ran", ja: "gapped" });
  assert.equal(executes, "none", "a partly-gapped slice 1 is not a slice that executed");
  // An armed lane with NO fold record at all is the receipt-never-written case, and it is not "ran".
  const missing = deriveJxSliceStatement({
    sidecar: sidecarOf({ zh: {}, ja: {} }, { zh: { degraded: false } }),
    env: { CLEAROTRON_NATIVE_LANGUAGE_ZH: "1", CLEAROTRON_NATIVE_LANGUAGE_JA: "1" },
  });
  assert.equal(missing.slices.candidates.lanes.ja, "not-established");
  assert.equal(missing.slices.candidates.state, "not-established");
});

// ── The writer ─────────────────────────────────────────────────────────────────────────────────────

function runDir(t, { sidecar = sidecarOf(), units = null, journal = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "jx-552-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir, "jx"), { recursive: true });
  if (sidecar) writeFileSync(driverDir(dir, "jx-lanes.json"), JSON.stringify(sidecar, null, 2));
  if (units) writeFileSync(driverDir(dir, "jx", "units.json"), JSON.stringify(units));
  if (journal) writeFileSync(driverDir(dir, "run.jsonl"), journal);
  return dir;
}
const readSidecar = (dir) => JSON.parse(readFileSync(driverDir(dir, "jx-lanes.json"), "utf8"));

test("#552 the writer states it on the sidecar and leaves the frozen decision alone", (t) => {
  const dir = runDir(t, { units: unitsOf({ "serp-grid:zh": { done: true, degraded: false } }) });
  const r = stateJxSlices(dir, { env: ON });
  assert.equal(r.stated, true);
  const s = readSidecar(dir);
  assert.equal(s.fold.executes, "candidates+serp-grid");
  // item 8 — nativeread wrote no unit record, and with no arm to be off that is `not-established`
  // rather than `not-armed`. The distinction is the point: one is a choice, the other is a gap.
  assert.equal(s.fold.slices.nativeread.state, "not-established");
  assert.ok(s.fold.statedAt);
  // The frozen decision is untouched, and so is everything else the fold already carried.
  assert.deepEqual(s.lanes, sidecarOf().lanes);
  assert.deepEqual(s.scope, ["CN"]);
  assert.equal(s.fold.executor, "x");
  assert.equal(s.fold.foldedAt, "2026-08-09T00:00:00Z");
});

test("#552 the writer is idempotent — a delivered-then-resumed run does not restamp", (t) => {
  const dir = runDir(t, { units: unitsOf({ "serp-grid:zh": { done: true, degraded: false } }) });
  stateJxSlices(dir, { env: ON });
  const first = readFileSync(driverDir(dir, "jx-lanes.json"), "utf8");
  const again = stateJxSlices(dir, { env: ON });
  assert.equal(again.unchanged, true);
  assert.equal(readFileSync(driverDir(dir, "jx-lanes.json"), "utf8"), first, "byte-identical");
});

test("#552 a corrupt sidecar is NOT rewritten — the lane decision is frozen and not this writer's", (t) => {
  const dir = runDir(t, { sidecar: null });
  writeFileSync(driverDir(dir, "jx-lanes.json"), "{ truncated");
  const notes = [];
  const r = stateJxSlices(dir, { env: ON, note: (m) => notes.push(m) });
  assert.equal(r.stated, false);
  assert.equal(readFileSync(driverDir(dir, "jx-lanes.json"), "utf8"), "{ truncated", "untouched");
  assert.match(notes.join("\n"), /NOT writing one/);
});

test("#552 an absent sidecar produces no file — the writer never mints a lane decision", (t) => {
  const dir = runDir(t, { sidecar: null });
  assert.equal(stateJxSlices(dir, { env: ON }).stated, false);
  assert.throws(() => readSidecar(dir), "no jx-lanes.json is invented");
});

// An ABSENT sidecar and an UNPARSEABLE one are not the same fact, and the first cut said one sentence
// for both. BOTH R2 runs of the 2026-08-09 round carry no _driver/jx-lanes.json at all — a clearance
// with no jx lane simply has none — so "NOT writing one" would have printed on half the overnight round
// and read as a withheld action. That is the absent-vs-failed conflation this tranche exists to remove.
test("#552 no jx lane is SILENT; a sidecar that exists and will not parse is LOUD", (t) => {
  const quiet = [];
  const none = stateJxSlices(runDir(t, { sidecar: null }), { env: ON, note: (m) => quiet.push(m) });
  assert.equal(none.reason, "no-jx-lane");
  assert.deepEqual(quiet, [], "a run that never had a jx lane says nothing — absence here is normal, not withheld");

  const loud = [];
  const dir = runDir(t, { sidecar: null });
  writeFileSync(driverDir(dir, "jx-lanes.json"), "{ truncated");
  const bad = stateJxSlices(dir, { env: ON, note: (m) => loud.push(m) });
  assert.equal(bad.reason, "unparseable");
  assert.match(loud.join("\n"), /EXISTS and does not parse/,
    "a corrupt DRIVER-written frozen decision is a defect and must stay loud");
});

test("#552 the run.jsonl skip cause decorates a refusal and never decides a state", (t) => {
  const journal = [
    JSON.stringify({ event: "jx-nativeread-skipped", cause: "no zh evidence to read" }),
    JSON.stringify({ event: "stage", stage: "synthesis" }),
    "not json at all",
  ].join("\n");
  const dir = runDir(t, { journal });
  stateJxSlices(dir, { env: ON });
  assert.equal(readSidecar(dir).fold.slices.nativeread.state, "refused", "armed + a cause = refused");
  // item 8 — the second half of this test used to set the per-slice arm off. That arm is deleted,
  // so the switch that can still contradict the journal is the lane kill, and the rule is the same one:
  // a skip EVENT never promotes a slice the environment says was never reached.
  const dir2 = runDir(t, { journal });
  stateJxSlices(dir2, { env: LANE_OFF });
  assert.equal(readSidecar(dir2).fold.slices.nativeread.state, "not-armed",
    "same journal, lane killed — the EVENT must not promote it to a structural refusal");
});

// ── The scorer keeps run-level and per-lane apart ──────────────────────────────────────────────────
//
// folded in: the per-lane `executes` is no longer a frozen policy string on the declaration — it is
// DERIVED from this same fold.slices record, per lane. The fixtures below are built by running the real
// producer (deriveJxSliceStatement) rather than by hand, so a change to the statement's shape reaches
// these asserts instead of leaving a hand-typed shape certifying itself.

const stateOf = (sidecar, env, units = null) => {
  const { executes, slices } = deriveJxSliceStatement({ sidecar, env, units });
  return { ...sidecar, fold: { ...sidecar.fold, executes, slices } };
};

test("#552/#858 the run statement is not applied to every lane row — the zh-only grid never lands on ja", () => {
  const doc = stateOf(
    sidecarOf({ zh: { depth: "full", jurisdictions: ["CN"] }, ja: { depth: "full", jurisdictions: ["JP"] } },
      { zh: { degraded: false }, ja: { degraded: false } }),
    { CLEAROTRON_NATIVE_LANGUAGE_ZH: "1", CLEAROTRON_NATIVE_LANGUAGE_JA: "1", CLEAROTRON_JX_SERP_GRID: "1" },
    unitsOf({ "serp-grid:zh": { done: true, degraded: false } }),
  );
  assert.equal(doc.fold.executes, "candidates+serp-grid", "the RUN ran both");
  const r = readJxLanes(doc);
  const by = Object.fromEntries(r.lanes.map((l) => [l.lane, l.executes]));
  assert.equal(by.zh, "candidates+serp-grid", "zh gets the grid, because the grid record names zh");
  assert.equal(by.ja, "candidates",
    "the SERP grid is zh-only, so `lane ja: executes=candidates+serp-grid` is a claim no record supports");
  assert.equal(r.statement, "candidates+serp-grid", "the run-level statement travels in its own slot");
  assert.equal(r.statementWhy, null);
});

test("#858 a lane whose own slice-1 record gapped states what ran FOR IT, not the run's join", () => {
  const doc = stateOf(
    sidecarOf({ zh: { depth: "full" }, ja: { depth: "candidates" } },
      { zh: { degraded: true, degradedCause: "ANTHROPIC_API_KEY absent" }, ja: { degraded: false } }),
    { CLEAROTRON_NATIVE_LANGUAGE_ZH: "1", CLEAROTRON_NATIVE_LANGUAGE_JA: "1" },
  );
  const by = Object.fromEntries(readJxLanes(doc).lanes.map((l) => [l.lane, l.executes]));
  assert.equal(by.zh, "none", "nothing ran for zh — a POSITIVE answer, and never the empty string");
  assert.equal(by.ja, "candidates", "and one lane's outage is not the other lane's record");
});

test("#858 a lane the statement does not cover reads (not stated) — never 'none'", () => {
  // A run that died before delivery states nothing. `none` would say the slices ran and produced
  // nothing, which is a different fact; this is the `exists`-passes-on-"" defect one layer over.
  const undelivered = readJxLanes({ lanes: { zh: { depth: "full", jurisdictions: ["CN"] } },
    fold: { executor: "x", lanes: { zh: { degraded: false } }, foldedAt: "2026-08-13T00:00:00Z" } });
  assert.equal(undelivered.lanes[0].executes, null, "no statement ⇒ not stated, forever");
  assert.match(undelivered.statementWhy, /did not state which jx slices it executed/);

  // and a lane that appears ONLY in the fold, which the statement's declared-lane loop never saw
  const doc = stateOf(sidecarOf({ zh: {} }, { zh: { degraded: false } }), { CLEAROTRON_NATIVE_LANGUAGE_ZH: "1" });
  doc.fold.lanes.ko = { degraded: false };
  const ko = readJxLanes(doc).lanes.find((l) => l.lane === "ko");
  assert.equal(ko.executes, null, "a lane no slice record covers is not a lane that ran nothing");
});

test("#858 the DERIVED value wins over the frozen one; a pre-#858 artifact still keeps its own", () => {
  // Both generations reach this reader. A run minted between and carries the frozen
  // `candidates` AND a statement saying the grid ran — the record of what ran is the accurate one.
  const both = stateOf(sidecarOf({ zh: { executes: "candidates", depth: "full" } }, { zh: { degraded: false } }),
    { CLEAROTRON_NATIVE_LANGUAGE_ZH: "1", CLEAROTRON_JX_SERP_GRID: "1" }, unitsOf({ "serp-grid:zh": { done: true, degraded: false } }));
  assert.equal(readJxLanes(both).lanes[0].executes, "candidates+serp-grid",
    "the frozen string is a stale declaration next to a record — the record wins");

  // pre-, pre-: no statement at all, and the frozen field is the only thing that run recorded
  const legacy = readJxLanes({ lanes: { zh: { executes: "candidates" } }, fold: { lanes: { zh: { degraded: false } } } });
  assert.equal(legacy.statement, null);
  assert.match(legacy.statementWhy, /did not state which jx slices it executed/);
  assert.equal(legacy.lanes[0].executes, "candidates", "the old artifact's own field still reads");
  assert.equal(readJxLanes({ lanes: { zh: { executes: 7 } } }).lanes[0].executes, null,
    "and a non-string in that slot was never a statement");
});

test("#858 the mint no longer freezes an `executes` — nothing in the decision claims what ran", () => {
  const full = decideJxLanes({ job: { jurisdictions: ["CN"] },
    profile: { jxPolicy: { laneDepth: { zh: "full" } } }, searchPolicy: { components: { jxLanes: true } } });
  assert.equal(full.lanes.zh.executes, undefined,
    "the declaration is frozen BEFORE any slice runs, so it cannot state what executed");
  assert.equal(full.lanes.zh.depth, "full", "what the config ASKED FOR still rides, untouched");
  assert.doesNotMatch(full.lanes.zh.origin, /EXECUTES candidates only/,
    "and the downgrade stamp is gone — slices 2 and 3 shipped");
  assert.match(full.lanes.zh.origin, /fold\.executes/, "origin points at the record that can answer");
});

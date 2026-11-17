// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the empty band ladder stops being silent.
//
// `knockoutAssessChunk` guards its three band checks on `ladder.length`: knockout_band_unknown,
// classesDriving-at-or-above-material, and registerEstimate-above-lowest. With an empty ladder all three
// are inert and EVERY rating in the chunk passes unchecked — no runLog, no note. A run the ladder never
// constrained was byte-indistinguishable from one it did.
//
// The refusal that should have caught it never reaches that road: framework.mjs rejects a manifest with
// fewer than two bands, but this validator does a raw read and never parses.
//
// Two changes, and the split matters more than either half:
//   · readBackLadder (pipeline-knockout.mjs) reads the sidecar back THE WAY THE CONSUMER READS IT, at the
//     freeze, before any dispatch, and hard fails when it cannot: the driver wrote the file itself, on
//     this pass or an earlier pass of the same build, since a run from another build is not resumed.
//   · the validator emits `knockout-band-checks-inert` and does NOT fail. It rides the corrective ladder,
//     so {ok:false} re-asks the SEAT, and no seat can repair a driver's sidecar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { validators } from "../verify-knockout.mjs";
import { readBackLadder } from "../pipeline-knockout.mjs";

const FW = {
  framework_key: "house-triage",
  bands: [{ label: "Blocking", tone: "severe" }, { label: "Medium", tone: "medium" },
    { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }],
};

function runDirWith(framework) {
  const d = mkdtempSync(join(tmpdir(), "ko-ladder-"));
  mkdirSync(driverDir(d), { recursive: true });
  mkdirSync(join(d, "research"), { recursive: true });
  if (framework !== undefined) writeFileSync(driverDir(d, "framework.json"), JSON.stringify(framework));
  writeFileSync(join(d, "research", "ironwhisk.md"), "payload");
  return d;
}

const markRow = (over = {}) => ({
  name: "IRONWHISK", classesSearched: [8], classesDriving: [8], contextFraming: "compound",
  rating: "Manageable", ratingQualifier: null,
  bullets: ["Scattered informal uses; no dominant owner."],
  basis: "A compound of two ordinary kitchen words, used informally by several small sellers.",
  factors: ["Two marketplace storefronts trade under the name in the same goods.",
    "No owner has consolidated the name across the field."],
  counterFactors: ["No registered right and no dominant trader was found on the material searched."],
  mitigation: "Narrowing to the tool classes would put daylight between this and the storefront use.",
  purpleNotes: [], registerEstimate: "moderate filings expected", findings: [], negatives: [], degraded: null,
  ...over,
});
const chunk = (marks) => JSON.stringify({
  chunkSummary: "The chunk's marks are covered here in a measured sentence or two.",
  batch: { productContext: "kitchenware" }, marks,
});

const runLogEvents = (d) => {
  const p = driverDir(d, "run.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
};
const inertLines = (d) => runLogEvents(d).filter((e) => e.event === "knockout-band-checks-inert");

// ── the observable at the validator ─────────────────────────────────────────────────────────────────

test("an empty ladder is RECORDED — the band checks say so instead of passing in silence", () => {
  const d = runDirWith({ framework_key: "broken", bands: [] });
  const f = join(d, "knockout-assess-0.json");
  const r = validators.knockoutAssessChunk(f, chunk([markRow({ rating: "Utterly Invented Band" })]));

  assert.equal(r.ok, true, "the verdict is deliberately UNCHANGED — a driver fault must not be re-asked of the seat");
  const lines = inertLines(d);
  assert.equal(lines.length, 1, "exactly one inert-checks line for this chunk");
  assert.equal(lines[0].stage, "knockout-assess");
  assert.equal(lines[0].chunk, f, "the line names the chunk, so a per-chunk skip is countable");
  assert.match(lines[0].detail, /knockout_band_unknown/, "the line names which checks went inert");
});

test("THE DISCRIMINATOR: with a real ladder the line is absent AND the band check bites", () => {
  // Without this arm the test above is satisfied by a runLog that fires unconditionally, which would
  // make the record useless for telling a constrained run from an unconstrained one.
  const d = runDirWith(FW);
  const f = join(d, "knockout-assess-0.json");

  const bad = validators.knockoutAssessChunk(f, chunk([markRow({ rating: "Utterly Invented Band" })]));
  assert.equal(bad.ok, false, "a rating outside the frozen ladder must still fail");
  assert.match(bad.reason, /knockout_band_unknown/);

  const good = validators.knockoutAssessChunk(f, chunk([markRow()]));
  assert.equal(good.ok, true);
  assert.deepEqual(inertLines(d), [], "no inert line when the ladder actually constrained the ratings");
});

// ── the refusal at the freeze ───────────────────────────────────────────────────────────────────────


test("MINTED: the driver cannot read back the ladder it just wrote — hard fail, before any paid turn", () => {
  for (const [label, framework] of [["empty bands", { bands: [] }], ["no bands key", { framework_key: "x" }],
    ["bands not an array", { bands: "Blocking/Medium" }], ["labels blank", { bands: [{ label: "" }, { label: null }] }]]) {
    const d = runDirWith(framework);
    assert.throws(() => readBackLadder(driverDir(d, "framework.json")),
      /knockout_ladder_unreadable/, `${label}: minting must refuse`);
    rmSync(d, { recursive: true, force: true });
  }
});

test("MINTED: the sidecar missing entirely also refuses — an absent file is not an empty pass", () => {
  const d = runDirWith(undefined);
  assert.throws(() => readBackLadder(driverDir(d, "framework.json")),
    /knockout_ladder_unreadable/);
});

test("MINTED, GOOD: a real ladder reads back and nothing is raised or logged", () => {
  const d = runDirWith(FW);
  readBackLadder(driverDir(d, "framework.json"));
  assert.deepEqual(runLogEvents(d), [], "a healthy freeze writes no fault line — otherwise the fault line means nothing");
});

test("RESUMED: a ladder that does not read back refuses as a minted one does — this build wrote it", () => {
  // A resume reads back a sidecar an earlier pass of the same build froze; a run started on another build is
  // not resumed. So a ladder that will not read back is the same driver fault on every pass, and it stops the
  // run before a paid turn rather than letting every rating pass unchecked.
  const d = runDirWith({ framework_key: "no-bands", ladder: ["Blocking", "Low"] });
  assert.throws(() => readBackLadder(driverDir(d, "framework.json")), /knockout_ladder_unreadable/);
  assert.deepEqual(runLogEvents(d), [], "nothing is recorded as a soft finding instead");
});

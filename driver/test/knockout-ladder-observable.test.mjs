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
//     freeze, before any dispatch. Minted ⇒ hard fail (the driver wrote it itself and cannot read it
//     back). Pre-existing ⇒ loud, run continues — a replayed archive turning red is how this fix would
//     go wrong, and 's own "not claimed" says so.
//   · the validator emits `knockout-band-checks-inert` and does NOT fail. It rides the corrective ladder,
//     so {ok:false} re-asks the SEAT, and no seat can repair a driver's sidecar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
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

const ctxFor = (d) => ({ paths: { runDir: d } });

test("MINTED: the driver cannot read back the ladder it just wrote — hard fail, before any paid turn", () => {
  for (const [label, framework] of [["empty bands", { bands: [] }], ["no bands key", { framework_key: "x" }],
    ["bands not an array", { bands: "Blocking/Medium" }], ["labels blank", { bands: [{ label: "" }, { label: null }] }]]) {
    const d = runDirWith(framework);
    assert.throws(() => readBackLadder(ctxFor(d), driverDir(d, "framework.json"), { minted: true }),
      /knockout_ladder_unreadable/, `${label}: minting must refuse`);
    rmSync(d, { recursive: true, force: true });
  }
});

test("MINTED: the sidecar missing entirely also refuses — an absent file is not an empty pass", () => {
  const d = runDirWith(undefined);
  assert.throws(() => readBackLadder(ctxFor(d), driverDir(d, "framework.json"), { minted: true }),
    /knockout_ladder_unreadable/);
});

test("MINTED, GOOD: a real ladder reads back and nothing is raised or logged", () => {
  const d = runDirWith(FW);
  readBackLadder(ctxFor(d), driverDir(d, "framework.json"), { minted: true });
  assert.deepEqual(runLogEvents(d), [], "a healthy freeze writes no fault line — otherwise the fault line means nothing");
});

test("PRE-EXISTING: loud, and the run is NOT stopped — a replayed archive must not turn red", () => {
  // The disposition 's "not claimed" asks for by name. These bytes predate this process and may
  // predate this shape; refusing here would take down an archived run that renders fine today.
  const d = runDirWith({ framework_key: "legacy-shape", ladder: ["Blocking", "Low"] });
  readBackLadder(ctxFor(d), driverDir(d, "framework.json"), { minted: false });
  const events = runLogEvents(d).filter((e) => e.event === "knockout-ladder-unreadable");
  assert.equal(events.length, 1, "the fault is recorded");
  assert.equal(events[0].minted, false, "and it says which disposition it took");
});

// SKIPPED under root rather than returned early: this drives the EACCES with a real 0o500 directory, and
// root ignores a directory's write bit — the append lands, the run log gets its row, and the final
// assertion that no row exists correctly fails. That is a defect in this harness, not in the branch. An
// early `return` would report `ok` for a test that asserted nothing, so the reason is declared on the line.
test("PRE-EXISTING: an unwritable run log does NOT take down the run it exists to spare",
  { skip: process.getuid?.() === 0 && "root writes through a 0o500 directory — the fault injection is a no-op" }, () => {
  // runLog -> appendLine (log.mjs:11) is an unguarded mkdirSync + appendFileSync, so it throws on EACCES
  // or a full disk. Accepted behaviour everywhere else in the driver; not here, where the whole point of
  // this branch is that a pre-existing file keeps its run alive. Driven by making _driver/ unwritable —
  // the real shape, not a stubbed throw.
  const d = runDirWith({ framework_key: "legacy-shape", ladder: ["Blocking", "Low"] });
  chmodSync(driverDir(d), 0o500);
  try {
    readBackLadder(ctxFor(d), driverDir(d, "framework.json"), { minted: false });
  } finally {
    chmodSync(driverDir(d), 0o700);
  }
  // Nothing thrown. The record is absent because the disk refused it, which is the case being handled.
  assert.deepEqual(runLogEvents(d).filter((e) => e.event === "knockout-ladder-unreadable"), []);
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STAGE ORDERED ITS SEAT TO WRITE SOMEWHERE NOTHING WOULD LET IT WRITE.
//
// knockout-assess's `out:` was `_driver/knockout-assess-<n>.json` — inside the tree the deny-hook
// guards. The seat was refused on Write AND on Bash, all three attempts, and the corrective ladder
// exhausted against an instruction it could not obey by any route. R0e delivered on 2026-08-14 and
// failed on 2026-08-16.
//
// WHY IT ONLY FAILED NOW is the part worth keeping: E13 denied Write/Edit under `_driver/` from 08-14,
// and seats complied anyway by shelling out — Bash redirects wrote the file the Write tool refused.
// closed that bypass on 08-16 and this broke the same day. **The bypass was load-bearing and
// nobody knew.** The delivered run two days earlier worked only because the workaround still did.
//
// The fix is 's shape — the WORK moves out of the guarded tree, never the hook weakened — and it is
// also this module obeying its own doctrine, stated fourteen lines above the offending path: `_driver/`
// files "are the driver's own measurements, NEVER a model's output". An assess chunk is a model output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";
import { STAGES, paths } from "../stages.mjs";
import { authorityTrees, denyReason } from "../authority-trees.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = "/RUN";
const K = koPaths(RUN);
const TREES = authorityTrees({ runDir: RUN });

// ── THE FIX, AGAINST THE REAL BOUNDARY ──────────────────────────────────────────────────────────────

test("the boundary REFUSES the old path and ALLOWS the new one — asserted against denyReason itself", () => {
  // Both directions. Only asserting the new path is allowed would pass just as well if denyReason had
  // stopped denying anything at all, which is the failure mode a boundary test exists to exclude.
  const legacy = K.assessChunkLegacy(0);
  const now = K.assessChunk(0);
  assert.ok(denyReason(legacy, TREES), `POSITIVE CONTROL: ${legacy} must still be refused — the guard is intact`);
  assert.equal(denyReason(now, TREES), null, `${now} must be writable, or the relocation fixes nothing`);
});

test("the new path is outside the guarded tree, the legacy one inside — by construction, not by string", () => {
  const guarded = driverDir(resolve(RUN));
  assert.ok(!K.assessChunk(0).startsWith(guarded + "/"), "the chunk must not live under _driver/");
  assert.ok(K.assessChunkLegacy(0).startsWith(guarded + "/"), "the legacy path is the pre-relocation one and must still name _driver/");
  assert.equal(K.assessChunk(3), join(RUN, "knockout-assess-3.json"), "the run root, with the chunk number preserved");
});

test("verify-knockout's chunk-number parse survives the move — it anchors on the FILENAME", () => {
  // The one thing a directory change could silently break: the validator recovers the chunk index from
  // the path. It matches on the basename, so it holds — asserted rather than assumed, because a stage
  // whose chunk number came back NaN would fail its membership join for a reason nobody would guess.
  const re = /knockout-assess-(\d+)\.json$/;
  assert.equal(Number(K.assessChunk(0).match(re)?.[1]), 0);
  assert.equal(Number(K.assessChunk(11).match(re)?.[1]), 11);
  assert.equal(Number(K.assessChunkLegacy(2).match(re)?.[1]), 2, "…and still recovers it from an archived run's path");
});

test("the DICTATION names NO path and orders the CALL — the write order is gone, not relocated", () => {
  const def = KO_STAGES["knockout-assess"];
  const text = String(def.message({
    K, chunkNo: 0, chunkMarks: [{ name: "LUMEN" }], chunkTotal: 1,
    framework: { framework_key: "f", bands: [{ label: "High" }, { label: "Low" }] }, probeNote: null,
  }) ?? "");
  assert.ok(text.length > 500, `the dictation composed ${text.length} chars — too short to be real`);
  // POST-CONVERSION ( item B). This arm used to assert the seat WAS told the new path,
  // which was the right assertion while the seat wrote the file: the relocation existed so the write it
  // was ordered to make was one the boundary would permit. The conversion removes the order, so the
  // stronger statement is now true and is what is asserted — the seat is told no path at all, because
  // the driver writes the chunk. The two paths are still checked BOTH ways so this cannot pass by the
  // dictation having gone empty or generic.
  assert.ok(!text.includes(K.assessChunk(0)), "the seat is still told a path to write — the conversion moved the order rather than removing it");
  assert.ok(!text.includes(K.assessChunkLegacy(0)), "the seat is told the guarded path");
  assert.match(text, /record_knockout_assess/, "the dictation names no record tool — the seat is told neither where to write nor what to call");
  assert.doesNotMatch(text, /\bWrite the STRICT JSON\b/, "the write order survives in the dictation");
});

// ── THE READER KEEPS ARCHIVED RUNS RESUMABLE ────────────────────────────────────────────────────────

test("the reader prefers the new path and falls back to the legacy one", () => {
  // A run whose chunks were written before the move — or through the bypass closed — must resume
  // without re-dispatching a PAID stage. Source-bound, because the read sits inside an async pipeline
  // function that cannot be driven from here.
  const src = readFileSync(join(HERE, "..", "pipeline-knockout.mjs"), "utf8");
  assert.match(src, /existsSync\(K\.assessChunk\(c\)\) \? K\.assessChunk\(c\) : K\.assessChunkLegacy\(c\)/,
    "the read no longer falls back — a resumed pre-move run would re-pay for its chunks");
  assert.match(src, /for \(const f of \[K\.assessChunk\(c\), K\.assessChunkLegacy\(c\)\]\) if \(existsSync\(f\)\) rmSync\(f\)/,
    "invalidation must clear BOTH, or a stale legacy chunk is read through the fallback and the re-sweep is billed for nothing");
  assert.match(src, /existsSync\(K\.assessChunk\(c\)\) \|\| existsSync\(K\.assessChunkLegacy\(c\)\)/,
    "the staleness check must see both locations");
});

// ── THE CLASS, SO IT CANNOT COME BACK ───────────────────────────────────────────────────────────────

test("NO stage in EITHER lane writes its output into the guarded tree", () => {
  // The tripwire this incident earned. Measured both directions when it was written: six `_driver`
  // constructions in stages-knockout.mjs and exactly one was a stage's `out:`; zero in stages.mjs.
  // A future stage pointed at `_driver/` now fails here instead of on a live run, three attempts deep,
  // after the corrective ladder has been paid for.
  const guarded = driverDir(resolve(RUN));
  const offenders = [];
  for (const [name, def] of Object.entries(KO_STAGES)) {
    let out = null;
    try { out = typeof def.out === "function" ? def.out(K, 0) : def.out; } catch { /* reported below */ }
    if (out == null) { offenders.push(`${name}: out: did not resolve — NOT CHECKED, which is not the same as clean`); continue; }
    if (String(out).startsWith(guarded + "/")) offenders.push(`${name} -> ${out}`);
  }
  const P = paths(RUN);
  for (const [name, def] of Object.entries(STAGES)) {
    let out = null;
    try { out = typeof def.out === "function" ? def.out(P, "1") : def.out; } catch { /* reported below */ }
    if (out == null) { offenders.push(`${name}: out: did not resolve — NOT CHECKED`); continue; }
    if (String(out).startsWith(guarded + "/")) offenders.push(`${name} -> ${out}`);
  }
  assert.deepEqual(offenders, [],
    "a stage's dictated output lands inside the deny-hook's tree. The seat will be refused on Write AND on Bash and its corrective ladder will exhaust. Move the WORK out of the guarded tree (#991), or give the stage a driver-written transport — never weaken the hook.");
});

test("VOID CONTROL: that sweep really did examine both lanes", () => {
  // Every assertion above is an absence. If either lane resolved to nothing, the offenders list would be
  // empty and the guard would read as a pass while checking nothing at all.
  assert.ok(Object.keys(KO_STAGES).length >= 2, `the knockout lane has ${Object.keys(KO_STAGES).length} stages`);
  assert.ok(Object.keys(STAGES).length >= 15, `the main lane has ${Object.keys(STAGES).length} stages`);
  // …and the guard can fail: a synthetic stage pointed at the guarded tree must be caught by the same test.
  const planted = join(driverDir(resolve(RUN)), "planted.json");
  assert.ok(planted.startsWith(driverDir(resolve(RUN)) + "/"), "the predicate the sweep uses must match a guarded path");
  assert.ok(denyReason(planted, TREES), "…and the boundary must refuse it");
});

test("no code derives the run dir from the chunk path by FIXED DEPTH", () => {
  // THE SECOND DEFECT THE MOVE EXPOSED, and it cost two green-on-main e2e tests before I found it.
  // Two places reconstructed the run dir by walking UP from the chunk's path — `dirname(dirname(x))`,
  // one of them with the comment "chunk lives in _driver/" stating the assumption out loud. Moving the
  // chunk one level up made both overshoot, so every lookup beneath them (research payloads, the chunks
  // sidecar, framework.json) resolved against the wrong directory. It surfaced as an honest-looking and
  // completely false stage failure: "the driver holds NO research payload for this mark".
  //
  // A path is not just a location; it is an ANCHOR other code counts levels from. verify.mjs already
  // knew this — its sibling lookups try `[dirname(p), dirname(dirname(p))]` — and that depth-tolerant
  // idiom is what both sites now use.
  // THE VALIDATOR STILL PARSES THE PATH, so it still needs the depth-tolerant idiom. It reads a chunk's
  // index and run dir off a filename on the resume and archive branches, where the only thing it is
  // handed is the file.
  for (const [label, rel] of [["the validator", "../verify-knockout.mjs"]]) {
    const src = readFileSync(join(HERE, rel), "utf8");
    // — the product side compares against DRIVER_DIR. The rule asserted here is "tolerates both
    // chunk locations", not the spelling.
    assert.match(src, /basename\((?:chunkDir|dirname\([^)]*\))\) === (?:DRIVER_DIR|"_driver")/,
      `${label} no longer tolerates both chunk locations — it will resolve against the wrong run dir for one of them`);
  }

  // ── THE STAGE MOCK LEFT THIS POPULATION, AND THE STRONGER PROPERTY IS ASSERTED INSTEAD ───────────
  //
  // It used to be in the loop above, because it reconstructed the run dir by walking up from the chunk
  // path and had to tolerate both depths. The conversion removed the path from the
  // dispatch entirely, so the mock stopped deriving a run dir from a path at all — it reads the value the
  // driver wired, the same channel the real recording server reads.
  //
  // "It no longer needs the idiom" is a CLAIM, and dropping it from the loop without checking anything
  // would be an omitted claim disarming its own guard: a mock that quietly went back to path-walking
  // would then be unwatched by both arms. So the exemption is paid for — the mock must name no chunk
  // artifact at all, and must resolve its run dir from the wiring.
  const mock = readFileSync(join(HERE, "mock-stage-fixtures.mjs"), "utf8");
  assert.doesNotMatch(mock, /knockout-assess-\$?\{?\w*\}?\d*\.json|knockout-assess-\(\\d\+\)/,
    "the stage mock names a knockout-assess chunk artifact again. It resolves its run dir from the engine "
    + "wiring now and must not go back to deriving one from a dictated path — that is the defect this arm "
    + "was written for, and the dispatch no longer even carries a path to parse");
  assert.match(mock, /record_knockout_assess[\s\S]{0,600}?runDirFromWiring\(argv\)/,
    "the stage mock's knockout-assess branch no longer reads the run dir from the engine wiring — if it is "
    + "not reading CLEAROTRON_BAND_RUN_DIR it is getting the run dir from somewhere, and every candidate is a "
    + "path it counted levels from");
});

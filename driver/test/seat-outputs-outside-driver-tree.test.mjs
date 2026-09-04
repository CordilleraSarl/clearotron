// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NO STAGE MAY ORDER A SEAT TO WRITE INTO A TREE THE WRITE BOUNDARY FORBIDS IT.
//
// made `<runDir>/_driver/**` a tree a seat may never write into (authority-trees.mjs, `live: true`).
// When a stage's dispatch hands the seat a path inside it the deny fires, the seat writes the run root,
// the validator looks in `_driver/` and says `missing_file`, and the escalation ladder burns out on an
// artifact that already exists.
//
// ── WHY THIS FILE WAS REWRITTEN, AND IT IS THE WHOLE LESSON ─────────────────────────────────────────
//
// The first version of this guard (, 35c99792, 00:52) said it pinned "the RULE, not the path". It
// walked `stages.mjs` as SOURCE TEXT for two literal shapes — `out: (P) => P.<key>` and
// `writeReturn(P.<key>)` — and flagged a declaration only when the declaration's own text contained
// `join("_driver"`.
//
// At the moment it went green, `knockout-assess` was writing into `_driver/`. It stayed there until
// that afternoon (12c50575, 17:47): seventeen hours in which that stage failed every attempt in
// every knockout run and this guard was green. Three separate blind spots, each enough on its own:
//
//   1. ONE FILE. The walk read `stages.mjs`. `knockout-assess` is declared in `stages-knockout.mjs`.
//   2. ONE ARROW SHAPE. `out: (P) => P.<key>` misses every parameterised output — `commonLawHalf(half)`,
//      `reportCard(ord)` and `registerUnit(axis)` in stages.mjs, `assessChunk(n)` in the knockout table.
//      Four stage outputs were invisible inside the one file it did read.
//   3. TEXT, NOT PATHS. It asked whether the DECLARATION mentioned `join("_driver"`. `koPaths` builds
//      from a different root, so that substring never appeared no matter where the path landed.
//
// So this version resolves paths BEHAVIOURALLY — it calls each stage's real `out` against the real paths
// factory and asks the boundary about the real string — and it is DISCOVERED as well as enumerated: the
// census at the bottom fails if a stage table appears in a file the walk does not cover. An enumerated
// check is blind to the move, and that census is the only thing that closes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { authorityTrees, denyReason } from "../authority-trees.mjs";
import { STAGES, paths } from "../stages.mjs";
import { KO_STAGES, koPaths } from "../stages-knockout.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const RUN = "/run/x";
const DRIVER = fileURLToPath(new URL("..", import.meta.url));

// — THE VACUITY CHECK SITS ON THE WALK'S RESULT, and the walk is hoisted out of its arm so
// the empty direction can be driven. Guarding each recursive read turned one empty leaf directory into a
// throw before a single file was read: `driver/profiles/` is a runtime write target, so a deployed box
// grows one and no clone ever does — git stores no empty directory, so CI could never see it.
/** Every file under `root` that declares stage outputs, relative to `root`. */
const stageDeclaringFiles = (root = DRIVER) => {
  const declaring = [];
  const walk = (dir, prefix = "") => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "test" || entry.name === "node_modules") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(join(dir, entry.name), rel); continue; }
      if (!entry.name.endsWith(".mjs")) continue;
      // `out:` at the head of a line followed by an arrow parameter list — a stage def, not prose.
      if (/^\s*out:\s*\(/m.test(readFileSync(join(dir, entry.name), "utf8"))) declaring.push(rel);
    }
  };
  walk(root);
  return nonEmpty(declaring, `the stage-table walk of ${root}`);
};

// The stage tables and the paths factory each one resolves against. This list is the enumerated half,
// and it is only honest because the census test below proves it complete.
// `floor` is what the walk resolves TODAY: every one of the 16 + 2 stage defs declares an `out()`, so
// nothing is being skipped. Written as a floor rather than an equality because adding a stage is routine
// and losing one from the walk is not.
const TABLES = [
  { file: "stages.mjs", stages: STAGES, P: paths(RUN), floor: 16 },   // 19 -> 16: the three send stages left with the delivery mode
  { file: "stages-knockout.mjs", stages: KO_STAGES, P: koPaths(RUN), floor: 2 },
];

/**
 * Every absolute path a table's stages declare as their WRITE target, resolved for real.
 *
 * `out` is called with the table's own paths object plus a probe for each extra parameter, so a
 * parameterised output resolves to a real string instead of being skipped. Anything that fails to
 * resolve is returned in `unresolved`: an output this walk could not see is a finding, not a pass, and
 * every caller asserts on it.
 */
function writeTargets(table) {
  const targets = [];
  const unresolved = [];
  for (const [name, def] of Object.entries(table.stages)) {
    if (typeof def?.out !== "function") {
      // Not skipped. A stage the walk cannot see is the failure this whole file exists to stop, so a
      // stage with no `out()` has to be looked at and given a written exemption, not passed over.
      unresolved.push(`${name}: declares no out(), so nothing was asked of the boundary for it`);
      continue;
    }
    const probes = Array.from({ length: Math.max(0, def.out.length - 1) }, () => "probe");
    let value;
    try {
      value = def.out(table.P, ...probes);
    } catch (e) {
      unresolved.push(`${name}: out() threw — ${e.message}`);
      continue;
    }
    if (typeof value !== "string" || !value) {
      unresolved.push(`${name}: out() returned ${typeof value}, not a path`);
      continue;
    }
    targets.push({ name, path: value });
  }
  return { targets, unresolved };
}

/** The `writeReturn(X.key)` targets a file's dispatches hand the seat, resolved against the real paths. */
function writeReturnTargets(table) {
  const src = readFileSync(join(DRIVER, table.file), "utf8");
  const targets = [];
  for (const m of src.matchAll(/writeReturn\(\s*([A-Z])\.([A-Za-z][A-Za-z0-9]*)/g)) {
    const value = table.P[m[2]];
    const resolved = typeof value === "function" ? value("probe") : value;
    if (typeof resolved === "string" && resolved) targets.push({ name: `writeReturn(${m[1]}.${m[2]})`, path: resolved });
  }
  return targets;
}

const offenders = (targets, trees) =>
  targets.map(({ name, path }) => ({ name, path, why: denyReason(path, trees) }))
    .filter((r) => r.why)
    .map((r) => `${r.name} → ${r.path} (${r.why})`);

test("every seat-written stage output is outside the seat's forbidden trees", () => {
  const trees = authorityTrees({ runDir: RUN });
  const found = [];
  for (const table of TABLES) {
    const { targets, unresolved } = writeTargets(table);
    assert.deepEqual(unresolved, [],
      `${table.file}: a stage output could not be resolved, so it was never asked of the boundary`);
    assert.ok(targets.length >= table.floor,
      `${table.file}: resolved only ${targets.length} stage outputs (floor ${table.floor}) — the walk broke, not the tree`);
    found.push(...offenders([...targets, ...writeReturnTargets(table)], trees));
  }
  assert.deepEqual(found, [],
    "a stage told a seat to write where the write boundary denies it; move the artifact, do not widen the boundary");
});

test("the walk can still fail — a planted stage output inside _driver/ is caught, both arrow shapes", () => {
  // Without this arm the test above passes when resolution silently stops producing paths, which is
  // exactly how its predecessor read green through seventeen hours of a live offender.
  const trees = authorityTrees({ runDir: RUN });
  const planted = {
    stages: {
      "planted-plain": { out: () => driverDir(RUN, "planted.json") },
      "planted-parameterised": { out: (P, n) => driverDir(RUN, `planted-${n}.json`) },
    },
    P: paths(RUN),
  };
  const { targets, unresolved } = writeTargets(planted);
  assert.deepEqual(unresolved, []);
  assert.equal(targets.length, 2, "both planted stages must resolve, or the arm proves nothing");
  assert.equal(offenders(targets, trees).length, 2,
    "both planted outputs must be caught — the parameterised one is the shape the old guard could not see");
});

test("the boundary this rests on is actually armed — a VOID control would pass the walk above", () => {
  // If protectedTrees stopped naming _driver, the walk would find nothing and read as a pass.
  const trees = authorityTrees({ runDir: RUN });
  assert.ok(denyReason(driverDir(RUN, "anything.json"), trees),
    "_driver must still be a denied tree, or the first test is measuring nothing");
});

test("no stage table exists in a file this guard does not walk", () => {
  // The enumerated half is blind to the MOVE — a new lane declaring its own stages is invisible to it,
  // which is exactly how stages-knockout.mjs stayed unwalked. This is the discovered half.
  const walked = new Set(TABLES.map((t) => t.file));
  const declaring = stageDeclaringFiles();
  assert.ok(declaring.length > 0, "found no stage tables at all — the scan broke, not the tree");
  assert.deepEqual(declaring.filter((f) => !walked.has(f)).sort(), [],
    "a file declares stage outputs and this guard does not walk it; add it to TABLES with its paths factory");
});

test("tracker 2018 the stage-table walk refuses an empty tree, and an empty leaf is not one", () => {
  // BOTH DIRECTIONS. A guard moved onto the aggregate and a guard deleted read identically on a healthy
  // tree; only a walk handed an empty tree tells them apart.
  const tmp = mkdtempSync(join(tmpdir(), "b2018-seat-outputs-"));
  const leaf = join(DRIVER, "profiles", "projects", `b2018-${process.pid}`);
  try {
    mkdirSync(join(tmp, "a", "b"), { recursive: true });
    assert.throws(() => stageDeclaringFiles(tmp), /VACUOUS/,
      "a walk that descended a whole tree and declared nothing reported a corpus instead of refusing");

    const baseline = stageDeclaringFiles().sort();
    mkdirSync(leaf, { recursive: true });
    assert.deepEqual(stageDeclaringFiles().sort(), baseline,
      "an empty directory under the driver tree changed what this guard walks");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(leaf, { recursive: true, force: true });
  }
});

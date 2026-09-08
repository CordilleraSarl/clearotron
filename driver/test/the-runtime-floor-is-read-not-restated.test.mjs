// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE MINIMUM NODE VERSION HAS ONE SOURCE, AND IT IS COMPARED IN FULL — tracker issue 278.
//
// There were two spellings of one requirement. `package.json` declared `>=22.19.0`, which npm reads; the
// product's own check carried `NODE_FLOOR = 22` and compared `Number(version.split(".")[0]) >= 22`. A
// major-only comparison STRUCTURALLY CANNOT SEE A MINOR FLOOR, so 22.16.0 passed a check written for
// 22.19.0 — `doctor` printed a tick beside the exact version npm had just warned about.
//
// What it cost: an engine door exited 1 on a machine below the floor, every check the product offers said
// the runtime was fine, and the reader had no way to reach the cause.
//
// These arms drive versions rather than the runtime they happen to be on. A floor guard exercised only by
// running on an old Node is one nobody ever sees fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeFloorVerdict, nodeFloorRefusal, declaredRange, floorOf, meetsFloor } from "../../shared/node-floor.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("278 the floor is READ from package.json, not restated anywhere", () => {
  const declared = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).engines.node;
  assert.equal(declaredRange(ROOT), declared, "the reader must return the field npm itself reads");
  // The whole point: one source. If a second spelling appears, this is where it is caught.
  assert.deepEqual(floorOf(declared), floorOf(declaredRange(ROOT)));
});

test("278 a version below the floor by its MINOR is refused — the defect this replaces", () => {
  // 22.16.0 is the version the report came in on. Under the old major-only test it passed.
  assert.equal(nodeFloorVerdict({ current: "22.16.0", root: ROOT }).ok, false);
  assert.equal(nodeFloorVerdict({ current: "22.18.9", root: ROOT }).ok, false, "one patch below the floor is below it");
});

test("278 the floor itself and everything above it runs", () => {
  // Without this the arm above is satisfied by a check that refuses every version, which would stop the
  // product working entirely while passing a test named for correctness.
  for (const v of ["22.19.0", "22.19.1", "22.23.2", "23.0.0", "24.1.0"]) {
    assert.equal(nodeFloorVerdict({ current: v, root: ROOT }).ok, true, `${v} must run`);
  }
});

test("278 a major below the floor is refused whatever its minor", () => {
  for (const v of ["20.19.4", "20.99.99", "18.20.0"]) {
    assert.equal(nodeFloorVerdict({ current: v, root: ROOT }).ok, false, `${v} must be refused`);
  }
});

test("278 the refusal names both versions, because a reader must know what to install", () => {
  const v = nodeFloorVerdict({ current: "22.16.0", root: ROOT });
  const said = nodeFloorRefusal(v);
  assert.match(said, /22\.19\.0/, "the version they need");
  assert.match(said, /22\.16\.0/, "the version they have");
  assert.doesNotMatch(said, /\bNODE_FLOOR\b|process\.versions/, "a person is not told the name of a variable");
});

test("278 an unreadable or absent declaration THROWS rather than passing everything", () => {
  // A floor that cannot be read is a could-not-look. Defaulting to "fine" would make a packaging fault
  // silently disable every check built on it, which is how this class of guard usually dies.
  assert.throws(() => floorOf(">=22"), /does not understand/, "a range this reader cannot parse is refused");
  assert.throws(() => floorOf("^22.19.0"), /does not understand/);
  assert.throws(() => declaredRange("/nonexistent-root-for-this-check"), /ENOENT|no such file/i);
});

test("278 the comparison reads all three parts, in order", () => {
  assert.equal(meetsFloor("22.19.0", [22, 19, 0]), true, "equal meets the floor");
  assert.equal(meetsFloor("22.20.0", [22, 19, 5]), true, "a higher minor wins whatever the patch");
  assert.equal(meetsFloor("22.19.4", [22, 19, 5]), false, "a lower patch loses when major and minor tie");
  assert.equal(meetsFloor("23.0.0", [22, 19, 5]), true, "a higher major wins whatever follows");
});

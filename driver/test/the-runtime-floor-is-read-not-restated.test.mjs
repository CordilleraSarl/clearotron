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
  // DERIVED FROM THE DECLARED FLOOR, not written out. A check that restates the number is the defect it
  // is testing for: when the floor moves this must move with it, and a literal would either break or,
  // worse, keep passing while asserting about a floor nobody declares any more.
  const [maj, min, pat] = floorOf(declaredRange(ROOT));
  const below = min > 0 ? `${maj}.${min - 1}.${pat}` : `${maj - 1}.99.0`;
  assert.equal(nodeFloorVerdict({ current: below, root: ROOT }).ok, false,
    `${below} is below the declared floor and must be refused`);

  // And the comparison itself, at minor precision, against an EXPLICIT floor — so this keeps proving the
  // major-only defect is gone however the declared floor is later set. 22.16.0 is the version the
  // original report came in on, and under the old test it passed a floor of 22.19.0.
  assert.equal(meetsFloor("22.16.0", [22, 19, 0]), false, "a major-only comparison would have said true");
  assert.equal(meetsFloor("22.18.9", [22, 19, 0]), false);
});

test("278 the floor itself and everything above it runs", () => {
  // Without this the arm above is satisfied by a check that refuses every version, which would stop the
  // product working entirely while passing a test named for correctness.
  const [maj, min, pat] = floorOf(declaredRange(ROOT));
  for (const v of [`${maj}.${min}.${pat}`, `${maj}.${min}.${pat + 1}`, `${maj}.${min + 1}.0`, `${maj + 1}.0.0`]) {
    assert.equal(nodeFloorVerdict({ current: v, root: ROOT }).ok, true, `${v} must run`);
  }
});

test("278 a major below the floor is refused whatever its minor", () => {
  const [maj] = floorOf(declaredRange(ROOT));
  for (const v of [`${maj - 1}.19.4`, `${maj - 1}.99.99`, `${maj - 2}.20.0`]) {
    assert.equal(nodeFloorVerdict({ current: v, root: ROOT }).ok, false, `${v} must be refused`);
  }
});

test("278 the refusal names both versions, because a reader must know what to install", () => {
  const required = floorOf(declaredRange(ROOT)).join(".");
  const v = nodeFloorVerdict({ current: "1.2.3", root: ROOT });
  const said = nodeFloorRefusal(v);
  assert.ok(said.includes(required), `the version they need (${required}) must be in the sentence`);
  assert.ok(said.includes("1.2.3"), "the version they have");
  assert.doesNotMatch(said, /\bNODE_FLOOR\b|process\.versions/, "a person is not told the name of a variable");
});

test("278 an unreadable or absent declaration THROWS rather than passing everything", () => {
  // A floor that cannot be read is a could-not-look. Defaulting to "fine" would make a packaging fault
  // silently disable every check built on it, which is how this class of guard usually dies.
  // `>=22` and `>=22.19` ARE understood — absent parts are zero, which is what they mean. The floor is
  // edited by whoever changes it, and they should not have to know which spelling this reader expects.
  assert.deepEqual(floorOf(">=22"), [22, 0, 0]);
  assert.deepEqual(floorOf(">=22.19"), [22, 19, 0]);
  // What is refused is a range whose meaning this reader would have to GUESS at.
  assert.throws(() => floorOf("^22.19.0"), /does not understand/, "a caret range is not a floor");
  assert.throws(() => floorOf("~22.19"), /does not understand/);
  assert.throws(() => floorOf(">=20 || >=22"), /does not understand/, "a union has no single floor");
  assert.throws(() => declaredRange("/nonexistent-root-for-this-check"), /ENOENT|no such file/i);
});

test("278 the comparison reads all three parts, in order", () => {
  assert.equal(meetsFloor("22.19.0", [22, 19, 0]), true, "equal meets the floor");
  assert.equal(meetsFloor("22.20.0", [22, 19, 5]), true, "a higher minor wins whatever the patch");
  assert.equal(meetsFloor("22.19.4", [22, 19, 5]), false, "a lower patch loses when major and minor tie");
  assert.equal(meetsFloor("23.0.0", [22, 19, 5]), true, "a higher major wins whatever follows");
});

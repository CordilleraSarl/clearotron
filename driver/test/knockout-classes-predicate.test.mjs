// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// knockout-classes-predicate.test.mjs —: "did the request name any classes?", asked once.
//
// Three copies of one predicate, and the knockout copy read TOP-LEVEL ONLY:
//
//   enqueue-schema.mjs §B2      top-level `job.classes` OR any `marks[].classes`   ← the door
//   stages.mjs (clearance)      the same, and its comment says so out loud
//   stages-knockout.mjs         `job.classes` alone                                ← wrong
//
// A knockout is a BATCH KEYED ON `job.marks`, so per-mark classes is its natural shape — the one shape
// its own predicate could not see. The result was two wrongs in one line, and the door could catch
// neither, because §B2 admits such a request without comment: `marks[].classes` IS classes.
//
//   1. The parenthetical is FALSE — the request named class 25 and the model was told it named none.
//   2. It offers the WRONG classes — the customer's defaults, from a layer the requester did not choose
//      for this run, to a model framing a search for the class they did.
//
// Nothing throws. The run completes. The framing is merely aimed at the wrong goods, and the knockout's
// wording is "consider them" where the clearance lane says "apply these" — softer, which is why it would
// survive a reading and not a run.
//
// WHY THE THIRD COPY STAYS. `driver/stages.mjs` belongs to another lane's active work, so this does not
// refactor it; it PINS it. All three are asserted to agree on the same job shapes, so the copy this lane
// cannot touch is still checked, and a drift in any of them is a red suite rather than a prompt aimed at
// the wrong goods.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requestNamesClasses, validateJob } from "../enqueue-schema.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const code = (f) => readFileSync(join(ROOT, f), "utf8")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

// The measured shape, with an invented mark: per-mark classes, no top-level classes.
const PER_MARK = Object.freeze({
  id: "k1", msgId: "<k1@x>", forwarder: "ops",
  marks: [{ name: "ZEPHYRA", classes: [25] }],
});

test("#868 THE DEFECT: a request naming classes PER MARK named classes", () => {
  assert.equal(requestNamesClasses(PER_MARK), true,
    "this is the shape a knockout is built out of — a batch keyed on job.marks — and the predicate that "
    + "missed it told the framing model the request named none");
  // Top-level still counts, and so does either alone.
  assert.equal(requestNamesClasses({ classes: [9] }), true);
  assert.equal(requestNamesClasses({ classes: [9], marks: [{ name: "X" }] }), true);
});

test("#868 a request that truly names none still says so", () => {
  // The defaults line exists for exactly this case and must keep firing for it.
  for (const job of [
    {}, { classes: [] }, { marks: [] }, { marks: [{ name: "X" }] }, { marks: [{ name: "X", classes: [] }] },
    { classes: [], marks: [{ name: "X", classes: [] }] },
  ]) assert.equal(requestNamesClasses(job), false, `${JSON.stringify(job)} was read as naming classes`);
  // And nothing throws on a shape that is not a job.
  for (const x of [null, undefined, "s", 7, []]) assert.equal(requestNamesClasses(x), false);
});

test("#868 the knockout builder reads the predicate rather than re-deriving it", () => {
  const ko = code("driver/stages-knockout.mjs");
  assert.match(ko, /!requestNamesClasses\(job\)/,
    "the knockout frame no longer asks the intake's question with the intake's answer");
  // The old shape, spelled out, so re-introducing it is a red suite and not a review comment.
  assert.ok(!/defaultClasses[\s\S]{0,80}!\(Array\.isArray\(job\.classes\)/.test(ko),
    "a top-level-only classes check is back on the knockout defaults line — that IS #868");
  assert.match(ko, /from "\.\/enqueue-schema\.mjs"/, "and it takes it from the door, which owns the vocabulary");
});

test("#868 ALL THREE COPIES AGREE, including the one this lane does not own", () => {
  // stages.mjs carries its own correct copy and belongs to another lane's active work. Rather than leave
  // it unchecked, it is executed here as source-derived truth: the shapes below are the ones that
  // separated the three implementations, and any drift in any of them fails.
  const clearance = code("driver/stages.mjs");
  const koSrc = code("driver/stages-knockout.mjs");

  // The clearance copy must still be the classes-anywhere form — top-level AND a marks[] arm.
  const clause = /defaultClasses[\s\S]{0,400}?consider them|defaultClasses[\s\S]{0,400}?apply these/.exec(clearance);
  assert.ok(clause, "the clearance defaults line moved — this pin is now measuring nothing");
  assert.match(clause[0], /marks[\s\S]{0,120}?classes/,
    "the clearance copy lost its marks[] arm, which is the exact defect #868 filed against the knockout");

  // And the knockout copy must NOT have grown its own arm back — it delegates.
  const koClause = /defaultClasses[\s\S]{0,300}?consider them/.exec(koSrc);
  assert.ok(koClause, "the knockout defaults line moved — this pin is now measuring nothing");
  assert.ok(!/marks[\s\S]{0,120}?classes/.test(koClause[0]),
    "the knockout re-derived the predicate inline instead of calling it — a fourth copy is how this "
    + "issue happens again");
});

test("#868 the DOOR admits the shape without comment, which is why nothing upstream caught it", () => {
  // §B2's whole job is scopability, and per-mark classes satisfies it. So the door was right, the
  // framing was wrong, and the request sailed through with no warning naming either. That asymmetry is
  // the reason this needed a shared predicate rather than a fix at the door.
  // A COPY: validateJob normalises the job in place (it fills `geography` among others), and the frozen
  // fixture above is shared with the assertions that must see it unchanged.
  const v = validateJob({ ...PER_MARK, marks: PER_MARK.marks.map((m) => ({ ...m })) });
  assert.equal(v.ok, true);
  assert.equal(v.classify, "run");
  assert.ok(!v.warnings.some((w) => /class/i.test(w)),
    `the door warned about classes: ${JSON.stringify(v.warnings)} — if it does now, #868's "the door `
    + `cannot catch either" no longer holds and this test's premise needs re-reading`);
});

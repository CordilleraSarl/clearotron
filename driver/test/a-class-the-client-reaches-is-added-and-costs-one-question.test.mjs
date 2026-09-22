// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileRegisterPlan, awaitsReadingTurn } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MARK = "VELTRIS";
const MANIFEST = { schema_version: 1, mark: MARK, dominant_element: MARK,
  elements: [{ value: MARK, kind: "distinctive" }],
  variants: [{ value: MARK, category: "core" }, { value: "VELTRISS", category: "spelling" },
    { value: "WELTRIS", category: "sound-alike" }],
  incumbent_classes: [], goods_words: ["software"] };
const INSTRUCTED = ["9", "38", "41", "42"];
const JOB = { jobKey: "t", classes: INSTRUCTED, jurisdictions: [] };
const planWith = (addedClasses) => compileRegisterPlan({ manifest: MANIFEST, job: JOB,
  capabilities: PROVIDER_CAPABILITIES.clarivate, addedClasses });
const carrying = (plan, cls) => plan.entries.filter((e) => (e.nice_classes ?? []).includes(cls));

// ── DECISION 18: THE FRAME MAY ADD A CLASS THE CLIENT'S OWN GOODS REACH, AND IT COSTS ONE QUESTION ──
//
// The reviewing lawyer, given an order naming classes 9, 38, 41 and 42, added class 28 herself because
// the franchise is commercialised for video game accessories — and the engine, given the same
// instruction, did not. The frame has always been able to name such a class and its rows have always
// carried a reason. What was missing is the bound, in both directions: what makes a class worth adding,
// and what adding one is allowed to cost.

test("a matter that reaches a further class adds it, with its reason, for one question", () => {
  const reason = "the franchise sells video game accessories";
  const plan = planWith([{ class: "28", reason }]);
  const added = carrying(plan, "28");

  // ONE QUESTION, which is the bound. Before this, an added class was unioned into the plan's class
  // scope and landed on every entry — measured at five of six on a four-class order, every variant and
  // every family. The cost is now the identical mark in that class and nothing else.
  assert.equal(added.length, 1, `an added class cost ${added.length} questions instead of one`);
  assert.equal(added[0].term, MARK, "the added class asked something other than the identical mark");
  assert.deepEqual(added[0].nice_classes, ["28"], "the added question is not scoped to the class it was added for");
  assert.equal(added[0].added_class_reason, reason, "the reason did not ride with the question");
  assert.deepEqual(plan.added_classes, [{ class: "28", reason }],
    "the widening is not recorded on the plan, so nobody can read back that the bound held");

  // It is an identical-mark entry, so it runs without an ask (decision 10) — and being ungated
  // releases NOTHING. The waiting families still wait for the reading turn (ruling 204).
  assert.equal(added[0].when, undefined, "the added class waits, so the class would never be searched");
  assert.ok(plan.entries.some((e) => awaitsReadingTurn(e.when)),
    "adding a class released the waiting families — an added class is not an ask");
});

test("a matter that reaches no further class adds none", () => {
  // THE CONTROL, and the half a bound is worthless without. A widening mechanism that fires on every
  // matter is not bounded, it is just wider.
  const plan = planWith([]);
  assert.equal(plan.added_classes, undefined, "a matter that added nothing still recorded a widening");
  // CLASS 25 IS NOT A WIDENING AND IS DELIBERATELY EXCLUDED HERE. The merchandise cross-class probe is
  // the recipes' one standing exception to class scoping and predates this design by a long way — an
  // earlier cut of this arm swept it up and failed, which is the arm being wrong rather than the plan.
  // What decision 18 must not do is put a class here that the frame did not ask for.
  const merch = new Set(plan.entries.filter((e) => /\+merch$/.test(e.qid)).map((e) => e.qid));
  for (const e of plan.entries) {
    if (merch.has(e.qid)) continue;
    for (const c of e.nice_classes ?? []) {
      assert.ok(INSTRUCTED.includes(c), `class ${c} reached the plan though the frame added none`);
    }
  }
});

test("the bound's rejects, each measured", () => {
  // Stated as rejects in the design, so asserted as rejects here rather than as one happy path.
  for (const [label, rows] of [
    ["no reason at all", [{ class: "28" }]],
    ["a blank reason", [{ class: "28", reason: "   " }]],
    ["a class the order already named", [{ class: "9", reason: "already instructed" }]],
    ["a class number that is not one", [{ class: "0", reason: "why" }]],
    ["a class number past 45", [{ class: "46", reason: "why" }]],
    ["a class that is not a number", [{ class: "software", reason: "why" }]],
  ]) {
    const plan = planWith(rows);
    assert.equal(plan.added_classes, undefined, `${label}: was accepted as a widening`);
  }
  // The same class twice is one question, not two.
  const twice = planWith([{ class: "28", reason: "accessories" }, { class: "28", reason: "again" }]);
  assert.equal(twice.added_classes.length, 1, "the same added class was asked twice");
});

test("no instructed class is ever removed, whatever the frame says", () => {
  // THE ONE DIRECTION THAT REACHES A CLIENT AS A FALSE CLEAN. A widening that could also narrow would
  // drop ground the order paid for, and the report would not say so.
  for (const rows of [[], [{ class: "28", reason: "accessories" }],
    [{ class: "9", reason: "trying to restate an instructed class" }]]) {
    const plan = planWith(rows);
    const everywhere = new Set(plan.entries.flatMap((e) => e.nice_classes ?? []));
    for (const c of INSTRUCTED) {
      assert.ok(everywhere.has(c), `instructed class ${c} vanished from the plan`);
    }
  }
});

test("the shipped frame manual carries the owner's bound, not the older adjacency test", () => {
  // The older text asked whether a consumer would assume the same undertaking, which reaches classes a
  // COMPETITOR might hold — the widening the bound exists to refuse. The replacement is the owner's
  // ruled wording and it ships in the manual the engine reads, not only in a design document.
  const src = readFileSync(join(HERE, "..", "skills", "matter-frame", "SKILL.md"), "utf8");
  assert.match(src, /Which classes to search/, "the frame manual does not carry the section");
  assert.match(src, /Add a class only for the client's own goods, never for what a competitor might hold/,
    "the frame manual does not carry the bound");
  assert.match(src, /Never remove a class the order named/, "the frame manual does not forbid removal");
  assert.match(src, /the identical mark first, and the count looked at before anything is read/,
    "the frame manual does not say an added class is searched like every other");
  assert.doesNotMatch(src, /economically-linked undertaking/,
    "the older adjacency test still stands beside the bound that replaced it");
});

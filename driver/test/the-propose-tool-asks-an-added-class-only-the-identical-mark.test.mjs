// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PROPOSE TOOL ASKS AN ADDED CLASS ONLY THE IDENTICAL MARK, AS THE PLAN AND THE RE-SWEEP DO.
//
// The frame may add a class the client's goods reach, and that class costs one question: the identical mark, which the
// plan compiler asks. The re-sweep keeps to that bound; the propose tool did not, so on a test run of a crowded matter
// the review's send-back asked script and sound-alike questions in an added class. Now a proposal naming only an added
// class becomes the plan's own question there, served by the plan's answer; one naming an instructed class too is asked
// in the instructed class alone; and one in an added class the plan asks nothing in is left out. None of them is an
// open question. Driven through the propose tool and the real executor, against a stand-in register that records every
// request. Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { proposeSupplemental } from "../engine/mcp/supplemental.mjs";
import { makeExecutePlan } from "../../providers/_shared/execute-plan.mjs";

const AXIS = "transliteration-numeric";
const PLAN_C28 = "primary-sweep:exact:qzorvak:c28";
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const record = (id) => ({ record_id: `/mark/eu/${id}`, mark_text: "QZORVAK", classes: [28], status: "Registered" });

function seed(t, { planAsksTheAddedClass = true } = {}) {
  const run = mkdtempSync(join(tmpdir(), "added-class-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(driverDir(run), { recursive: true });
  mkdirSync(join(run, "register-units"), { recursive: true });
  const reason = "the client's goods reach toys";
  writeFileSync(driverDir(run, "register-plan.json"), JSON.stringify({ regions: ["EU"], nice_classes: ["9"], added_classes: [{ class: "28", reason }], entries: [
    { qid: "primary-sweep:exact:qzorvak", axis: "primary-sweep", predicate: "exact", term: "QZORVAK", provenance: "mark", nice_classes: [9] },
    ...(planAsksTheAddedClass ? [{ qid: PLAN_C28, axis: "primary-sweep", predicate: "exact", term: "QZORVAK", provenance: "mark", nice_classes: [28], added_class_reason: reason }] : []),
  ] }));
  writeFileSync(join(run, "register-units", "primary-sweep-band.json"), JSON.stringify(planAsksTheAddedClass
    ? [{ qid: PLAN_C28, state: "enumerated", total_hits: 1, count: 1, records: [record("c28-1")] }] : []));
  const asked = [];
  const answer = (p) => { asked.push({ name: p.name, classes: (p.nice_classes ?? []).map(String) }); return ok({ state: "enumerated", total_hits: 0, count: 0, records: [] }); };
  const real = makeExecutePlan({ search: async (_a, p) => answer(p), enumerate: async (_a, p) => answer(p), capabilities: { id: "a-register-that-needs-no-office" } });
  const propose = async (proposals) => JSON.parse((await proposeSupplemental({ axis: AXIS, output_path: join(run, "register-units", `${AXIS}-band.json`), proposals },
    { kind: "propose_supplemental", sessionKey: "run-x" }, { executePlan: (params, tctx) => real("auth", params, tctx) })).text);
  return { asked, propose };
}

test("a script question in an added class becomes the plan's own question there, sends no request and is not an open question", async (t) => {
  const { asked, propose } = seed(t);
  const r = await propose([{ predicate: "default", term: "КЗОРВАК", nice_classes: [28], rationale: "the mark in another script" }]);
  assert.deepEqual(asked, [], "the register was asked a second question in the added class");
  assert.deepEqual(r.rejected, [], "a question the bound leaves out became an open question");
  assert.ok((r.held ?? []).some((h) => h.answered_by === PLAN_C28), `the plan's own question was not served from its answer: ${JSON.stringify(r)}`);
});

test("the identical mark in an added class is served by the plan's own answer", async (t) => {
  const { asked, propose } = seed(t);
  const r = await propose([{ predicate: "exact", term: "QZORVAK", nice_classes: [28], rationale: "the identical mark in the added class" }]);
  assert.deepEqual(asked, [], "the plan's own question was asked again");
  assert.ok((r.held ?? []).some((h) => h.answered_by === PLAN_C28), JSON.stringify(r));
});

test("a proposal naming an instructed class and an added class is asked in the instructed class alone", async (t) => {
  const { asked, propose } = seed(t);
  await propose([{ predicate: "default", term: "QZORVEK", nice_classes: [9, 28], rationale: "a near spelling of the mark" }]);
  assert.ok(asked.length > 0, "guard: the instructed class was asked");
  assert.ok(asked.every((a) => a.classes.length && a.classes.every((c) => c === "9")), `an added class rode along: ${JSON.stringify(asked)}`);
});

test("a question in an added class the plan asks nothing in is left out, not asked and not open", async (t) => {
  const { asked, propose } = seed(t, { planAsksTheAddedClass: false });
  const r = await propose([{ predicate: "default", term: "QZORVEK", nice_classes: [28], rationale: "a near spelling of the mark" }]);
  assert.deepEqual(asked, [], "the register was asked a question in the added class");
  assert.deepEqual(r.rejected, [], "a question the bound leaves out became an open question");
  assert.deepEqual(r.excluded_added_class, ["QZORVEK"]);
});

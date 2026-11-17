// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STEP WHOSE ONLY SUPPORT WAS WITHDRAWN STAYS OFF THE PAGE WHEN A SAVE UNCITES IT.
//
// A step whose cited findings are all withdrawn renders nowhere; a step that cites none renders as a run-level step.
// The delivery check sends a step resting on a withdrawn finding to the writer's repair, whose ruling is to cite a
// surviving finding where its evidence supports the step, or to correct the step, never to remove the broken link and
// keep the conclusion. In testing, 2026-11-17, the repair removed every citation of such a step and kept it, longer and
// naming the withdrawn findings' owners: it reached the page as a run-level step that nothing on the page introduced,
// longer than the verdict's "conditional on:" clause. A save that sends such a step back with no citation now leaves it
// resting on the findings it cited, and the writer's text stays in the record. Every mark and owner here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordSynthesis, stepsOnWithdrawnSupport, FINDINGS_FILE } from "../synthesis-record.mjs";
import { buildOnlyYouSection } from "../pipeline.mjs";
import { actionBoundLineChecks } from "../predelivery-lint.mjs";
import { deriveActionConditions } from "../findings-model.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
const PARTIES = [["Halvorne Works", "TESSARIN"], ["Quillmere Ltd", "ODRAVEL"], ["Pennick Supply", "MARVETTE"]];
const MARKER = { applied: true, note: "invented: the review's flags applied" };
const WITHDREW = "The invented review flag found the protected goods unavailable, so the rating was unsupported.";

const STEPS = [
  { id: 1, kind: "senior-clearance", text: "Clear TESSARIN with Halvorne Works before filing.", ordinals: [1] },
  { id: 2, kind: "senior-clearance", text: "Seek coexistence terms for ODRAVEL and MARVETTE.", ordinals: [2, 3] },
  { id: 3, kind: "senior-clearance", text: "Confirm the class overlap with the owner of TESSARIN.", ordinals: [1, 2] },
];
// The repair's restatement of step 2: no citation left, the withdrawn findings' owners named, past the clause's length.
const RESTATED = "Before filing, establish whether Quillmere Ltd and Pennick Supply still use ODRAVEL and MARVETTE for the "
  + "client's goods in the filed class, and whether either would consent or coexist, since each record's protected goods "
  + "could not be read in full at this step.";

/** The record the writer saved first: three live findings, with the steps above. */
function firstRecord() {
  const doc = JSON.parse(synthesisFindings(null));
  const base = doc.findings[0];
  return { ...doc, actions: structuredClone(STEPS), findings: PARTIES.map(([owner, mark], i) => {
    const f = structuredClone(base);
    f.ordinal = i + 1;
    f.mark = mark;
    f.owner.name = owner;
    f.owner.registrations[0].uri = `/mark/us/9500000${i + 1}`;
    return f;
  }) };
}

const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** A run after its correction: findings 2 and 3 withdrawn, the steps as the first draft wrote them. */
function corrected() {
  const dir = mkdtempSync(join(tmpdir(), "withdrawn-support-"));
  dirs.push(dir);
  mkdirSync(driverDir(dir), { recursive: true });
  const first = firstRecord();
  assert.equal(recordSynthesis(dir, { narrative: NARRATIVE, findings: first }).refused, null, "the first save was refused");
  const rows = first.findings.slice(1).map((f) => ({ ...f, disposition: "withdrawn", withdrawn_reason: WITHDREW }));
  const r = recordSynthesis(dir, { findings: { corrections: MARKER }, findings_patch: rows });
  assert.equal(r.refused, null, `the correction was refused: ${r.refused}`);
  return dir;
}
const onDisk = (dir) => JSON.parse(readFileSync(join(dir, FINDINGS_FILE), "utf8"));
const accepted = (dir) => JSON.parse(readFileSync(driverDir(dir, "synthesis-calls", "accepted.json"), "utf8")).params.findings;
// A run that logged nothing has no log file, so a missing file is no rows.
const logRows = (dir, event) => (existsSync(driverDir(dir, "run.jsonl")) ? readFileSync(driverDir(dir, "run.jsonl"), "utf8") : "")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((o) => o.event === event);
const repairSends = (steps) => ({ findings: { corrections: MARKER, actions: steps } });
const step = (id, over) => ({ ...STEPS.find((s) => s.id === id), ...over });

test("the repair that uncites a step whose only support was withdrawn leaves it off the page, and keeps the writer's text", () => {
  const dir = corrected();
  const before = onDisk(dir);
  assert.deepEqual(deriveActionConditions(before.actions, before.findings).conditionActions.map((a) => a.id), [1, 3],
    "guard: before the repair, the step resting only on withdrawn findings is already off the page");

  const sent = [step(1), step(2, { text: RESTATED, ordinals: [] }), step(3, { ordinals: [1] })];
  // What the save would deliver as sent: the step on the page, naming the withdrawn findings' owners, and too long.
  assert.ok(buildOnlyYouSection(sent, before.findings).includes("Quillmere Ltd"), "guard: the step as sent does not reach the page");
  assert.equal(actionBoundLineChecks(sent, before.findings)[0].pass, false, "guard: the step as sent fits the clause");

  const r = recordSynthesis(dir, repairSends(sent));
  assert.equal(r.refused, null, `the repair was refused: ${r.refused}`);
  const after = onDisk(dir);
  const two = after.actions.find((a) => a.id === 2);
  assert.deepEqual(two.ordinals, [2, 3], "the step whose only support was withdrawn was saved as a run-level step");
  assert.equal(two.text, RESTATED, "the writer's text did not stay in the record");
  assert.deepEqual(after.actions.find((a) => a.id === 3).ordinals, [1], "a step keeping a live citation is not the writer's as sent");
  assert.deepEqual(accepted(dir).actions.find((a) => a.id === 2).ordinals, [2, 3], "the next patch's base does not keep the step's citations");

  const page = buildOnlyYouSection(after.actions, after.findings);
  for (const owner of ["Quillmere Ltd", "Pennick Supply"]) assert.ok(!page.includes(owner), `the page names ${owner}, whose only finding was withdrawn`);
  assert.equal(actionBoundLineChecks(after.actions, after.findings)[0].pass, true, "the verdict's clause still carries the held step");
  assert.deepEqual(logRows(dir, "step-kept-on-withdrawn-support").map((o) => o.kept), [[{ id: 2, ordinals: [2, 3] }]]);
});

test("a step the save cites to a surviving finding, still cites to a withdrawn one, or leaves out is the writer's as sent", () => {
  for (const [name, sent, expect] of [
    ["cited to a surviving finding", step(2, { ordinals: [1] }), [1]],
    ["still citing one withdrawn finding", step(2, { ordinals: [3] }), [3]],
  ]) {
    const dir = corrected();
    assert.equal(recordSynthesis(dir, repairSends([step(1), sent, step(3)])).refused, null, name);
    assert.deepEqual(onDisk(dir).actions.find((a) => a.id === 2).ordinals, expect, name);
    assert.deepEqual(logRows(dir, "step-kept-on-withdrawn-support"), [], `${name}: a step was held`);
  }
  const dir = corrected();
  assert.equal(recordSynthesis(dir, repairSends([step(1), step(3)])).refused, null, "left out");
  assert.deepEqual(onDisk(dir).actions.map((a) => a.id), [1, 3], "a step the save left out came back");
});

test("a step that was run-level before the save, or rests on a live finding, may be sent with no citation", () => {
  const stored = { actions: [{ id: 1, ordinals: [] }, { id: 2, ordinals: [1, 2] }, { id: 3, ordinals: [2] }],
    findings: [{ ordinal: 1 }, { ordinal: 2, disposition: "withdrawn" }] };
  const saved = { ...stored, actions: stored.actions.map((a) => ({ ...a, ordinals: [] })) };
  const r = stepsOnWithdrawnSupport(stored, saved);
  assert.deepEqual(r.kept, [{ id: 3, ordinals: [2] }]);
  assert.deepEqual(r.actions.map((a) => a.ordinals), [[], [], [2]]);
  // The finding withdrawn by the same save is read as withdrawn.
  const same = stepsOnWithdrawnSupport({ actions: [{ id: 1, ordinals: [1] }], findings: [{ ordinal: 1 }] },
    { actions: [{ id: 1, ordinals: [] }], findings: [{ ordinal: 1, disposition: "withdrawn" }] });
  assert.deepEqual(same.kept, [{ id: 1, ordinals: [1] }]);
  // No withdrawn finding, or no steps register, changes nothing.
  assert.deepEqual(stepsOnWithdrawnSupport({ actions: [{ id: 1, ordinals: [1] }] }, { actions: [{ id: 1, ordinals: [] }], findings: [{ ordinal: 1 }] }).kept, []);
  assert.deepEqual(stepsOnWithdrawnSupport(null, { actions: [] }).kept, []);
});

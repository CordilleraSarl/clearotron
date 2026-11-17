// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A LEAD THAT LOSES ITS RATING IN THE CORRECTION KEEPS ITS IDENTIFICATION STEP.
//
// A correction can withdraw a lead's rating because nothing the run holds identifies its proprietor, and turn the step
// that cited the rating into a run-level step asking who stands behind the lead, under the same id, with no citation,
// beside an open coverage row of its area that names the lead. The save keeps a step whose only support was withdrawn
// off the page when a save uncites it; that hold must not take the identification step with it. A step that names a
// party only the withdrawn finding carried is still held. Every mark and owner here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordSynthesis, FINDINGS_FILE } from "../synthesis-record.mjs";
import { buildOnlyYouSection } from "../pipeline.mjs";
import { actionBoundLineChecks, referenceChecks, pageNameLines } from "../predelivery-lint.mjs";
import { deriveActionConditions } from "../findings-model.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
const MARKER = { applied: true, note: "invented: the review's flags applied" };
const LEAD = "Vellicor Quest";
const LEAD_URI = "/mark/us/95000002";
// The first draft rated the lead with an owner nobody had identified.
const PARTIES = [["Halvorne Works", "TESSARIN"], ["Unverified", "VELLICOR QUEST"]];
const WITHDREW = "The record names no applicant or proprietor, and no source the run holds identifies one, so the lead carries no band.";

const FIRST_STEPS = [
  { id: 1, kind: "senior-clearance", text: "Clear TESSARIN with Halvorne Works before filing.", ordinals: [1] },
  { id: 2, kind: "senior-clearance", text: "Seek coexistence terms for VELLICOR QUEST before filing.", ordinals: [2] },
];
// The identification step the route asks for, sent under the step's own id with no citation.
const IDENTIFY = { id: 2, kind: "senior-clearance", ordinals: [],
  text: `Identify who stands behind ${LEAD}, and for what goods, before relying on this clearance.`,
  condition: `No source this search holds identifies who stands behind ${LEAD}.` };
const OPEN_ROW = { area: "register / US", state: "open", note: `${LEAD}: the filing names no applicant or proprietor` };
const OPEN_ROW_UNNAMED = { area: "register / US", state: "open", note: "one filing's owner is not identified" };

function firstRecord(owner) {
  const doc = JSON.parse(synthesisFindings(null));
  const base = doc.findings[0];
  return { ...doc, actions: structuredClone(FIRST_STEPS), findings: PARTIES.map(([name, mark], i) => {
    const f = structuredClone(base);
    f.ordinal = i + 1;
    f.mark = mark;
    f.owner.name = i === 1 && owner ? owner : name;
    f.owner.registrations[0].uri = i === 1 ? LEAD_URI : `/mark/us/9500000${i + 1}`;
    return f;
  }) };
}

const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** A run whose first draft rated the lead. */
function rated(owner) {
  const dir = mkdtempSync(join(tmpdir(), "identification-step-"));
  dirs.push(dir);
  mkdirSync(driverDir(dir), { recursive: true });
  const first = firstRecord(owner);
  assert.equal(recordSynthesis(dir, { narrative: NARRATIVE, findings: first }).refused, null, "the first save was refused");
  return { dir, first };
}
/** The correction, in one save: the lead's rating withdrawn, the steps and coverage rows as given. */
function correct({ dir, first }, steps, row) {
  const withdrawn = { ...first.findings[1], disposition: "withdrawn", withdrawn_reason: WITHDREW };
  const r = recordSynthesis(dir, { findings: { corrections: MARKER, actions: steps, coverage: [...first.coverage, row] }, findings_patch: [withdrawn] });
  assert.equal(r.refused, null, `the correction was refused: ${r.refused}`);
  return JSON.parse(readFileSync(join(dir, FINDINGS_FILE), "utf8"));
}
const logRows = (dir, event) => (existsSync(driverDir(dir, "run.jsonl")) ? readFileSync(driverDir(dir, "run.jsonl"), "utf8") : "")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((o) => o.event === event);
const reference = (after) => {
  const section = buildOnlyYouSection(after.actions, after.findings);
  // Each live finding's card introduces its owner; the withdrawn one has no card.
  const cards = after.findings.filter((f) => f.disposition !== "withdrawn").map((f) => `<h3>${f.mark}, held by ${f.owner.name}</h3>`).join("");
  return referenceChecks({ actionsText: section, fullSurface: `${cards}${section}`,
    searchedNames: [], markNames: after.findings.filter((f) => f.disposition !== "withdrawn").map((f) => f.mark), surface: "report",
    structural: true, introducedIn: pageNameLines({ coverage: after.coverage }).join("\n") })[0];
};

test("the step that cited the lead's withdrawn rating comes back as its identification step, on the page and conditioning the run", () => {
  const run = rated();
  const after = correct(run, [FIRST_STEPS[0], IDENTIFY], OPEN_ROW);
  assert.equal(after.findings.find((f) => f.ordinal === 2).disposition, "withdrawn", "guard: the lead kept its rating");

  const two = after.actions.find((a) => a.id === 2);
  assert.deepEqual(two.ordinals, [], "the identification step was held on the withdrawn rating");
  assert.equal(two.text, IDENTIFY.text);
  assert.deepEqual(logRows(run.dir, "step-kept-on-withdrawn-support"), [], "the identification step was logged as held");

  assert.ok(buildOnlyYouSection(after.actions, after.findings).includes(IDENTIFY.text), "the identification step is not on the page");
  assert.deepEqual(deriveActionConditions(after.actions, after.findings).conditionActions.map((a) => a.id), [1, 2],
    "the identification step does not condition the run");
  assert.equal(actionBoundLineChecks(after.actions, after.findings)[0].pass, true, "the identification step does not fit the verdict's clause");
  const ri = reference(after);
  assert.equal(ri.pass, true, `the page does not introduce the lead the step names: ${JSON.stringify(ri.orphans)}`);
  assert.ok(after.coverage.some((c) => c.state === "open" && c.note.includes(LEAD)), "the open coverage row naming the lead is gone");
});

test("an identification step sent under a new id is the writer's as sent", () => {
  const run = rated();
  const after = correct(run, [FIRST_STEPS[0], { ...IDENTIFY, id: 3 }], OPEN_ROW);
  assert.deepEqual(after.actions.map((a) => [a.id, a.ordinals]), [[1, [1]], [3, []]]);
  assert.deepEqual(logRows(run.dir, "step-kept-on-withdrawn-support"), []);
});

test("the same step is still held when no open coverage row names the lead, or when it names a party only the withdrawn finding carried", () => {
  for (const [name, step, row, owner] of [
    ["no open row names the lead", IDENTIFY, OPEN_ROW_UNNAMED],
    // The first draft gave the lead an owner the correction found nothing to support, and the step still names it.
    ["it also names the withdrawn finding's owner, which nothing introduces",
      { ...IDENTIFY, text: `Identify whether Orrin Vale Holdings stands behind ${LEAD}, and for what goods, before relying on this clearance.` },
      OPEN_ROW, "Orrin Vale Holdings"],
  ]) {
    const run = rated(owner);
    const after = correct(run, [FIRST_STEPS[0], step], row);
    assert.deepEqual(after.actions.find((a) => a.id === 2).ordinals, [2], `${name}: the step reached the page`);
    assert.deepEqual(logRows(run.dir, "step-kept-on-withdrawn-support").map((o) => o.kept), [[{ id: 2, ordinals: [2] }]], name);
  }
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A client who ratified two forms of one name is owed a read of each, and something has to enforce it.
//
// WHAT WAS MISSING. Synthesis is told to reason each ratified form through the framework and to say
// which conflicts move between them, or to state in one line that the reads are the same for both. The
// arms on that dictation are literal matches on its prose: they red when the wording moves and they
// cannot red when a model ignores the ask. There was no deterministic floor because there was no typed
// source — the second form arrived in the instruction prose, and `job.marks` with more than one entry
// means a BATCH, which is a different product entirely.
//
// SO THE FLOOR IS GATED ON A TYPED FIELD, and everything here is about that gate being off by default.
// A narrative that never mentions the second form is indistinguishable from one that examined it and
// found nothing — that is the whole defect, and it is why the floor asks only that each form be NAMED.
// It does not judge the reasoning; a floor that tried would be a worse refutation pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptMatterFrame, recordMatterFrame, frameRatifiedForms, renderMatterFrame } from "../matter-frame-record.mjs";
import { validators } from "../verify.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { STAGES, paths } from "../stages.mjs";

const SCOPE = { marks: ["NOVAPULSE"], classes: [9], jurisdictions: ["EU", "US"] };
const PARAMS = {
  prose_body: "The matter, framed.".padEnd(320, " ."),
  scope_basis: "instructed",
  scope_jurisdictions: ["EU", "US"],
  excluded_jurisdictions: [],
  search_channels: ["amazon.com"],
  meaning_angles: [],
  meaning_angles_none: true,
  intake_asks: [],
  identified_classes: [],
};

/** A run whose frame froze exactly these forms. `null` writes no frame at all. */
function runWithForms(forms) {
  const d = mkdtempSync(join(tmpdir(), "two-form-"));
  mkdirSync(driverDir(d), { recursive: true });
  writeFileSync(driverDir(d, "instructed-scope.json"), JSON.stringify(SCOPE));
  if (forms !== null) {
    // The real recorder, given the real params — it accepts, merges and writes the base itself. Handing
    // it a verdict object instead would write a frame with no fields, which is how this fixture first
    // reported the gate as off while the gate was fine.
    const r = recordMatterFrame(d, { ...PARAMS, ...(forms.length ? { ratified_forms: forms } : {}) });
    assert.ok(r.written, `the fixture's own frame was refused: ${r.refused ?? r.reason}`);
  }
  return d;
}

/** Drive the real validator against a narrative in that run. */
const verdict = (dir, narrative) =>
  validators.narrative(join(dir, "narrative.md"), narrative.padEnd(320, " ."));

const BOTH = "NOVAPULSE reads clean. NOVAPULSE PRO carries the Vantor conflict the plain form does not.";
const ONE_ONLY = "NOVAPULSE reads clean against the register and the open web.";
const ALIKE = "NOVAPULSE reads clean; the reads are the same for both forms.";

test("THE GATE IS OFF unless the frame froze more than one form — every other run verifies as before", () => {
  // The four ways a run reaches this validator without owing anything, driven rather than reasoned.
  // Each one is a real archived shape: a run before the field existed, a replayed one, an ordinary
  // single-form matter, and a run with no frame at all. A narrative naming nothing must pass in all of
  // them, or this change has altered every run that ever ran.
  //
  // THE NARRATIVE HERE NAMES NO FORM AT ALL, and that is the whole design of this arm. It first used a
  // narrative that happened to name the single form — so with the gate widened to fire on ONE form it
  // still passed, because the form was named. The arm read as "the gate is off" while actually
  // asserting "the narrative satisfies a gate that is on". A plant is what said so.
  const NAMES_NOTHING = "The register reads clean and the open web adds nothing of substance.";
  for (const [name, forms] of [
    ["no frame at all", null],
    ["a frame with no such field (legacy or replayed)", []],
    ["one ratified form, the ordinary matter", ["NOVAPULSE"]],
  ]) {
    const r = verdict(runWithForms(forms), NAMES_NOTHING);
    assert.equal(r.ok, true, `${name}: a narrative owing nothing was refused — ${r.reason}`);
  }
  // AND THE BOUNDARY ITSELF: two forms, the same narrative naming neither, must be refused. Without
  // this the three passes above are consistent with a gate that never fires at all.
  assert.equal(verdict(runWithForms(["NOVAPULSE", "NOVAPULSE PRO"]), NAMES_NOTHING).ok, false,
    "the same narrative passed with TWO forms frozen — the gate is off in every case, which is not a gate");
});

test("A NARRATIVE THAT NEVER NAMES THE SECOND FORM IS REFUSED, and the refusal says which", () => {
  const r = verdict(runWithForms(["NOVAPULSE", "NOVAPULSE PRO"]), ONE_ONLY);
  assert.equal(r.ok, false, "the defect this exists for went through: a second form examined by nobody");
  assert.match(String(r.reason), /^ratified_form_unread:/, "token-first, like every refusal in this file");
  assert.match(String(r.reason), /1:of:2/, "the refusal does not say how many of how many");
  assert.match(String(r.reason), /NOVAPULSE PRO/, "…nor which form, which is what a seat needs to act");
});

test("naming both forms passes, and so does stating they read alike", () => {
  const forms = ["NOVAPULSE", "NOVAPULSE PRO"];
  assert.equal(verdict(runWithForms(forms), BOTH).ok, true, "a narrative that read each form was refused");
  // THE ALTERNATIVE IS NOT A LOOPHOLE, it is the dictation's own other answer. Silence and "they read
  // alike" are different claims, and only one of them is a decision. It must be stated to be taken.
  assert.equal(verdict(runWithForms(forms), ALIKE).ok, true, "the stated-alike line was not accepted");
  assert.equal(verdict(runWithForms(forms), ONE_ONLY).ok, false,
    "silence passed where the alike line would have — then the alternative is doing no work");
});

test("the match is case-insensitive, because a form is a name and a narrative is prose", () => {
  const r = verdict(runWithForms(["NOVAPULSE", "NovaPulse Pro"]), "Novapulse reads clean. NOVAPULSE PRO carries the Vantor conflict.");
  assert.equal(r.ok, true, `a form named in a different case read as unnamed — ${r.reason}`);
});

test("THE ACCEPTOR refuses the rows that would make the floor meaningless", () => {
  const bad = (forms) => acceptMatterFrame({ ...PARAMS, ratified_forms: forms }, { instructedScope: SCOPE });
  assert.match(String(bad([""]).reason), /matterframe_ratified_form_empty/, "a blank row is a form the narrative can never name");
  assert.match(String(bad(["NOVAPULSE", "NOVAPULSE"]).reason), /matterframe_ratified_form_duplicate/);
  // ONE FORM WRITTEN TWICE IS NOT TWO FORMS. Without this the floor would demand a distinction the
  // client never made, and the seat would have to invent one to satisfy it.
  assert.match(String(bad(["NOVAPULSE", "novapulse"]).reason), /matterframe_ratified_form_duplicate/,
    "two rows differing only in case were accepted as two forms");
  assert.equal(bad(["NOVAPULSE", "NOVAPULSE PRO"]).ok, true, "two real forms were refused");
});

test("the frame RENDERS the forms when there are two, and says nothing when there is one", () => {
  // A fact about what was bought belongs where a reader sees it, not only in a field. One form renders
  // nothing: a row saying the name is itself tells a reader nothing the heading did not.
  const two = acceptMatterFrame({ ...PARAMS, ratified_forms: ["NOVAPULSE", "NOVAPULSE PRO"] }, { instructedScope: SCOPE });
  assert.match(renderMatterFrame(two.model ?? two), /\*\*Ratified forms:\*\* NOVAPULSE, NOVAPULSE PRO/);
  const one = acceptMatterFrame({ ...PARAMS, ratified_forms: ["NOVAPULSE"] }, { instructedScope: SCOPE });
  assert.doesNotMatch(renderMatterFrame(one.model ?? one), /Ratified forms/, "one form drew a row that says nothing");
});

test("the accessor reads what the frame froze, and is empty wherever there is no answer", () => {
  assert.deepEqual(frameRatifiedForms(runWithForms(["NOVAPULSE", "NOVAPULSE PRO"])), ["NOVAPULSE", "NOVAPULSE PRO"]);
  assert.deepEqual(frameRatifiedForms(runWithForms([])), [], "a frame without the field");
  assert.deepEqual(frameRatifiedForms(runWithForms(null)), [], "a run with no frame");
  assert.deepEqual(frameRatifiedForms("/no/such/run"), [], "a path that does not exist is empty, never a throw");
});

test("THE FRAME IS TOLD TO SEND THE FIELD — without it the floor is green because it is inert", () => {
  // THE WHOLE CHAIN FAILS SILENTLY AT THIS LINK, which is why it gets an arm of its own. A typed field
  // nothing asks for is never filled; `frameRatifiedForms` then returns [] on every run; the gate reads
  // `forms.length > 1` as false forever; and the floor reports a clean tree while enforcing nothing.
  // That is this issue's own defect — a guard that cannot red — arriving one layer above the guard.
  //
  // AND IT CARRIES ITS OWN IMPERATIVE, which is a measured rule in that file rather than a style: a
  // field phrased outside one was written 0 of 9 times against 74 of 74 when imperative-carried. So the
  // arm asks for the sentence, not merely the word.
  // COMPOSED, not read off the source. A dictation is built from its stage's own `message(ctx)` with a
  // real context — asserting against the file's text would pass on a sentence that never reaches a seat.
  const ctx = {
    paths: paths(mkdtempSync(join(tmpdir(), "two-form-dictation-"))),
    job: { markName: "NOVAPULSE", classes: ["9"], jurisdictions: ["US"] },
    customerUnknown: false, profile: {}, intakeAsks: null, enforcerSignals: 0, framework: null,
    jxAim: 0, registerOnly: false, crowdContext: null, dispatchBlocks: null, findingsSurface: null,
    depth: null, displayVerdict: null, searchPolicy: null,
  };
  const dictation = String(STAGES["matter-frame"].message(ctx));
  assert.ok(dictation.length > 400, "the matter-frame dictation did not compose — this arm is measuring nothing");
  assert.match(dictation, /ratified_forms/, "nothing asks the frame for the forms, so the field is never filled");
  assert.match(dictation, /Send `ratified_forms`/, "the field is mentioned but not ASKED for in its own imperative");
  assert.match(dictation, /ONLY if the instruction ratifies more than one form/i,
    "the ask is unconditional, so a single-name matter will be given an invented second form");
});

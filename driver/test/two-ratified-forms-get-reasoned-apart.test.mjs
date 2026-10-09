// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── TWO RATIFIED FORMS OF ONE NAME, ONE UNDIFFERENTIATED READ ────────────────────────────────────────
//
// The instruction on a delivered global search ratified a second spelling and said to read it as a form
// of the same candidate. Both forms were searched, correctly. One read came back: a single overall band,
// noting only that the decisive conflict "uses the first form exactly". The reviewing lawyer's final gave
// each form its own reasoning — the same overall level, the filed-rights exposure one step lower for the
// second form, with the reason stated. A client who ratifies two forms is choosing between them, and a
// single undifferentiated read is the one answer that cannot support the choice.
//
// THE FIX IS DICTATION, NOT LAYOUT. The owner ruled the renderer untouched and one overall band as today:
// what changes is that synthesis reasons each form and says which conflicts move between them, and that
// the shell carries that read through instead of flattening it. An arm that starts demanding a second
// band is asserting the design the owner ruled against, so arm 3 pins the absence of one.
//
// WHAT THESE ARMS ARE, SAID PLAINLY: arms 1-5 are LITERAL MATCHES on prose written in the same change.
// They red when the wording moves and they cannot red when the property breaks, because the property is
// what a model does with a sentence. They are worth having as the pin that the two surfaces both carry
// the ask and that neither carries a layout order — and they are not evidence the engine reasons better.
// The composition is EXECUTED rather than pattern-matched out of the source, and each carries a floor
// asserting it read the dictation for THIS run, because a source scan cannot see an interpolated value.
//
// BREAK MATRIX:
//   · synthesis is told to reason each form           → break: drop the ask, arm 1 red
//   · silence is not an option when they read alike   → break: drop the alternative, arm 2 red
//   · no second band is ordered anywhere              → break: order one, arm 3 red
//   · the shell carries the per-form read through     → break: let it flatten, arm 4 red
//   · the shell still may not re-rate                 → break: soften it, arm 5 red
//   · both fixture shapes survive the narrative gate  → break: collide with a gate, arm 6 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGES, paths } from "../stages.mjs";
import { validators } from "../verify.mjs";

// A title no dictation could carry by accident — the floor below asserts the composition consulted it.
const FRAMEWORK = Object.freeze({
  framework_key: "fixture-framework",
  title: "Fixture Rating Framework (arm floor)",
  bands: [{ label: "High" }, { label: "Medium" }, { label: "Low" }],
});

const P = paths(mkdtempSync(join(tmpdir(), "ratified-forms-run-")));
const ctx = {
  paths: P, job: { markName: "FIXTUREMARK", classes: ["9"], jurisdictions: ["US"] },
  customerUnknown: false, profile: {}, intakeAsks: null, enforcerSignals: 0, framework: FRAMEWORK,
  jxAim: 0, registerOnly: false, crowdContext: null, dispatchBlocks: null, findingsSurface: null,
  depth: null, displayVerdict: null, searchPolicy: null,
};
const dictationOf = (stage) => STAGES[stage].message(ctx);

const SYNTHESIS = dictationOf("synthesis");
const OVERVIEW = dictationOf("report-overview");

// THE FLOORS. Without these an arm below holds for any string at all, including one composed from a
// different run or from no context. `P.narrative` is this run's own path, interpolated at compose time.
test("the floors — each dictation is the composition for THIS run", () => {
  assert.ok(SYNTHESIS.length > 5000, `synthesis dictation is ${SYNTHESIS.length} bytes — too short to be the real one`);
  assert.ok(OVERVIEW.length > 2000, `overview dictation is ${OVERVIEW.length} bytes — too short to be the real one`);
  assert.ok(SYNTHESIS.includes(FRAMEWORK.title), "synthesis did not consult the fixture framework");
  assert.ok(SYNTHESIS.includes(P.registerFindings), "synthesis did not name this run's register findings path");
  assert.ok(OVERVIEW.includes(P.narrative), "the shell did not name this run's narrative path");
});

test("arm 1 — synthesis is told to reason each ratified form on its own", () => {
  // The CONDITION and the ORDER are pinned separately. Planting proved why: dropping the order while
  // keeping the condition left a green suite, because the condition clause is the half that is easy
  // to match and the useless half to hold.
  assert.match(SYNTHESIS, /RATIFIED MORE THAN ONE FORM/,
    "synthesis lost the condition that names a two-form matter");
  assert.match(SYNTHESIS, /REASON EACH FORM THROUGH THE FRAMEWORK/,
    "synthesis names a two-form matter but no longer orders each form reasoned on its own");
  assert.match(SYNTHESIS, /which conflicts move between them and why/,
    "synthesis asks for per-form reads but not for what moves between them");
});

test("arm 2 — reading alike must be ASSERTED, so silence is not an option", () => {
  assert.match(SYNTHESIS, /the reads are the same for both forms/,
    "synthesis lost the stated-alike alternative; a silent narrative would then be indistinguishable from an unexamined one");
});

test("arm 3 — no second band is ordered: the renderer is untouched", () => {
  // The owner's ruling. A per-form band would be a layout change, which this work is not.
  for (const [name, text] of [["synthesis", SYNTHESIS], ["the shell", OVERVIEW]]) {
    assert.ok(!/band per form|per-form band|a band for each form|one band per ratified form/i.test(text),
      `${name} orders a per-form band — the ruling is one overall band as today`);
  }
  assert.match(SYNTHESIS, /one overall band as today/, "synthesis no longer states the layout is unchanged");
});

test("arm 4 — the shell carries the per-form read through instead of flattening it", () => {
  assert.match(OVERVIEW, /MORE THAN ONE RATIFIED FORM/,
    "the shell no longer carries the per-form read; it may flatten two reads into one");
  assert.match(OVERVIEW, /Do not\s+flatten two reads into one/,
    "the shell lost the explicit refusal to flatten");
});

test("arm 5 — what must not break: the shell still may not re-rate", () => {
  assert.match(OVERVIEW, /NEVER re-compute a band/,
    "the transform clause lost its no-re-rating rule");
  assert.match(OVERVIEW, /introduce NO finding, owner, or claim that is not already there/,
    "the transform clause lost its no-free-generation rule");
});

// ── The two fixtures ─────────────────────────────────────────────────────────────────────────────────
//
// THE HONEST CLAIM: these prove both shapes are EXPRESSIBLE and that neither collides with a gate on
// narrative.md. They do not prove anything enforces the shape — nothing does, because the ratified forms
// have no typed source to gate on. That gap is filed, and the note above says why it was not built here.
const DIFFERING = `# Synthesis

The matter ratified two forms of the name and both were read through the framework in force.

The decisive filed right turns on the first form exactly: an identical word mark in the same goods,
owned by a trading party, with the register entry in force and unchallenged. Read against the second
form the same right is a near miss rather than an identity, because the added element carries its own
meaning and shifts the dominant element. So that conflict moves between the forms, and the filed-rights
exposure sits one step lower for the second form. The common-law picture does not move: the same trader's
use reaches both forms alike, and nothing in the evidence separates them.

Overall the two forms land on the same level, and the reason they do is the common-law use rather than
the register.
`;

const SAME = `# Synthesis

The matter ratified two forms of the name and both were read through the framework in force.

Every conflict reaches both forms alike. The filed rights are identical-word registrations that the
added element does not distinguish, the common-law use names the candidate rather than either spelling,
and no finding turns on one form exactly. The reads are the same for both forms, and that is a finding
rather than an omission: the forms were reasoned apart and nothing separated them.

Overall both forms land on the same level for the same reasons.
`;

test("arm 6 — both fixture shapes survive the narrative gate, and the gate is looking", () => {
  const dir = mkdtempSync(join(tmpdir(), "ratified-forms-narr-"));
  for (const [name, text] of [["differing", DIFFERING], ["same", SAME]]) {
    const p = join(dir, `${name}.md`);
    writeFileSync(p, text);
    const r = validators.narrative(p, text);
    assert.ok(r.ok, `the ${name} fixture was refused by validators.narrative: ${r.reason ?? "no reason given"}`);
  }
  // THE FLOOR. Without it this arm passes for a validator that returns ok() unconditionally.
  const shortPath = join(dir, "too-short.md");
  writeFileSync(shortPath, "too short");
  assert.equal(validators.narrative(shortPath, "too short").ok, false,
    "validators.narrative accepted a nine-byte narrative — the arms above are measuring nothing");
});

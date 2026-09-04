// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// requirement 3 — THE CHECK THAT NAMES PARTIES NAMED FOUR THINGS THAT ARE NOT PARTIES.
//
// Across two production clearances, `reference-integrity` flagged six candidates as "parties the action
// list names that no finding in the report identifies". Four were not parties at all:
//
//   "Instruct Japanese"      the first two words of "Instruct Japanese and Korean counsel"
//   "European Union"         a territory
//   "United Kingdom"         a territory
//   "United Arab Emirates"   a territory
//   "MINCRAFT"               a mark (synthetic name)
//
// …and the flag then shipped to the client, which is requirement 1 and is fixed separately. This
// file is about the extractor being right in the first place, because a check that cries wolf four
// times out of six is a check people learn to close.
//
// The three narrowings, each structural rather than a list to keep topped up:
//   · a TERRITORY is not a party — bound to publish/regions.mjs, the one naming source every render
//     surface already uses, so a register added tomorrow cannot reintroduce this.
//   · a MARK is not a party — the marks the run was asked about AND the marks it found. Only `mark`
//     joins the vocabulary; `owner.name` never does, because the owner is exactly who needs introducing.
//   · a bullet's OPENING WORD is not a name — an action bullet opens with an imperative by construction.
//     Structural, on the Title-Case pattern only: a verb list would have to be exhaustive to work, and
//     would be silent when it was not.
//
// THE POSTURE IS THE CHECK'S OWN, and it decides these trades: "a false orphan is reader noise, the
// worse failure under the lint's posture, and a missed one costs one flag."
//
// BREAK MATRIX:
//   · a territory is never a candidate        → break: drop TERRITORY_VOCAB from inList, arm 1 red
//   · a mark is never an orphan               → break: drop the markN filter, arm 2 red
//   · a bullet's opener is never a candidate  → break: drop bulletOpens, arm 3 red
//   · the REAL detections still fire          → break: any over-wide narrowing, arm 4 red
//   · ALL-CAPS candidates keep their anchor   → break: apply bulletOpens to both patterns, arm 5 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { properNameCandidates, referenceChecks } from "../predelivery-lint.mjs";
import { REGION_NAMES } from "../publish/regions.mjs";

// The delivered shape, rebuilt from the report: a markdown bucket of imperative bullets.
const ACTIONS = [
  "## Only you can close these",
  "- Instruct Japanese and Korean counsel on the joined-script forms before filing.",
  "- Confirm whether MINCRAFT is in use by ACME HOLDINGS in the European Union and the United Kingdom.",
  "- Decide how RTVE should be approached before filing in the United Arab Emirates.",
  "",
].join("\n");

// THE NARROWINGS ARE OPT-IN, and that is load-bearing. `properNameCandidates` has three consumers:
// this check, countingChecks' owner attribution, and pipeline.mjs's correctionNamedSet. Only THIS one
// is looking at an action bullet list. Applied by default they reach the other two — and
// correctionNamedSet gates `enforceCorrectionsReachFindings` on `named.length > 0`, so a reviewer flag
// reading "- Matchday Inc has not been carded" would yield an EMPTY set and silently disarm the
// corrections-staleness gate. Arm 6 pins that. referenceChecks asks for them; nothing else does.
const candidates = (s) => properNameCandidates(s, null, { actionBullets: true, territories: true });

const NOT_PARTIES = ["Instruct Japanese", "European Union", "United Kingdom", "United Arab Emirates"];
const REAL = ["ACME HOLDINGS", "RTVE"];

test("#600.3 arm 1 — a territory is never a candidate, and the list is the render surfaces' own", () => {
  const got = candidates(ACTIONS);
  for (const t of ["European Union", "United Kingdom", "United Arab Emirates"])
    assert.ok(!got.includes(t), `"${t}" is a territory, not a party`);
  // …bound to the ONE naming source, so this holds for every register the product knows about.
  for (const name of Object.values(REGION_NAMES)) {
    if (!/^[A-Z][a-z]+(?: [A-Z][a-z]+)+$/.test(name)) continue;   // only the Title-Case-multi-word shape can match
    assert.deepEqual(candidates(`- Confirm the position in ${name} before filing.`), [],
      `"${name}" is in REGION_NAMES and still reads as a party`);
  }
});

test("#600.3 arm 2 — a mark is never an orphan; its OWNER still is", () => {
  const withMark = referenceChecks({
    actionsText: ACTIONS, fullSurface: ACTIONS, searchedNames: ["MOONBERRY"],
    markNames: ["MOONBERRY", "MINCRAFT"],
  })[0];
  assert.ok(!withMark.detail.includes("MINCRAFT"), "a conflicting mark is a thing, not a person");
  assert.ok(withMark.detail.includes("ACME HOLDINGS"),
    "THE OTHER HALF: the mark's OWNER is exactly who needs introducing, and must survive");
  // and with no mark vocabulary at all it is still reported — the narrowing is opt-in per run, never a
  // blanket suppression of anything ALL-CAPS.
  const noVocab = referenceChecks({ actionsText: ACTIONS, fullSurface: ACTIONS, searchedNames: ["MOONBERRY"] })[0];
  assert.ok(noVocab.detail.includes("MINCRAFT"));
});

test("#600.3 arm 3 — a bullet's opening word is not a name", () => {
  assert.ok(!candidates(ACTIONS).includes("Instruct Japanese"),
    "THE DEFECT: an imperative plus the next word, read as a company");
  // Every bullet marker the report uses, and a tagged bullet ("**[Open question]** Confirm …").
  for (const open of ["- ", "* ", "+ ", "1. ", "2) ", "- **[Open question]** "])
    assert.deepEqual(candidates(`${open}Instruct Japanese and Korean counsel.`), [],
      `a candidate anchored at the start of a "${open.trim()}" bullet is a sentence opener`);
  // …and the SAME two words mid-sentence are still a candidate: the rule is positional, not a ban.
  assert.ok(candidates("- Ask whether Instruct Japanese Ltd has been approached.").length > 0,
    "the narrowing must not delete the shape everywhere it appears");
});

test("#600.3 arm 4 — over the delivered shape, exactly the real parties survive", () => {
  // The extractor's own three exclusions are territory + bullet-opener; the mark exclusion lives one
  // level up in referenceChecks, because "is this a mark" is a fact about the RUN and not about the
  // text. So the extractor still offers MINCRAFT and the check is what drops it — asserted both ways,
  // since a narrowing landing at the wrong level would pass either assertion alone.
  const got = candidates(ACTIONS);
  for (const r of REAL) assert.ok(got.includes(r), `the check exists to find ${r}, and no longer does`);
  for (const n of NOT_PARTIES) assert.ok(!got.includes(n), `${n} is still reported`);
  assert.deepEqual(got, ["MINCRAFT", ...REAL], `the extractor's own output, got: ${JSON.stringify(got)}`);

  const flagged = referenceChecks({
    actionsText: ACTIONS, fullSurface: ACTIONS, searchedNames: ["MOONBERRY"],
    markNames: ["MOONBERRY", "MINCRAFT"],
  })[0];
  const named = REAL.filter((r) => flagged.detail.includes(r));
  assert.deepEqual(named, REAL, "both real parties reach the flag");
  for (const n of [...NOT_PARTIES, "MINCRAFT"])
    assert.ok(!flagged.detail.includes(n), `${n} still reaches the flag — six candidates, four of them wrong`);
});

test("#600.3 arm 5 — the bullet rule is Title-Case ONLY; an ALL-CAPS opener is still a candidate", () => {
  // RTVE is the failure this check was built for, and a bullet may legitimately open with it. No false
  // positive on record came from the ALL-CAPS pattern, so it keeps its anchor.
  assert.deepEqual(candidates("- RTVE has not been approached about the pending application."),
    ["RTVE"], "an ALL-CAPS opener is the real-detection shape and must survive");
});

// ── requirement 2 — THE REDO IT USED TO TRIGGER COULD NOT REPAIR IT, AND COULD CLEAR IT ─────────
//
// The routing was already there and pointed at the wrong lane. `reference-integrity` set no
// `.structural` and no `.ordinal`, so the pre-delivery lint sent it to a warm `report-overview` redo.
// Two things wrong with that:
//
//   1. THE REDO CANNOT PERFORM THE REPAIR. The remedy the check names — "card the on-point one(s) or
//      remove them" — is an edit to findings.json. On a v4+ run the "Only you can close these" section
//      is CODE-BUILT from findings.json actions[] and replaced wholesale by assembleReportMd, which runs
//      immediately after the redo. Nothing the redo writes into that section survives.
//
//   2. THE REDO COULD CLEAR THE FLAG WITHOUT CARDING ANYTHING. The orphan filter passes a candidate that
//      appears anywhere OUTSIDE the only-you bucket, and shell prose is outside it. A redo that merely
//      explained who the party was made the re-lint PASS — the engine satisfying the check by writing
//      the "verify who this is" note the check's own detail forbids, with no artifact recording it.
//
// So on a run whose actions are code-built this is STRUCTURAL, in the meaning this codebase already
// uses for registry-record-coverage and permission-prose: no drafting surface can repair it, the redo
// is not attempted, and it ships as a visible flag on the internal surfaces.
test("#600.2 — a code-built action register makes this structural; an authored one keeps its redo", () => {
  const actions = "## Only you can close these\n- Decide how RTVE should be approached before filing.\n";
  const args = { actionsText: actions, fullSurface: actions, searchedNames: ["MOONBERRY"] };

  const v4 = referenceChecks({ ...args, structural: true })[0];
  assert.equal(v4.pass, false, "premise: the check still fires, or this proves nothing");
  assert.equal(v4.structural, true,
    "THE DEFECT: a doomed warm redo that can clear the flag by writing the note the detail forbids");

  // Pre-v4: the authored section survives assembly, so the redo IS the right owner and keeps it.
  const legacy = referenceChecks(args)[0];
  assert.equal(legacy.pass, false);
  assert.equal(legacy.structural, undefined, "an authored actions section is still model-repairable");

  // A PASSING check never carries the flag either way — `modelFixable` reads it off failures only, but a
  // structural bit on a pass would be a state nothing means.
  const clean = referenceChecks({ actionsText: "## Only you can close these\n- Confirm the launch date.\n",
    fullSurface: "x", searchedNames: ["MOONBERRY"], structural: true })[0];
  assert.equal(clean.pass, true);
  assert.equal(clean.structural, undefined);
});

test("#600.3 arm 6 — the narrowings are OPT-IN, so the extractor's other two consumers are untouched", () => {
  // countingChecks takes the LAST candidate as the owner of a count claim and drops the claim on null;
  // correctionNamedSet gates the corrections-staleness demand on the set being non-empty. Both call the
  // extractor with no options, and both fail SILENTLY when it returns less — a dropped count claim
  // reports a pass over claims it never compared, and an empty named set stops demanding the re-emit.
  assert.deepEqual(properNameCandidates("- Matchday Inc has not been carded anywhere in the report."),
    ["Matchday Inc"],
    "THE REGRESSION: an owner named at the start of a reviewer's bullet vanished, and the staleness gate reads that as nothing to enforce");
  assert.deepEqual(properNameCandidates("- Confirm the position in United Kingdom before filing."),
    ["United Kingdom"],
    "territory vocabulary must not reach a consumer that is not reading an action list");
  // …and asked for, they apply.
  assert.deepEqual(candidates("- Matchday Inc has not been carded anywhere in the report."), []);
});

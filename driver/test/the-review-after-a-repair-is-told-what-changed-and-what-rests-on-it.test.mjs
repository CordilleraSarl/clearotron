// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEW AFTER A DELIVERY-CHECK REPAIR, AND ITS ONE CORRECTION, IN THE APPROVED WORDS.
//
// After the delivery check finds a fault and the writer repairs its record, the reviewer used to be sent the
// first review's whole message again, cold, and nothing applied what it then flagged. Now it reads what the
// repair changed and every statement resting on it, with the evidence to check both; its flags go to one
// correction by the writer, and nothing reviews that correction again. The first review and the first
// correction stay as they were, word for word.
//
// The texts are the approved wording, pinned whole: a change to any of them is a change to what the model
// reads and needs the same approval again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REPAIR_COMPOSERS } from "../repair-composers.mjs";
import { composeFollowup, refutationStandingLines, REFUTATION_RECORDING_LINES, STAGES, paths } from "../stages.mjs";
import { correctionsWorklist } from "../corrections-feedforward.mjs";
import { changedContent, restingOn, listForReview } from "../repair-scope.mjs";

const composer = (key) => REPAIR_COMPOSERS.find((c) => c.key === key);
const REVIEW_OPENING = [
  "This is a review of a repair, not a full review. Earlier in this run the narrative was reviewed in full, and the corrections that review raised went to the writer. The delivery check then found a fault, and the writer repaired the record.",
  "Review only what that repair changed, listed below under WHAT THE REPAIR CHANGED, and any statement elsewhere in the narrative or in the findings record, findings.json, that rests on a changed item. Such a statement no longer holds if the change leaves it untrue, without its support, or incomplete.",
  "Everything else stands as this run's earlier reviews left it. Do not flag a statement that rests on no changed item.",
  "From your own manual, skills/narrative-refutation/SKILL.md, use only the checks that bear on these items. Its whole-report checks, its length target for a review and its expectation that a clean review is rare belong to the full review, not to this one. A clean result is a normal outcome here.",
  "Check each changed item against the evidence named for it, and each statement that rests on a changed item against the new values.",
  "Say what each flag is about. For a finding, put its number from the list below in `on`. For a writer's exclusion, put a record id from its entry in `positions`. For anything else, begin the flag's text with the item's name exactly as the list gives it, for example: the coverage line for \"<area>\".",
];
const RENUMBERED = "Where a finding below shows two numbers, put the first in `on`. The second is its number in findings.json.";
const VERDICT = "Your verdict is about the repair. CLEAR: what changed is sound, and every statement that rests on a changed item still holds. CONDITIONAL: a flag needs a correction. BLOCKING: the change makes the report unsafe to sign, under your manual's verdict logic.";
const NEXT = "Your flags go to one correction pass by the writer, and nothing reviews that pass again. Make each fix exact.";
const LIST_HEAD = "WHAT THE REPAIR CHANGED. The driver worked this out from the writer's saved record before and after the repair. A value saved again unchanged is not listed.";
const RESTING_HEAD = "WHAT RESTS ON THESE CHANGES, as it reads now. Check that each still holds:";
const EVIDENCE = ["WHERE THE EVIDENCE IS:",
  "- For a coverage line: the run's coverage ledger, register-coverage-ledger.json, and the plan-execution check below.",
  "- For a finding: the records it cites, through band_record, and its row in placements.json.",
  "- For a narrative section: the source files in your declared inputs, below."];
const OPEN_ITEMS = "Also verify against skeptic-flags.json and frame-reopen.json (JSON \"deferrals\"): every skeptic flag and every reopen deferral must be either visible as a coverage[]/narrative open item or explicitly reasoned immaterial — one that appears in neither place is a FLAGGED CORRECTION. Files absent ⇒ skip.";

test("the review after a repair opens by saying what it is, what it covers and what its verdict means", () => {
  const c = composer("narrative-refutation:post-repair-review");
  assert.ok(c, "the composer is registered");
  const [coverageOnly, renumbered, registerOnly] = c.samples.map((s) => c.compose(s.args).split("\n"));
  assert.deepEqual(coverageOnly.slice(0, 8), [...REVIEW_OPENING, VERDICT, NEXT]);
  assert.deepEqual(renumbered.slice(0, 9), [...REVIEW_OPENING, RENUMBERED, VERDICT, NEXT],
    "the two-numbers line only where the fold renumbered a listed finding");
  assert.ok(!coverageOnly.includes(RENUMBERED));
  // the standing tools and notes, and the recording lines, are the full review's own
  for (const out of [coverageOnly, renumbered]) {
    for (const l of refutationStandingLines({ registerOnly: false, job: {} }).filter(Boolean)) assert.ok(out.includes(l), l.slice(0, 60));
    for (const l of REFUTATION_RECORDING_LINES) assert.ok(out.includes(l), l.slice(0, 60));
  }
  assert.ok(registerOnly.includes(refutationStandingLines({ registerOnly: true, job: {} })[3]), "the register-only note when it applies");
  assert.ok(coverageOnly.includes(OPEN_ITEMS), "the open-items check when a coverage line changed");
  assert.ok(!renumbered.includes(OPEN_ITEMS), "and not otherwise");
  for (const out of [coverageOnly, renumbered, registerOnly]) {
    assert.ok(!out.some((l) => /^Adversarially refute the narrative/.test(l)), "never the order to review everything again");
    assert.ok(!out.some((l) => /^(GROUNDED PROFILES|DEMOTION VERIFICATION|READER-OWNED NOUNS|Flag as a CORRECTION any line reasoning)/.test(l)),
      "the full review's whole-report checks are not sent");
  }
});

test("its list says what changed, before and after, what rests on it as it reads now, and where the evidence is", () => {
  const c = composer("narrative-refutation:post-repair-review");
  const [coverageOnly, renumbered] = c.samples.map((s) => c.compose(s.args).split("\n"));
  const at = (out, l) => out.indexOf(l);
  assert.deepEqual(coverageOnly.slice(at(coverageOnly, LIST_HEAD)), [LIST_HEAD,
    "- the coverage line for \"register / EU\": before: confirmed-clean: searched in full. After: coverage-limited: one class was not read.",
    "- the coverage line for \"register / UK\": added by the repair: not-searched: outside the plan.",
    RESTING_HEAD,
    "- the narrative's \"Verdict\" section: One conflict needs a decision.",
    "- the coverage judgment: {\"sufficient\":true,\"reason\":\"the plan ran\"}",
    EVIDENCE[0], EVIDENCE[1], EVIDENCE[3]]);
  assert.deepEqual(renumbered.slice(at(renumbered, LIST_HEAD)), [LIST_HEAD,
    "- Finding 7 (finding 6 in findings.json): band changed. Before: {\"band\":\"Moderate\"}. After: {\"band\":\"Serious\"}. It cites: {\"source_type\":\"register-vendor\",\"resolved_link\":\"https://example.invalid/mark/1\"}.",
    "- the narrative's \"The spine\" section. Before: The spine was the coined element. After: The spine is the coined element.",
    RESTING_HEAD,
    "- the action \"a1\", which names finding 7: Ask counsel about finding 7.",
    EVIDENCE[0], EVIDENCE[2], EVIDENCE[3]]);
});

test("a removed and an added finding, and a register, read as the list's own lines", () => {
  const before = { narrative: { verdict: "V.", spine: "S." }, findings: { schema_version: 7, rated_under_framework: "house-default",
    findings: [{ ordinal: 1, mark: "NOVA" }], actions: [{ id: "a1", kind: "monitoring", text: "Watch.", ordinals: [1] }] } };
  const after = { narrative: { verdict: "V.", spine: "S." }, findings: { schema_version: 7, rated_under_framework: "house-default",
    findings: [{ ordinal: 2, mark: "NOVAPULSE", source: { source_type: "register-vendor", resolved_link: "" } }],
    actions: [{ id: "a1", kind: "monitoring", text: "Watch the register.", ordinals: [1] }] } };
  const changed = changedContent(before, after);
  const list = listForReview(changed, restingOn(changed, after));
  const c = composer("narrative-refutation:post-repair-review");
  const out = c.compose({ findings: "findings.json", skepticFlags: "s", frameReopenReceipt: "f", ...list }).split("\n");
  assert.ok(out.includes("- Finding 1: removed by the repair. It read: {\"ordinal\":1,\"mark\":\"NOVA\"}."));
  assert.ok(out.includes("- Finding 2: added by the repair: {\"ordinal\":2,\"mark\":\"NOVAPULSE\",\"source\":{\"source_type\":\"register-vendor\",\"resolved_link\":\"\"}}. It cites: {\"source_type\":\"register-vendor\",\"resolved_link\":\"\"}."));
  assert.ok(out.includes("- the action \"a1\": before: {\"id\":\"a1\",\"kind\":\"monitoring\",\"text\":\"Watch.\",\"ordinals\":[1]}. After: {\"id\":\"a1\",\"kind\":\"monitoring\",\"text\":\"Watch the register.\",\"ordinals\":[1]}."));
});

test("its closing line says which files the repair changed; every other dispatch keeps its own", () => {
  const ctx = { profile: null, job: {} };
  const out = composeFollowup("narrative-refutation", ctx, { followup: "the review", inputs: ["narrative.md", "register-findings.md"], changedInputs: ["narrative.md", "findings.json"] }).split("\n");
  assert.equal(out.at(-1), "YOUR DECLARED INPUTS, on disk — this dispatch is a fresh session and does not carry them. Since this run's last review, the repair has changed narrative.md and findings.json where listed above; your other inputs have not changed. Open the ones the instruction above turns on (and only those): narrative.md, register-findings.md.");
  assert.equal(out[0], "METHODOLOGY (reference — this is a correction to work that already exists, NOT an instruction to redo the stage): this stage is held to skills/narrative-refutation/SKILL.md, skills/clearance-search/report-prose.md. Re-read whatever the instruction below turns on.",
    "it opens with the line every follow-up opens with, naming both manuals");
  const plain = composeFollowup("narrative-refutation", ctx, { followup: "the re-check", inputs: ["narrative.md"] }).split("\n");
  assert.equal(plain.at(-1), "YOUR DECLARED INPUTS, on disk — this dispatch is a fresh session and does not carry them, so open the ones the instruction above turns on (and only those): narrative.md.");
});

const CORRECTION_OPENING = "This is a fresh session: your earlier synthesis is not in your context, and you do NOT redo it from scratch. The driver holds the record it last accepted from you; your earlier work is in narrative.md and findings.json — open them for the parts each flag names — and your inputs are listed below. After the delivery check, that record was repaired, and an independent review then read only what the repair changed and what rests on it. It flagged the corrections below, and nothing reviews this pass again. Apply them (minimum-change per flag — correct the statement to what the evidence supports, demote the tier, or remove the sentence) to BOTH deliverables. A caveat, hedge, qualifier or disclaimer is NEVER a repair: an unsupported statement is corrected or it is removed, never softened.";
const ITEMS = (items) => `THE FLAGS NAME THESE ITEMS: ${items}. Change only the items the flags are about and the narrative passages that discuss them. Everything else in the record stays as the driver last accepted it from you.`;
const NARROWED = "For a coverage line the repair changed, a flag may ask for its state or its facts to change, not only its words. Make that change only where the line then claims less than it does now, as the narrowing rule below requires. This is the one exception to the rule below that the coverage account is not yours to reopen; every other coverage line keeps its area, its state and every fact it states.";
const NO_ITEM = "A flag that names no item is applied to the item it is about; name that item in the \"corrections\" note. If you cannot tell what the flag is about, change nothing for it and say so in the note.";
const ON_NUMBER = "Where a flag's own words give a finding a different number from its [on: …], use the [on: …] number. It is the number in your record.";
const CLOSING = "REMOVING A FLAGGED FINDING DOES NOT ANSWER ITS FLAG. Correct the fact, or say why it cannot be corrected and leave it standing; the point is recorded for the reviewing lawyer. A finding you believe should not be there is WITHDRAWN with its reason recorded, never deleted — a flag that stops naming anything reads as resolved, and the driver reports the deletion by name either way.";

test("the one correction after that review opens on where its flags come from and carries the first correction's rules", () => {
  const c = composer("synthesis:post-repair-corrective");
  assert.ok(c, "the composer is registered");
  const [plain, renumbered, whole] = c.samples.map((s) => c.compose(s.args).split("\n"));
  assert.deepEqual(plain.slice(0, 4), [CORRECTION_OPENING, ITEMS("finding 2, the coverage line for \"register / EU\""), NARROWED, NO_ITEM]);
  // With no item named, the line says so and points at the rule for an unplaced flag below it: "every flag is about the
  // document" would be false here, where an unplaced flag may be about a finding (design's wording, 2026-10-18).
  assert.deepEqual(renumbered.slice(0, 5), [CORRECTION_OPENING, ITEMS("(none named; apply each unplaced flag as described below)"), NARROWED, NO_ITEM, ON_NUMBER]);
  // After a whole review the opening says so, and nothing else in the message changes (design's wording, 2026-10-18).
  assert.equal(whole[0], CORRECTION_OPENING.replace("and an independent review then read only what the repair changed and what rests on it.",
    "and the full independent review ran again."), "a whole review's correction is told the review read only the change");
  assert.deepEqual(whole.slice(1), c.compose({ ...c.samples[2].args, whole: false }).split("\n").slice(1), "a whole review changed more than the opening");
  assert.ok(!plain.join("\n").includes("verify-flag for re-check"), "no re-check follows this pass, so the move is not offered");
  // THE RULES AND STEPS ARE THE FIRST CORRECTION'S: every line of the first correction from the narrowing rule
  // to its save line appears in this one, in the same order.
  const first = composer("synthesis:corrective");
  const firstLines = first.compose(first.samples[0].args).split("\n");
  const from = firstLines.findIndex((l) => l.startsWith("A REPAIR MAY NARROW A CLAIM"));
  const to = firstLines.findIndex((l) => l.startsWith("THE FINDINGS CONTRACT IS CLOSED"));
  assert.ok(from > 0 && to > from);
  const shared = firstLines.slice(from, to + 1);
  const at = plain.indexOf(shared[0]);
  assert.deepEqual(plain.slice(at, at + shared.length), shared);
  assert.ok(plain.includes("If applying a flag genuinely REQUIRES changing a finding outside that list — a knock-on the reviewer did not see — make the change and say which one and why in the \"corrections\" note. A silent edit outside the scope is the one thing this instruction forbids; a reasoned one is not."),
    "a reasoned change outside the list is allowed, as on the first correction");
});

test("the flag list after a repair closes on the line for a pass nothing reviews; the first correction's is unchanged", () => {
  const rows = [{ n: 1, kind: "fact", text: "the coverage line for \"register / EU\": too strong", ordinals: null }];
  assert.equal(correctionsWorklist(rows, { afterRepair: true }).split("\n").at(-1), CLOSING);
  assert.equal(correctionsWorklist(rows).split("\n").at(-1), "REMOVING A FLAGGED FINDING DOES NOT ANSWER ITS FLAG. Correct the fact, or say why it cannot be corrected and leave it standing for the reviewer. A finding you believe should not be there is WITHDRAWN with its reason recorded, never deleted — a flag that stops naming anything reads as resolved, and the driver reports the deletion by name either way.");
});

test("the first full review's message still opens with its whole-review order: it is not narrowed", () => {
  // The run directory's paths are joined for the platform, so on Windows the narrative is `\r\narrative.md`.
  const P = paths("/r");
  const msg = STAGES["narrative-refutation"].message({ paths: P, intakeAsks: [], job: {}, registerOnly: false, profileSelection: null });
  assert.match(msg, /^First, read and follow exactly: skills\/narrative-refutation\/SKILL\.md, skills\/clearance-search\/report-prose\.md\.\n/);
  assert.match(msg, new RegExp(`\\nAdversarially refute the narrative ${P.narrative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} against the source files:`));
  for (const l of REFUTATION_RECORDING_LINES) assert.ok(msg.includes(l));
});

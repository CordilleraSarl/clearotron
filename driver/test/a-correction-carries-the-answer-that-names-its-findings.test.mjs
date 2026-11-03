// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-correction-carries-the-answer-that-names-its-findings.test.mjs — a correction that moves findings an answer citing
// findings may depend on is asked, once, to bring the answers that depend on them into line, or say why not.
//
// On a test run (2026-11-03) a correction raised a finding from Moderate to High and updated the verdict, and the
// answer kept naming findings 1 to 3. The correction's instruction named the other registers it may send but not the
// four answers, and nothing checked the answer against the findings it names. The recheck saw it; no pass follows the
// recheck, so the delivered report kept the answer. A second run showed the same shape at Moderate: the answer named
// every Moderate-or-higher finding but the three the correction raised or added. A shared band is a reason to ask the
// writer, never a required citation (design, 2026-11-03).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answersLeftBehind } from "../corrections-feedforward.mjs";
import { repairFollowup, composerFor } from "../repair-composers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BANDS = [{ label: "Very High" }, { label: "High" }, { label: "Moderate" }, { label: "Manageable" }];
const f = (ordinal, band, disposition = "adversarial") => ({ ordinal, band, disposition });
const rec = (findings, ordinals, more = {}) => ({ findings, four_answers: { third_party_rights: { token: "strong", ordinals, basis: "", read: "" }, ...more } });
const one = (pre, post) => answersLeftBehind(pre, post, BANDS);

test("a finding the correction raised into the answer's bands is listed, and nothing else", () => {
  const pre = rec([f(1, "Very High"), f(2, "High"), f(3, "High"), f(4, "Moderate"), f(5, "Moderate"), f(7, "Moderate")], [1, 2, 3]);
  const post = rec([f(1, "Very High"), f(2, "High"), f(3, "High"), f(4, "High"), f(5, "Moderate"), f(7, "Manageable"), f(25, "Moderate")], [1, 2, 3]);
  assert.deepEqual(one(pre, post), [{ answer: "third_party_rights", cited: [1, 2, 3], floor: "High", uncited: [{ ordinal: 4, band: "High" }], withdrawn: [] }],
    "finding 4, raised to High, is listed; a finding lowered, or added below the answer's bands, is not");
});

test("findings raised or added at the answer's lowest band are listed where it names every finding at that band", () => {
  const cited = Array.from({ length: 23 }, (_, i) => i + 1);
  const base = cited.map((o) => f(o, o < 5 ? "High" : "Moderate"));
  const pre = rec([...base, f(39, "Manageable"), f(40, "Manageable")], cited);
  const post = rec([...base, f(39, "Moderate"), f(40, "Manageable"), f(41, "Moderate"), f(42, "Moderate"), f(43, "Manageable")], cited);
  assert.deepEqual(one(pre, post).map((a) => [a.answer, a.uncited.map((o) => o.ordinal)]), [["third_party_rights", [39, 41, 42]]]);
});

test("what the correction did not move is never listed: the writer's earlier citations are its own judgment", () => {
  const pre = rec([f(1, "High"), f(2, "High"), f(3, "High")], [1, 2]);
  assert.deepEqual(one(pre, rec([f(1, "High"), f(2, "High"), f(3, "High")], [1, 2])), [],
    "finding 3 was High and uncited before the correction, and the correction did not touch it");
});

test("a set-aside or unbanded finding is never listed, a withdrawn citation is, and it sets no floor", () => {
  const pre = rec([f(1, "High"), f(2, "Moderate"), f(3, "Moderate"), f(4, "Moderate")], [1, 2]);
  const post = rec([f(1, "High"), f(2, "Moderate", "withdrawn"), f(3, "High", "withdrawn"), f(4, "High", "distinguished"), f(5, null)], [1, 2]);
  assert.deepEqual(one(pre, post), [{ answer: "third_party_rights", cited: [1, 2], floor: "High", uncited: [], withdrawn: [2] }],
    "the answer still names finding 2, which the correction withdrew; the withdrawn, set-aside and unbanded findings it does not name are not listed");
  const lowCitedWithdrawn = rec([f(1, "High"), f(2, "Manageable", "withdrawn"), f(6, "Moderate")], [1, 2]);
  assert.deepEqual(one(rec([f(1, "High"), f(2, "Manageable")], [1, 2]), lowCitedWithdrawn).map((a) => a.uncited), [[]],
    "the answer's floor is High, from its live citation; the withdrawn Manageable one does not lower it to take in finding 6");
});

test("every answer that cites findings is read, and one that names none is neither checked nor invented", () => {
  const pre = rec([f(1, "High"), f(2, "Moderate")], [1], { objection_likelihood: { token: "likely", ordinals: [1, 2] }, registrability: { token: "obstructed", ordinals: [] } });
  const post = rec([f(1, "High"), f(2, "Moderate"), f(3, "Moderate")], [1], { objection_likelihood: { token: "likely", ordinals: [1, 2] }, registrability: { token: "obstructed", ordinals: [] } });
  assert.deepEqual(one(pre, post).map((a) => [a.answer, a.uncited.map((o) => o.ordinal)]), [["objection_likelihood", [3]]],
    "finding 3, added at Moderate, is listed for the answer that names a Moderate finding; the answer naming none is not read");
  assert.deepEqual(one({ findings: [] }, { findings: [f(1, "High")] }), [], "no four answers: nothing is invented");
});

test("the re-ask is registered, names what moved and the answers that may miss it, and forces nothing", () => {
  assert.ok(composerFor("synthesis:corrective-answers"), "an unregistered composer cannot reach a seat");
  const text = repairFollowup("synthesis:corrective-answers", { findings: "findings.json",
    answers: [{ answer: "third_party_rights", cited: [1, 2, 3], floor: "High", uncited: [{ ordinal: 4, band: "High" }], withdrawn: [] }] });
  assert.match(text, /Your correction changed finding 4, now High\./);
  assert.match(text, /may be missing a dependency/, "a possible dependency, never a citation owed");
  assert.match(text, /`third_party_rights` names findings 1, 2 and 3, rated High and above, and not finding 4\./);
  assert.match(text, /A shared risk band alone does not require a citation\./);
  assert.match(text, /keep that answer and explain why in the "corrections" note/, "the writer may decline with a reason");
  assert.match(text, /no `findings_patch` and never a `findings\[\]` list/, "the re-ask sends no finding rows");
});

test("the correction and its re-emit both carry step 4, and the PATCH line names steps 3 and 4", () => {
  const step = /When you add, change, or withdraw a finding, check the answers in `four_answers` that depend on that change\./;
  const text = repairFollowup("synthesis:corrective", { narrative: "narrative.md", findings: "findings.json", placement: "placement.md", items: ["#4"], worklist: "", review: "" });
  assert.match(text, /4\. When you add, change, or withdraw a finding/);
  assert.match(text, /any register from steps 3 and 4/);
  const reemit = repairFollowup("synthesis:corrective-findings", { findings: "findings.json", named: ["#4"], seniorEyeReview: "senior-eye-review.md" });
  assert.match(reemit, step, "the one repair when the findings did not save may update the answers too");
  assert.match(reemit, /Change only the flagged findings and the answers that depend on those changes\./);
  assert.match(reemit, /`findings` carrying the "corrections" marker and, when affected, the complete `four_answers` object\./);
  assert.doesNotMatch(reemit, /Change nothing else\./);
});

test("the gate asks once, only where the findings reached the record, and hands no positions", () => {
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  assert.match(src, /if \(!readState\(\)\.stale\) return answerFollowsCorrection\(ctx, P, pre, resume\);/,
    "the answer is checked only when the existing re-emit did not run, so the gate never asks twice");
  const body = src.slice(src.indexOf("async function answerFollowsCorrection("), src.indexOf("// (T3a, ruling 2026-08-26"));
  assert.equal((body.match(/await stage\(/g) ?? []).length, 1, "one re-ask, never a loop");
  assert.doesNotMatch(body, /correction: resume\.correction/, "an answer patch adds no finding, so it is handed no positions");
});

test("the writer's delivery-check repair carries step 4 too, and every other tool's repair is unchanged", () => {
  const c = composerFor("*:lint-repair");
  const writer = repairFollowup("*:lint-repair", c.samples.find((x) => x.args.toolWritten?.tool === "record_synthesis").args);
  assert.match(writer, /When you add, change, or withdraw a finding, check the answers in `four_answers` that depend on that change\./);
  assert.match(writer, /Fix ONLY what the checks name, and the answers that depend on those changes; change nothing else\./);
  const other = repairFollowup("*:lint-repair", c.samples.find((x) => x.args.toolWritten?.tool === "record_report_card").args);
  assert.doesNotMatch(other, /four_answers/, "a report card's repair has no answers to carry");
  assert.match(other, /Fix ONLY what the checks name; change nothing else\./);
});

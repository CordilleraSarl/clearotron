// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-correction-carries-the-answer-that-names-its-findings.test.mjs — a correction that moves findings into the bands the
// third-party-rights answer rests on is asked, once, to bring that answer into line.
//
// On a test run (2026-11-03) a correction raised a finding from Moderate to High and updated the verdict, and the
// answer kept naming findings 1 to 3. The correction's instruction named the other registers it may send but not the
// four answers, and nothing checked the answer against the findings it names. The recheck saw it; no pass follows the
// recheck, so the delivered report kept the answer. A second run showed the same shape at Moderate: the answer named
// every Moderate-or-higher finding but the three the correction raised or added.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answerLeftBehind } from "../corrections-feedforward.mjs";
import { repairFollowup, composerFor } from "../repair-composers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BANDS = [{ label: "Very High" }, { label: "High" }, { label: "Moderate" }, { label: "Manageable" }];
const f = (ordinal, band, disposition = "adversarial") => ({ ordinal, band, disposition });
const rec = (findings, ordinals) => ({ findings, four_answers: { third_party_rights: { token: "strong", ordinals, basis: "", read: "" } } });

test("a finding the correction raised into the answer's bands is owed, and nothing else", () => {
  const pre = rec([f(1, "Very High"), f(2, "High"), f(3, "High"), f(4, "Moderate"), f(5, "Moderate"), f(7, "Moderate")], [1, 2, 3]);
  const post = rec([f(1, "Very High"), f(2, "High"), f(3, "High"), f(4, "High"), f(5, "Moderate"), f(7, "Manageable"), f(25, "Moderate")], [1, 2, 3]);
  assert.deepEqual(answerLeftBehind(pre, post, BANDS), { cited: [1, 2, 3], floor: "High", owed: [{ ordinal: 4, band: "High" }] },
    "finding 4, raised to High, is owed; a finding lowered, or added below the answer's bands, is not");
});

test("findings raised or added at the answer's lowest band are owed where it names every finding at that band", () => {
  const cited = Array.from({ length: 23 }, (_, i) => i + 1);
  const base = cited.map((o) => f(o, o < 5 ? "High" : "Moderate"));
  const pre = rec([...base, f(39, "Manageable"), f(40, "Manageable")], cited);
  const post = rec([...base, f(39, "Moderate"), f(40, "Manageable"), f(41, "Moderate"), f(42, "Moderate"), f(43, "Manageable")], cited);
  assert.deepEqual(answerLeftBehind(pre, post, BANDS)?.owed.map((o) => o.ordinal), [39, 41, 42]);
});

test("what the correction did not move is never owed: the writer's earlier citations are its own judgment", () => {
  const pre = rec([f(1, "High"), f(2, "High"), f(3, "High")], [1, 2]);
  assert.equal(answerLeftBehind(pre, rec([f(1, "High"), f(2, "High"), f(3, "High")], [1, 2]), BANDS), null,
    "finding 3 was High and uncited before the correction, and the correction did not touch it");
});

test("a withdrawn, set-aside or unbanded finding is never owed, and a withdrawn citation sets no floor", () => {
  const pre = rec([f(1, "High"), f(2, "Moderate"), f(3, "Moderate"), f(4, "Moderate")], [1, 2]);
  const post = rec([f(1, "High"), f(2, "Moderate", "withdrawn"), f(3, "High", "withdrawn"), f(4, "High", "distinguished"), f(5, null)], [1, 2]);
  assert.equal(answerLeftBehind(pre, post, BANDS), null);
  const lowCitedWithdrawn = rec([f(1, "High"), f(2, "Manageable", "withdrawn"), f(6, "Moderate")], [1, 2]);
  assert.equal(answerLeftBehind(rec([f(1, "High"), f(2, "Manageable")], [1, 2]), lowCitedWithdrawn, BANDS), null,
    "the answer's floor is High, from its live citation; the withdrawn Manageable one does not lower it to take in finding 6");
});

test("an answer that names nothing, or a record with no four answers, owes nothing", () => {
  const post = { findings: [f(1, "High")] };
  assert.equal(answerLeftBehind({ findings: [] }, post, BANDS), null);
  assert.equal(answerLeftBehind({ findings: [] }, rec([f(1, "High")], []), BANDS), null);
});

test("the re-ask is registered, names what moved and what the answer names, and forces nothing", () => {
  assert.ok(composerFor("synthesis:corrective-answers"), "an unregistered composer cannot reach a seat");
  const text = repairFollowup("synthesis:corrective-answers",
    { findings: "findings.json", cited: [1, 2, 3], floor: "High", owed: [{ ordinal: 4, band: "High" }] });
  assert.match(text, /finding 4, now High/);
  assert.match(text, /names only findings 1, 2 and 3, rated High and above/);
  assert.match(text, /say why in the "corrections" note/, "the writer may decline with a reason");
  assert.match(text, /complete `four_answers` object/);
  assert.match(text, /no `findings_patch`/, "the re-ask sends no finding rows");
});

test("the correction's instruction names the four answers beside the other registers it may send", () => {
  const text = repairFollowup("synthesis:corrective", { narrative: "narrative.md", findings: "findings.json", placement: "placement.md", items: ["#4"], worklist: "", review: "" });
  assert.match(text, /4\. If you change a finding's band or disposition, or add a finding, check the answers in `four_answers`/);
});

test("the gate asks once, only where the findings reached the record, and hands no positions", () => {
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  assert.match(src, /if \(!readState\(\)\.stale\) return answerFollowsCorrection\(ctx, P, pre, resume\);/,
    "the answer is checked only when the existing re-emit did not run, so the gate never asks twice");
  const body = src.slice(src.indexOf("async function answerFollowsCorrection("), src.indexOf("// (T3a, ruling 2026-08-26"));
  assert.equal((body.match(/await stage\(/g) ?? []).length, 1, "one re-ask, never a loop");
  assert.doesNotMatch(body, /correction: resume\.correction/, "an answer patch adds no finding, so it is handed no positions");
});

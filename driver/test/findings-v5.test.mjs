// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// PR-9 (E9 + the ask join) — findings.json v5: the typed sub-schemas that retire the prose walls
// (mark_assessment fields as string OR structured rows; coverage_judgment.rows[]; corrections.entries[])
// plus the top-level ask_answers[] register, their deterministic STRING PROJECTIONS (what the hash-frozen
// renderer receives — render.mjs is untouched by construction), and the intake-ask → answer join every
// consumer shares. All offline, synthetic fixtures (structure-copied shapes only — no client data).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFindingsJson, parseFindingsJsonLenient,
  projectAssessmentField, projectMarkAssessment, projectCoverageJudgment, projectCorrections,
  joinAskToAnswer,
} from "../findings-model.mjs";

const meter = (token, basis = "verified-from-record") => ({ token, basis });
const FINDING = {
  ordinal: 1, mark: "VOLTMAX", disposition: "adversarial", band: "High",
  owner: { name: "Synth Beverages GmbH", country: "DE", registrations: [{ uri: "/mark/eu/000000001" }] },
  meters: { mark_similarity: meter("high"), goods_proximity: meter("high"), use: meter("confirmed"), enforcer: meter("medium", "inferred-from-signal") },
  quadrant: { x: 0.8, y: 0.7 },
  source: { source_type: "register-vendor", resolved_link: "https://example.com/r/1" },
};
const STRUCTURED_DIST = {
  spectrum: "Suggestive in the beverage field",
  per_class: [{ class: "5", note: "descriptive edge for supplements" }, { class: "32", note: "distinctive for soft drinks" }],
  per_market: [{ market: "CN", note: "transliterated form reads as coined" }],
  counter_registrations: [{ mark: "VOLTIX", uri: "/mark/eu/000000009", note: "coexists since 2019" }],
  acquired: "no acquired-distinctiveness claim needed",
};
const v5doc = (extra = {}) => JSON.stringify({
  schema_version: 5, rated_under_framework: "house-default",
  findings: [FINDING],
  coverage: [{ area: "register / EU", state: "confirmed-clean", note: "enumerated" }],
  ...extra,
});

// ---- top-level shape --------------------------------------------------------------------------------

test("v5: ask_answers[] parses and returns; v4 rejects the key token-first (the contract is versioned)", () => {
  const asks = [{ ask: "check the Benelux position", answer: "nothing found in BX registers" }];
  const v = parseFindingsJson(v5doc({ ask_answers: asks }));
  assert.equal(v.schemaVersion, 5);
  assert.deepEqual(v.askAnswers, asks);
  // a v5 doc without the register parses clean (refless runs)
  assert.equal(parseFindingsJson(v5doc()).askAnswers, null);
  const v4 = JSON.parse(v5doc({ ask_answers: asks })); v4.schema_version = 4;
  assert.throws(() => parseFindingsJson(JSON.stringify(v4)), /findings_key_unknown:ask_answers/);
});

test("v5 ask_answers entries validate token-first: missing ask / missing answer / unknown key", () => {
  assert.throws(() => parseFindingsJson(v5doc({ ask_answers: [{ answer: "x" }] })), /finding_ask_answer_ask_missing:0/);
  assert.throws(() => parseFindingsJson(v5doc({ ask_answers: [{ ask: "a" }] })), /finding_ask_answer_answer_missing:0/);
  assert.throws(() => parseFindingsJson(v5doc({ ask_answers: [{ ask: "a", answer: "b", extra: 1 }] })), /finding_ask_answer_key_unknown:extra/);
  assert.throws(() => parseFindingsJson(v5doc({ ask_answers: { ask: "a" } })), /findings_ask_answers_invalid/);
  assert.throws(() => parseFindingsJson(v5doc({ ask_answers: [{ ask: "a", answer: "b", ordinals: ["x"] }] })), /finding_ask_answer_ordinals_invalid:0/);
});

test("lenient path: a malformed ask_answers entry is DROPPED per-entry, the valid rest survives", () => {
  const v = parseFindingsJsonLenient(v5doc({ ask_answers: [{ ask: "good", answer: "found" }, { ask: "" }] }));
  assert.equal(v.askAnswers.length, 1);
  assert.equal(v.askAnswers[0].ask, "good");
});

// ---- mark_assessment: string OR structured ----------------------------------------------------------

test("mark_assessment fields accept string OR structured object; empty-projection objects are rejected", () => {
  const both = parseFindingsJson(v5doc({ mark_assessment: { distinctiveness: STRUCTURED_DIST, connotation: "clean readings across EN/DE/CN" } }));
  assert.equal(typeof both.markAssessment.distinctiveness, "object");
  // legacy two-string form still parses byte-identically
  const legacy = parseFindingsJson(v5doc({ mark_assessment: { distinctiveness: "coined and strong", connotation: "no adverse readings" } }));
  assert.equal(legacy.markAssessment.distinctiveness, "coined and strong");
  // rows-only object with neither spectrum nor note would project to a headless table — rejected
  assert.throws(() => parseFindingsJson(v5doc({ mark_assessment: { distinctiveness: { per_class: [{ class: "5", note: "x" }] }, connotation: "ok" } })),
    /findings_mark_assessment_invalid/);
  assert.throws(() => parseFindingsJson(v5doc({ mark_assessment: { distinctiveness: { spectrum: "s", bogus: 1 }, connotation: "ok" } })),
    /findings_mark_assessment_key_unknown:distinctiveness.bogus/);
  assert.throws(() => parseFindingsJson(v5doc({ mark_assessment: { distinctiveness: { spectrum: "s", per_class: [{ note: "n" }] }, connotation: "ok" } })),
    /findings_mark_assessment_invalid/);
  assert.throws(() => parseFindingsJson(v5doc({ mark_assessment: { distinctiveness: { spectrum: "s", counter_registrations: [{ note: "n" }] }, connotation: "ok" } })),
    /findings_mark_assessment_invalid/, "a counter-registration row needs a mark or a uri");
});

test("coverage_judgment.rows[] validates when present; the judgment object itself stays a loose passthrough", () => {
  const v = parseFindingsJson(v5doc({ coverage_judgment: { sufficient: false, reason: "Cl. 30 open", rows: [{ area: "Cl. 30", note: "dispatched, not enumerated" }] } }));
  assert.equal(v.coverageJudgment.rows.length, 1);
  assert.throws(() => parseFindingsJson(v5doc({ coverage_judgment: { sufficient: true, reason: "r", rows: [{ area: "", note: "n" }] } })),
    /findings_coverage_judgment_rows_invalid/);
  assert.throws(() => parseFindingsJson(v5doc({ coverage_judgment: { sufficient: true, reason: "r", rows: [{ area: "a", note: "n", x: 1 }] } })),
    /findings_coverage_judgment_row_key_unknown:x/);
});

test("corrections.entries[] validates when present; legacy {applied, note} unchanged", () => {
  const c = { applied: true, note: "one line", entries: [{ entity: "VOLTIX", disposition: "withdrawn", note: "review killed it" }] };
  const v = parseFindingsJson(v5doc({ corrections: c }));
  assert.equal(v.corrections.entries[0].entity, "VOLTIX");
  assert.throws(() => parseFindingsJson(v5doc({ corrections: { ...c, entries: [{ entity: "X" }] } })), /findings_corrections_invalid/);
  assert.throws(() => parseFindingsJson(v5doc({ corrections: { ...c, entries: [{ entity: "X", disposition: "corrected", bogus: 1 }] } })),
    /findings_corrections_key_unknown:entries.bogus/);
});

// ---- projections: deterministic strings for the frozen renderer -------------------------------------

test("projectAssessmentField: strings pass through; structured objects project deterministically (same input, same bytes)", () => {
  assert.equal(projectAssessmentField("coined and strong"), "coined and strong");
  const p1 = projectAssessmentField(STRUCTURED_DIST);
  const p2 = projectAssessmentField(JSON.parse(JSON.stringify(STRUCTURED_DIST)));
  assert.equal(p1, p2, "byte-deterministic");
  assert.match(p1, /^Suggestive in the beverage field\./);
  assert.match(p1, /By class: Class 5 — descriptive edge for supplements; Class 32 — distinctive for soft drinks\./);
  assert.match(p1, /By market: CN — transliterated form reads as coined\./);
  assert.match(p1, /Coexisting registrations considered: VOLTIX \(\/mark\/eu\/000000009\) — coexists since 2019\./);
  assert.match(p1, /Acquired distinctiveness: no acquired-distinctiveness claim needed\./);
});

test("projectMarkAssessment: legacy two-string form is a BYTE-IDENTICAL passthrough (archived renders never change)", () => {
  const legacy = { distinctiveness: "a", connotation: "b" };
  assert.equal(projectMarkAssessment(legacy), legacy, "same object reference — no rewrite");
  const mixed = projectMarkAssessment({ distinctiveness: STRUCTURED_DIST, connotation: "clean" });
  assert.equal(typeof mixed.distinctiveness, "string");
  assert.equal(mixed.connotation, "clean");
});

test("projectCoverageJudgment folds rows into the reason; row-less objects pass through untouched", () => {
  const plain = { sufficient: false, reason: "r" };
  assert.equal(projectCoverageJudgment(plain), plain);
  const p = projectCoverageJudgment({ sufficient: false, reason: "Cl. 30 open", rows: [{ area: "Cl. 30", note: "not enumerated" }] });
  assert.equal(p.sufficient, false);
  assert.match(p.reason, /Cl\. 30 open — Cl\. 30: not enumerated\./);
  assert.equal(p.rows, undefined, "the projection is strings-only — the frozen renderer never sees rows");
});

test("projectCorrections folds entries into the note; entry-less objects pass through untouched", () => {
  const plain = { applied: true, note: "n" };
  assert.equal(projectCorrections(plain), plain);
  const p = projectCorrections({ applied: true, note: "review pass", entries: [{ entity: "VOLTIX", disposition: "corrected", note: "owner fixed" }] });
  assert.match(p.note, /review pass — VOLTIX: corrected \(owner fixed\)\./);
});

// ---- the ask join -----------------------------------------------------------------------------------

test("joinAskToAnswer: verbatim wins; paraphrase joins when unique; ambiguity and no-match return null", () => {
  const entries = [
    { ask: "check the Benelux position of the mark", answer: "nothing found" },
    { ask: "confirm the Chinese transliteration reading", answer: "clean" },
  ];
  assert.equal(joinAskToAnswer("check the Benelux position of the mark", entries), entries[0], "exact normalized equality");
  assert.equal(joinAskToAnswer("Check the BENELUX position of the mark.", entries), entries[0], "case/punct-insensitive exact");
  assert.equal(joinAskToAnswer("please check Benelux position for this mark", entries), entries[0], "majority-word unique match");
  assert.equal(joinAskToAnswer("check the Swiss watch market", entries), null, "no match ⇒ null, never a guess");
  const ambiguous = [{ ask: "check the register position in France", answer: "a" }, { ask: "check the register position in Spain", answer: "b" }];
  assert.equal(joinAskToAnswer("check the register position", ambiguous), null, "ambiguous fuzzy ⇒ null");
  assert.equal(joinAskToAnswer("", entries), null);
  assert.equal(joinAskToAnswer("anything", null), null);
});

// ---- P4 (spec 2026-07-30 §3): the `read` field — the one-sentence consequence the reader sees ------

test("mark_assessment.read: accepted on the structured form, leads the projection, and satisfies the non-silence gate alone", () => {
  const withRead = { ...STRUCTURED_DIST, read: "A weak name to own" };
  const v = parseFindingsJson(v5doc({ mark_assessment: { distinctiveness: withRead, connotation: "clean" } }));
  assert.equal(v.markAssessment.distinctiveness.read, "A weak name to own");
  assert.match(projectAssessmentField(withRead), /^A weak name to own\./, "the read leads the projected string");
  // read alone is enough — an object of rows + read must not throw the silence gate
  const readOnly = { read: "Reads clean everywhere searched.", per_market: [{ market: "CN", note: "clean" }] };
  const v2 = parseFindingsJson(v5doc({ mark_assessment: { distinctiveness: readOnly, connotation: "clean" } }));
  assert.equal(v2.markAssessment.distinctiveness.read, "Reads clean everywhere searched.");
  // a non-string read throws token-first, like every sibling field
  assert.throws(() => parseFindingsJson(v5doc({ mark_assessment: { distinctiveness: { ...STRUCTURED_DIST, read: 7 }, connotation: "clean" } })),
    /findings_mark_assessment_invalid/);
});

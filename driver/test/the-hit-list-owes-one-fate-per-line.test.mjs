// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE LIST IS THE WORKING OBJECT, AND EVERY LINE OWES EXACTLY ONE FATE.
//
// The completeness guarantee does not change with this redesign; only its granularity does. It used to
// be 640 authored memos and it becomes 640 codes, verified by counting. So the arm that matters is not
// "does a line look right" — it is "can this accounting be wrong without saying so".
import { test } from "node:test";
import assert from "node:assert/strict";
import { slimLine, assertFates, applyFates, FATES, LINE_GROUNDS, OPEN_ONLY_GROUNDS, BAND_CHECKED_GROUNDS, RETIRED_GROUND_TOKENS } from "../hit-list.mjs";

const REC = { record_id: "/mark/ch/AAA", _qid: "q1", mark_text: "QORIMEX", classes: [5],
  jurisdictions: "CH", status: "REGISTERED", owner_name: "Qorim Holdings AG" };

test("a line carries the dismissal fields and none of the band's bulk", () => {
  const l = slimLine(REC);
  assert.deepEqual(Object.keys(l).sort(), ["cl","fate","id","own","q","sign","st","terr"]);
  // The three fields that are 61% of a band row are the ones a dismissal never reads.
  for (const fat of ["_query", "_queries", "screen", "raw", "guid", "office"])
    assert.equal(fat in l, false, `${fat} is on the line; it is bulk, and no dismissal reason in the measured run leaned on it`);
  assert.equal(l.fate, FATES.NOT_PICKED, "a fresh line starts unpicked — a default of anything else pre-judges the field");
});

test("the reading rides only when the record has one", () => {
  assert.equal("read" in slimLine(REC), false);
  assert.equal(slimLine(REC, "KORIMEKUSU").read, "KORIMEKUSU");
});

test("⭐ PLANT: `goods` cannot dismiss a line unopened — if the reason needs the record, open it", () => {
  // The design's own rule, in code. On the measured run 15 discards were decided on the goods
  // recitation; every one must become an open rather than a cheaper dismissal, and this is what makes
  // that mechanical instead of a matter of care.
  const bad = { ...slimLine(REC), fate: FATES.NOT_PICKED, ground: "goods" };
  const v = assertFates([bad]);
  assert.equal(v.ok, false, "a line was dismissed unopened on a ground that requires reading the record");
  assert.match(v.problems[0], /needs the record/);
  assert.equal(OPEN_ONLY_GROUNDS.includes("goods"), true, "goods left LINE_GROUNDS without leaving OPEN_ONLY_GROUNDS — the refusal above would go quiet");

  // …and the same record, opened and then dismissed, is fine. The rule is about DISMISSING UNOPENED.
  assert.equal(assertFates([{ ...slimLine(REC), fate: FATES.OPENED_DISMISSED }]).ok, true);
});

test("⭐ PLANT: an owner-leg dismissal is the MODEL's join — code never re-derives it", () => {
  // The replay's constraint. 69 duplicate legs were dismissed as further legs of a right already
  // reported; an EXACT-STRING owner join leaves 20 of them unjoinable and a normalised one leaves 1,
  // because the same registrant appears as "… CO, INC." / "… COMPANY, INC." / "… Company, Inc.".
  //
  // So this accounting must accept an owner-leg dismissal WITHOUT checking the owner against anything.
  // Code that re-derived the join would manufacture ~20 needless opens, and it would be code deciding
  // two rights are the same mark — which this design forbids outright.
  const leg = { ...slimLine({ ...REC, record_id: "/mark/gb/BBB", owner_name: "QORIM HLDGS." }),
    fate: FATES.NOT_PICKED, ground: "owner-leg" };
  const v = assertFates([leg]);
  assert.equal(v.ok, true,
    "an owner-leg dismissal was refused. Nothing on this list names the right it is a leg OF, and the "
    + "accounting must not go looking: the join is the model's, on the line, and a code-side compare "
    + "would fail on spellings a reader joins without thinking.");
});

test("every line owes exactly one fate, and the accounting names its denominator", () => {
  const v = assertFates([{ ...slimLine(REC), fate: 7 }]);
  assert.equal(v.ok, false);
  assert.match(v.problems[0], /is not one of 0, 1, 2/);
  assert.equal(assertFates([]).denominator, "lines",
    "the verdict does not say which population it counted — three were in play on the measured run "
    + "(1,937 enumerated, 685 owed, 2,040 hydrated) and a count that does not name one is not a measurement");
});

test("⭐ PLANT: a dismissal with no ground is caught — one word is still an answer, none is not", () => {
  const v = assertFates([{ ...slimLine(REC), fate: FATES.NOT_PICKED }]);
  assert.equal(v.ok, false);
  assert.match(v.problems[0], /no ground/);
});

test("⭐ PLANT: two lines for one record is a defect, and so is a line with no id", () => {
  const a = { ...slimLine(REC), fate: FATES.REPORTED };
  assert.match(assertFates([a, { ...a }]).problems[0], /duplicate id/);
  assert.match(assertFates([{ ...a, id: null }]).problems[0], /no id/);
});

test("the ground sets are disjoint and closed — a code cannot mean two questions", () => {
  // The run this derives from labelled 481 discards `off-field`, and that label meant "outside the
  // scope markets" 320 times and "a different sign" 152 times. One code, two questions, unverifiable.
  for (const g of LINE_GROUNDS) assert.equal(OPEN_ONLY_GROUNDS.includes(g), false, `${g} is in both sets`);
  // REWRITTEN TO THE NEW CONTRACT, not re-stamped. The set gained `out-of-class` when the two
  // vocabularies merged — it is line-decidable, the digest's own closed set always had it, and my
  // derivation missed it because the round I sampled expressed class drops as `off-field`. A set
  // derived from a sample is missing whatever the sample was.
  assert.deepEqual([...LINE_GROUNDS].sort(), ["out-of-class", "owner-leg", "sign", "status", "territory"]);
  // `off-field` must NOT come back: it carried 481 discards meaning territory 320 times and sign 152.
  assert.equal(LINE_GROUNDS.includes("off-field"), false, "the conflated token is back in the live set");
  assert.equal(RETIRED_GROUND_TOKENS["off-field"], null,
    "`off-field` was given a single successor. Which of territory or sign an archived row meant is not "
    + "recoverable from the token — a reader must say so rather than pick one and be right 2 times in 3.");
});

test("⭐ PLANT: the band's read beats the seat's relabel on a ground the band knows", () => {
  // Inherited from the transport this vocabulary replaces. A seat may not relabel a record the band
  // screened live-and-in-scope into a status or class drop; prose grounds let that happen unseen.
  const line = { ...slimLine(REC), fate: FATES.NOT_PICKED, ground: "status" };
  const relabel = assertFates([line], { verdictOf: () => "surface:in-scope-live" });
  assert.equal(relabel.ok, false, "a record the band screened live was dismissed as dead and nothing objected");
  assert.match(relabel.problems[0], /the band's read is the authority/);

  const honest = assertFates([line], { verdictOf: () => "drop:dead" });
  assert.equal(honest.ok, true, "a status dismissal agreeing with the band's own verdict was refused");
});

test("⭐ PLANT: an absent verdict is UNCHECKED, never a pass", () => {
  // The failure family this whole issue is about: a silence reading as an answer. Without a lookup the
  // cross-check cannot run, so it says so, and `unchecked` is reported separately from `ok`.
  const v = assertFates([{ ...slimLine(REC), fate: FATES.NOT_PICKED, ground: "status" }]);
  assert.equal(v.ok, true, "a line with no verdict available is not itself a defect");
  assert.equal(v.unchecked.length, 1, "the check silently did not run and nothing said so");
  assert.match(v.unchecked[0], /no screen verdict was available/);
});

test("⭐ PLANT: territory is checked against the instructed scope, and owner-leg is NOT checked at all", () => {
  const inScope = { ...slimLine({ ...REC, jurisdictions: "CH" }), fate: FATES.NOT_PICKED, ground: "territory" };
  const bad = assertFates([inScope], { scopeTerritories: ["CH", "EU"] });
  assert.equal(bad.ok, false, "a record in an instructed territory was dismissed as out-of-territory");
  assert.match(bad.problems[0], /IS an instructed territory/);

  const good = assertFates([inScope], { scopeTerritories: ["US", "JP"] });
  assert.equal(good.ok, true);

  // THE RULED CONSTRAINT, armed as an absence: no lookup is consulted for an owner-leg dismissal, even
  // when one is supplied. The join between two legs of one right is the model's, made on the line —
  // code re-deriving it would manufacture ~20 needless opens on the measured round and would be code
  // deciding two rights are the same mark.
  let asked = false;
  const leg = { ...slimLine(REC), fate: FATES.NOT_PICKED, ground: "owner-leg" };
  const r = assertFates([leg], { verdictOf: () => { asked = true; return "surface:in-scope-live"; }, scopeTerritories: ["CH"] });
  assert.equal(r.ok, true, "an owner-leg dismissal was refused — the join is the model's, not the code's");
  assert.equal(asked, false, "the code consulted the band about an owner-leg join it is forbidden to re-derive");
  assert.equal("owner-leg" in BAND_CHECKED_GROUNDS, false);
});

// ── APPLYING THE DIGEST'S MARKS ─────────────────────────────────────────────────────────────────────

const listOf = (...ids) => ({ schema_version: 1, lines: ids.map((id) => slimLine({ ...REC, record_id: id })) });

test("the digest's marks land on the list, and the verdict lands with them", () => {
  let saved = null;
  const r = applyFates("/list.json", [
    { id: "/mark/ch/A", fate: FATES.REPORTED },
    { id: "/mark/ch/B", fate: FATES.NOT_PICKED, ground: "territory" },
  ], { readJson: () => listOf("/mark/ch/A", "/mark/ch/B"), writeJson: (_, o) => { saved = o; } });

  assert.equal(r.applied, 2);
  assert.equal(saved.lines[0].fate, FATES.REPORTED);
  assert.equal(saved.lines[1].ground, "territory");
  assert.ok(saved.fate_verdict, "the compliance verdict is not on the artifact — a measurement that dies in a log is the failure family this issue is about");
  assert.equal(saved.fate_verdict.denominator, "lines");
  assert.equal(saved.fate_verdict.gating, false,
    "the artifact does not say this verdict was non-gating. Somebody later reads a passing assert as a gate that fired, or an absent one as an oversight.");
});

test("⭐ PLANT: a fate for an id NOT on the list is named, never silently dropped", () => {
  // 103 records were fetched but never enumerated on the measured round. The list is the enumerated
  // population, so a mark on something outside it is a disagreement about what the run found — and
  // this is exactly where that class surfaces.
  let saved = null;
  const r = applyFates("/list.json", [{ id: "/mark/ch/GHOST", fate: FATES.REPORTED }],
    { readJson: () => listOf("/mark/ch/A"), writeJson: (_, o) => { saved = o; } });
  assert.equal(r.applied, 0);
  assert.deepEqual(r.unknown, ["/mark/ch/GHOST"], "a fate for an unknown id vanished instead of being named");
  assert.equal(saved.fate_verdict.unknown_ids, 1, "the artifact does not carry the count a reader would need");
});

test("⭐ PLANT: marking cannot fail the call — an absent list returns null rather than throwing", () => {
  // The deliver-always principle one layer down. A lost marking costs the next reader a projection; it
  // must never cost a client a report, so the caller can treat null as "nothing to mark".
  assert.equal(applyFates("/none.json", [{ id: "x", fate: 0 }], { readJson: () => null, writeJson: () => {} }), null);
  assert.equal(applyFates("/bad.json", [{ id: "x", fate: 0 }], { readJson: () => ({ no: "lines" }), writeJson: () => {} }), null);
});

// ── THE DICTATION ───────────────────────────────────────────────────────────────────────────────────

test("⭐ the dictation names the FIELD the seat sends, and its grounds come from the contract", async () => {
  // THE FAILURE THIS ARM EXISTS FOR, measured rather than imagined. ruled a rule
  // that described a downstream effect — "the string you sweep" — the run's own record proves the seat
  // opened the file, and it reached ONE variant of thirty-six. A rule a seat cannot map onto something
  // it SENDS produces nothing, and produces no refusal either.
  process.env.CLEAROTRON_DATABASE ??= "corsearch";
  const { STAGES, paths } = await import("../stages.mjs");
  const P = paths("/run", "slug", "code");
  const msg = STAGES["register-digest"].message({ paths: P, axes: ["primary-sweep"], registerOnly: false, depth: null });

  assert.match(msg, /`fates`/, "the dispatch does not name the field the seat sends — the 1955 shape exactly");
  assert.match(msg, /"fate": 0 \| 1 \| 2/, "the codes are not stated in the payload's own shape");
  assert.match(msg, /register-hit-list\.json/, "the dispatch does not name the artifact the seat marks");

  // THE GROUNDS ARE READ FROM THE CONTRACT, NEVER RETYPED. A hand-copied list in prose is how the
  // dictation and the validator come to disagree — `out-of-class` reached this set precisely because
  // one derivation missed what another had.
  for (const g of LINE_GROUNDS)
    assert.ok(msg.includes(g), `the dictation does not offer the ground "${g}", which the transport accepts`);
  assert.equal(msg.includes("off-field"), false,
    "the retired conflated token is back in the dictation — it meant territory 320 times and sign 152 on the measured round");

  // And the open-only rule reaches the seat in the seat's own terms.
  assert.match(msg, /that is not a ground, it is an OPEN/,
    "the dispatch does not tell the seat what to do when the reason needs the record — which is the one "
    + "instruction that keeps `goods` out of the line grounds in practice rather than only in the validator");
});

test("⭐ PLANT: the line answers what band_lookup asks — the qid SET and the screen's own liveness", () => {
  // Measured from the 47 lookups the archived round made, not from reading the filter list: qid was the
  // third-most-used filter and live_only the seventh. Both would have failed QUIETLY on a line without
  // these — qid by finding nothing for a quarter of the band, live_only by answering differently.
  const multi = slimLine({ ...REC, _qid: "a", _qids: ["a", "b"], screen: { live_status: "dead" } });
  assert.deepEqual(multi.qs, ["a", "b"], "the full qid set is not on the line; 482 of 1,937 records carry more than one");
  assert.equal(multi.q, "a", "`q` changed type — a landed reader breaks on that, and a new optional key costs it nothing");
  assert.equal(multi.live, "dead", "the screen's own liveness verdict is missing, so live_only falls back to parsing status text and can answer differently");

  // ✕ THE PLURAL RIDES ONLY WHERE THERE IS ONE. A single-qid record carries no `qs`, so the field means
  // "there are others" rather than "here is the one you already have".
  const single = slimLine({ ...REC, _qid: "a", _qids: ["a"] });
  assert.equal("qs" in single, false, "a single-qid record carries a redundant set");
  assert.equal("live" in slimLine(REC), false, "a record with no screen verdict invents one");
});

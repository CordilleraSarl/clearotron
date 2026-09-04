// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE LOCATOR AND THE PROOF ARE TWO FIELDS.
//
// The anchor did both jobs in one string, with incompatible requirements: long enough to pin an extraction
// span by exact match, short enough to be copied correctly. The locator duty is what made it unsatisfiable
// — 33 of 34 CJK-bearing runs carry `quote_unbound` against 0 of 47 Latin-only, and on R5 round
// `892dd88e` a seat spent 163 calls walking `receipt_index` 1–8 on two rows because only 2–3 of the 8
// candidates were Latin-only and its English anchors could bind nowhere else.
//
// These tests are ordered by what they defend:
//   1. the LOCATOR is never unsatisfiable — the property the old anchor lacked;
//   2. the PROOF still discriminates — the property a bare ordinal would have thrown away;
//   3. the two do not leak into each other;
//   4. CJK is served, which is the population this exists for.
import test from "node:test";
import assert from "node:assert/strict";
import { snippetSegments, segmentBinding } from "../connotation-search.mjs";

// A Japanese snippet of the shape R5 actually died on: predominantly CJK, multiple sentences.
const JA = "メリディアン シスルは長年使われている商標です。この語はアザミを意味します。"
  + "登録は第九類で有効です。";
const EN = "Meridian Thistle is a long-established mark in the trade. "
  + "The term refers to a species of thistle. Its registration in class 9 remains live.";

const cand = (snippet) => ({ receipt_id: "R-AAAAAAAA", snippet });

// ── 1. THE LOCATOR IS NEVER UNSATISFIABLE ───────────────────────────────────────────────────────────

test("SEGMENTATION never returns zero segments for a snippet that has any text", () => {
  // A zero-segment snippet would make an owed row impossible to discharge — this issue, in a new place.
  for (const s of [JA, EN, "no terminator at all", "one.", "  padded  ", "a\nb\nc", "。", "!!!"]) {
    assert.ok(snippetSegments(s).length >= 1, `"${s.slice(0, 20)}" segmented to zero`);
  }
  // Only genuinely empty text yields nothing, and that row can never be quote_required — usableSnippet
  // gates on QUOTE_MIN weight, which empty text cannot reach.
  for (const s of ["", "   ", "\n\n", null, undefined]) assert.deepEqual(snippetSegments(s), []);
});

test("SEGMENTATION splits CJK, which whitespace segmentation cannot", () => {
  const segs = snippetSegments(JA);
  assert.equal(segs.length, 3, `CJK snippet split to ${segs.length} — a space-delimited split returns 1, and 1 is the population this change exists for`);
  assert.match(segs[0], /^メリディアン/);
  assert.match(segs[1], /アザミ/);
  // Raw, not normalised: this text is copied into an artifact a lawyer reads.
  assert.ok(segs.every((s) => s === s.trim()), "segments are trimmed at the edges only");
});

test("THE LOCATOR ALWAYS HAS A SATISFIABLE ANSWER — every in-range ordinal binds, on both scripts", () => {
  // This is the property the anchor lacked and the reason this design is not a threshold tweak. For every
  // segment of every snippet there exists an answer the driver accepts.
  for (const [name, snippet] of [["ja", JA], ["en", EN]]) {
    const segs = snippetSegments(snippet);
    for (let i = 1; i <= segs.length; i++) {
      const seg = segs[i - 1];
      // A fragment taken from that segment — what a seat that read it can always produce.
      const frag = Array.from(seg).slice(0, 8).join("");
      const r = segmentBinding({ segment_index: i, fragment: frag }, cand(snippet));
      assert.equal(r.state, "bound", `${name} segment ${i} did not bind (${r.state}) — the locator must never be unwinnable`);
      assert.ok(r.quote && r.quote.length, `${name} segment ${i} bound with no quote`);
    }
  }
});

test("an out-of-range or malformed ordinal is REFUSED, not bound to something nearby", () => {
  const segs = snippetSegments(EN).length;
  for (const bad of [0, segs + 1, 99, "2.5", "2px", "two", "-1"]) {
    const r = segmentBinding({ segment_index: bad, fragment: "Meridian Thistle" }, cand(EN));
    assert.equal(r.state, "segment_invalid", `${JSON.stringify(bad)} was not refused — it returned ${r.state}`);
  }
  // A WHITESPACE-PADDED INTEGER IS ACCEPTED, deliberately, because `resolveCandidate` accepts one: it
  // trims before its own `/^\d+$/` test. I first asserted this was refused and the test was wrong, not the
  // code — two ordinal resolvers in one file disagreeing about what an ordinal is would be a worse defect
  // than the leniency. (resolveCandidate's comment lists " 2 " among what `Number()` wrongly takes, which
  // reads as if it were rejected; it is the trim that saves it. Noted here because the next reader of that
  // comment will make the same inference I did.)
  assert.equal(segmentBinding({ segment_index: " 2 ", fragment: "term refers" }, cand(EN)).state, "bound",
    "a padded integer must resolve exactly as resolveCandidate resolves one");
  assert.equal(segmentBinding({ fragment: "Meridian Thistle" }, cand(EN)).state, "segment_missing",
    "no ordinal at all is its own state: the seat gave nothing to resolve, which is a different defect from giving something wrong");
});

// ── 2. THE PROOF STILL DISCRIMINATES ────────────────────────────────────────────────────────────────

// ── A TEST NAME IS THE ARTIFACT A READER SEES; THE BODY IS NOT ─────────────────────────────────────
//
// changed what these three arms assert and left their titles saying "…is refused". They passed,
// so nothing complained — and a TAP log then read `ok - a TRANSLATED fragment is refused` on a build
// where a translated fragment is deliberately NOT refused. Anyone certifying the change from CI output
// would have concluded the opposite of what shipped. Caught in review by the test lane, not by the
// suite, because a green arm with a wrong name is invisible to every mechanism here.
//
// The rule this leaves behind: when an assertion flips, the NAME is part of the diff. Renaming is not
// tidying — the name is the only part of a passing test anybody reads.

test("a fragment from the WRONG segment is RECORDED `unbound` — the pointer still binds the row", () => {
  // The whole reason the fragment survives. Without it any in-range integer passes and a seat that read
  // nothing can answer `1`. Here the ordinal is right and the fragment comes from elsewhere in the snippet.
  const segs = snippetSegments(EN);
  const fromOther = Array.from(segs[2]).slice(0, 12).join("");
  const r = segmentBinding({ segment_index: 1, fragment: fromOther }, cand(EN));
  // — STILL DETECTED, NO LONGER CHARGED. The row binds on the pointer; the mismatch is recorded.
  // The comment above said this check "is the only thing proving the seat read anything", and the
  // histogram that closed this issue refuted it: `fragment_unbound` 65 of 144 refusals are seats that
  // pointed at the RIGHT passage and could not reproduce its characters. It measures transcription. A
  // seat that read nothing is still caught, by `segment_dead_end` and by the pointer having to be in
  // range at all.
  assert.equal(r.state, "bound", "a correct pointer must bind — the fragment no longer decides the row");
  assert.equal(r.fragmentState, "unbound",
    "the mismatch was not recorded — dropping the duty must not drop the signal, or the next reader "
    + "cannot check whether dropping it was safe");
});

test("a TRANSLATED fragment is RECORDED `unbound` — the R5 failure stays VISIBLE, and stops being charged", () => {
  // The seat supplied English paraphrases of Japanese source text on 157 of 168 anchors. That was correctly
  // refused before and is correctly refused now: the fix makes the LOCATOR satisfiable, it does not accept
  // a translation as evidence of reading.
  const r = segmentBinding({ segment_index: 1, fragment: "long-established trademark" }, cand(JA));
  // The R5 failure — English paraphrases on 157 of 168 anchors — must still be VISIBLE. changes
  // what it costs, not whether it is seen: the row binds and the gloss is recorded as `unbound`, which
  // is the counter that makes "how often does the seat translate instead of copying" answerable on a
  // current run instead of only on an archived ledger.
  assert.equal(r.state, "bound");
  assert.equal(r.fragmentState, "unbound",
    "an English gloss recorded as bound against Japanese source text — the signal has been lost, not relocated");
});

test("a fragment too short to be unguessable is RECORDED `too_short`, and the bar is in WEIGHT so CJK is not overcharged", () => {
  // `quoteWeight` measures unguessability, which is exactly the right unit for a proof bar — the bug was
  // ever using it to decide TRANSCRIBABILITY. A 2-codepoint CJK fragment clears; 2 Latin characters do not.
  // — the WEIGHT bar survives as the grader of the recorded evidence, which is the job it was
  // always right for. What it no longer does is refuse the row.
  assert.equal(segmentBinding({ segment_index: 1, fragment: "Me" }, cand(EN)).fragmentState, "too_short");
  assert.equal(segmentBinding({ segment_index: 2, fragment: "アザミ" }, cand(JA)).fragmentState, "bound",
    "three CJK codepoints must clear the bar — charging CJK Latin-length is the bias that caused this issue");
  assert.equal(segmentBinding({ segment_index: 1, fragment: "" }, cand(EN)).fragmentState, "absent",
    "absent and too-short are different facts about the seat and must stay distinguishable");
  // And none of the three costs a call any more.
  for (const f of ["Me", "アザミ", ""])
    assert.equal(segmentBinding({ segment_index: 1, fragment: f }, cand(EN)).state, "bound",
      `a fragment of ${JSON.stringify(f)} still decided the row`);
});

test("the proof is checked SYMMETRICALLY under the binder's own normalisation", () => {
  // Encoding variance is not evidence about reading. A curly apostrophe against a straight one, or a line
  // break the seat rendered as a space, must not read as a seat that did not look.
  const s = "The owner’s mark is live. It was filed in 2014.";
  assert.equal(segmentBinding({ segment_index: 1, fragment: "owner's mark" }, cand(s)).state, "bound",
    "a straight apostrophe against a curly one was refused — that is encoding variance, not non-reading");
  assert.equal(segmentBinding({ segment_index: 1, fragment: "THE   OWNER’S" }, cand(s)).state, "bound",
    "case and whitespace runs are folded on BOTH sides, or the check refuses correct work");
});

// ── 3. THE TWO DUTIES DO NOT LEAK ───────────────────────────────────────────────────────────────────

test("THE FRAGMENT NEVER LOCATES ANYTHING: the quote comes from the POINTED segment, not from the match", () => {
  // The separation, asserted directly. If the fragment were used to locate, a fragment that also appears
  // in an earlier segment would move the extraction. It must not.
  const s = "Alpha the mark is live here. Beta the mark is live here too. Gamma closes the record for good.";
  const r = segmentBinding({ segment_index: 2, fragment: "the mark is live" }, cand(s));
  assert.equal(r.state, "bound");
  assert.match(r.segment, /^Beta/,
    "the pointed segment must be segment 2 — a fragment that appears in segment 1 as well must not drag the locator backwards");
  assert.match(r.quote, /Beta/, "the quote is extracted from where the seat POINTED, never from where the fragment happened to match");
});

test("the quote is VERBATIM RAW TEXT and grows only when the segment is too thin to stand alone", () => {
  const short = "Live mark. " + "It was filed in 2014 by an unrelated proprietor and remains in force today.";
  const r = segmentBinding({ segment_index: 1, fragment: "Live mark" }, cand(short));
  assert.equal(r.state, "bound");
  assert.equal(r.segment, "Live mark.", "the POINTED segment is reported as pointed at, ungrown");
  assert.ok(r.quote.length > r.segment.length,
    "a segment below QUOTE_MIN must grow into its neighbours — otherwise the artifact carries evidence too thin to read");
  assert.ok(short.includes("It was filed"), "control: the growth target is real text in the snippet");
  assert.match(r.quote, /Live mark\. It was filed/, "growth reads ONWARD from the pointed segment first, verbatim");
});

test("NEGATIVE CONTROL — an empty candidate cannot bind, and nothing throws", () => {
  for (const c of [null, undefined, {}, { snippet: "" }, { snippet: "   " }]) {
    const r = segmentBinding({ segment_index: 1, fragment: "anything at all" }, c);
    assert.equal(r.state, "no_segments", "a candidate with no snippet must report no segments, not bind and not throw");
    assert.equal(r.segments, 0);
  }
  // And the whole function is total: no input shape throws.
  assert.doesNotThrow(() => segmentBinding(undefined, undefined));
  assert.doesNotThrow(() => segmentBinding({ segment_index: {}, fragment: [] }, cand(EN)));
});

// ── 4. THE POPULATION THIS EXISTS FOR ───────────────────────────────────────────────────────────────

test("THE R5 SHAPE: a CJK row is now dischargeable on every candidate, where the anchor walk was unwinnable", () => {
  // R5's row had 8 candidates, 2–3 Latin-only, and the seat walked all 8. Under segment pointing every one
  // of them has a satisfiable answer, so there is no walk to run.
  const candidates = [JA, EN, JA, JA, EN, JA, JA, JA].map(cand);
  const bound = candidates.map((c, i) => {
    const seg = snippetSegments(c.snippet)[0];
    const frag = Array.from(seg).slice(0, 6).join("");
    return segmentBinding({ segment_index: 1, fragment: frag }, c).state;
  });
  assert.deepEqual(bound, Array(8).fill("bound"),
    `not every candidate was dischargeable: ${bound.join(", ")} — an unwinnable walk is exactly what cost 163 calls`);
});

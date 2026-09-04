// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// M2 — the seat POINTS at a passage and code copies it out, and the bar it must clear is measured
// in information rather than characters.
//
// Two halves, and the ruling is that they land together. The old spot-check asked a model to reproduce
// 24 characters of fetched text byte-perfectly and refused the whole row when it came back one character
// off — `connotation_quote_unbound`, three of twelve observed corrections, refusing rulings that were
// CORRECT. And the constant that set that bar ALSO decided which rows were eligible to be quote-required
// at all, so a CJK snippet under 24 characters — often a complete sentence — was judged unusable and
// dropped out of eligibility silently. Fixing the satisfaction bar alone would have left that standing
// and looked like a fix, which is why `quoteWeight` is asserted at BOTH sites below.

import { test } from "node:test";
import assert from "node:assert/strict";

import { quoteWeight, usableSnippet, quoteBinding, anchorBinding, spotCheckBinds, isRuled }
  from "../connotation-search.mjs";
import { unionDispositionForm } from "../disposition-union.mjs";

const LATIN = "The bartenders in Honolulu have argued about this wording for years now.";
const CJK = "关于这个词语的争论在檀香山的调酒师之间已经持续了很多年了真的很久";

const cand = (id, snippet) => ({ receipt_id: id, title: `t-${id}`, url: `https://example.invalid/${id}`, snippet });
const row = (cands, extra = {}) => ({ row_id: "Q-AAAAAAAA", kind: "query", query: "q", candidates: cands,
  quote_required: true, ...extra });

// ── the ONE measure ─────────────────────────────────────────────────────────────────────────────────

test("#850 M2 weight counts information, not characters — a hanzi is worth about three letters", () => {
  assert.equal(quoteWeight("abcd"), 4);
  assert.equal(quoteWeight("关"), 3);
  assert.equal(quoteWeight("关系"), 6);
  assert.equal(quoteWeight("ab关"), 5, "mixed text adds up per character");
});

test("#850 M2 the weighting is for DENSE scripts only — Cyrillic and Greek are alphabetic", () => {
  // The tempting version of this is "non-Latin", and it is wrong: one Cyrillic character carries about
  // as much as one Latin character, so weighting it would let a short fragment clear a bar it should not.
  assert.equal(quoteWeight("привет"), 6);
  assert.equal(quoteWeight("αβγδεζ"), 6);
  assert.ok(quoteWeight("こんにちは") > 5, "kana IS dense");
  assert.ok(quoteWeight("안녕하세요") > 5, "so is Hangul");
});

test("#850 M2 code POINTS, not code units — an astral ideograph counts once, and as DENSE", () => {
  // CJK Extension B is a surrogate pair in UTF-16, so a code-unit loop would both count it twice AND,
  // because neither half is in any BMP range, weigh both halves as Latin. Two errors cancelling into a
  // plausible number is exactly the kind of thing that never surfaces as a bug.
  const astral = "\u{20000}";
  assert.equal(astral.length, 2, "…which JS reports as length 2");
  assert.equal(quoteWeight(astral), 3, "one character, and a dense one");
  assert.equal(quoteWeight(astral + astral), 6);
});

test("#850 M2 BOTH SITES read the same measure — eligibility and satisfaction move together", () => {
  // The half that would have been missed. A CJK sentence of 10 characters is a real passage; under the
  // old flat count it was 10 < 24 and its row could never be quote-required at all.
  const shortCjk = "檀香山的调酒师之间";                      // 9 chars, weight 27 — a real phrase
  assert.ok(shortCjk.length < 24, "under the OLD character bar this snippet was unusable");
  assert.ok(usableSnippet(shortCjk), "under the weight bar it is eligible, which is the point");

  // And the satisfaction side agrees, from the same function. The fragment is a genuine substring of
  // the snippet — a fixture that was not would prove nothing about the bar.
  assert.ok(CJK.includes(shortCjk), "the fixture must actually be IN the snippet");
  assert.equal(quoteBinding(shortCjk, [cand("R-AAAAAAAA", CJK)]).state, "bound",
    "a CJK quote that is a real passage is no longer refused as too_short");
});

test("#850 M2 a genuinely tiny fragment is still refused, in either script", () => {
  assert.equal(quoteBinding("bartenders", [cand("R-AAAAAAAA", LATIN)]).state, "too_short");
  assert.equal(quoteBinding("关于", [cand("R-AAAAAAAA", CJK)]).state, "too_short", "two hanzi is weight 6");
});

// ── the anchor ──────────────────────────────────────────────────────────────────────────────────────

test("#850 M2 an anchor binds and CODE extracts the passage — the artifact holds fetched text", () => {
  const b = anchorBinding("Honolulu", [cand("R-AAAAAAAA", LATIN)]);
  assert.equal(b.state, "bound");
  assert.equal(b.receipt_id, "R-AAAAAAAA");
  assert.ok(b.quote.includes("Honolulu"), "the extracted run contains what the seat pointed at");
  assert.ok(quoteWeight(b.quote) >= 24, "and clears the bar the seat no longer has to clear itself");
  assert.ok(LATIN.includes(b.quote), "and is VERBATIM text from the driver's own captured snippet");
});

test("#850 M2 the extracted quote is real text even when the anchor sits at the very end", () => {
  // Expanding right first would run out of snippet here; it must fall back to expanding left rather
  // than returning something short.
  const b = anchorBinding("years now.", [cand("R-AAAAAAAA", LATIN)]);
  assert.equal(b.state, "bound");
  assert.ok(quoteWeight(b.quote) >= 24);
  assert.ok(LATIN.includes(b.quote));
});

test("#850 M2 A CJK ANCHOR WORKS, which is the row that failed", () => {
  const b = anchorBinding("调酒师", [cand("R-AAAAAAAA", CJK)]);
  assert.equal(b.state, "bound");
  assert.ok(b.quote.includes("调酒师"));
  assert.ok(CJK.includes(b.quote));
});

test("#850 M2 AN ANCHOR THAT BINDS NOWHERE IS REFUSED — pointing is not proof", () => {
  // The property that keeps the spot-check a spot-check. What changed is WHO copies the text, never
  // whether it has to be real, so nothing here is widened or fuzzy-matched.
  assert.equal(anchorBinding("a passage that is not in the snippet", [cand("R-AAAAAAAA", LATIN)]).state, "absent");
  assert.equal(anchorBinding("", [cand("R-AAAAAAAA", LATIN)]).state, "missing");
  assert.equal(anchorBinding("brief", [cand("R-AAAAAAAA", LATIN)]).state, "too_short",
    "an anchor too short to locate anything is its own state, not an absence");
  assert.equal(anchorBinding("Honolulu", []).state, "absent", "no candidates ⇒ nothing to bind against");
});

test("#850 M2 a row is discharged by EITHER route, and by neither when it has neither", () => {
  const c = [cand("R-AAAAAAAA", LATIN)];
  assert.ok(spotCheckBinds({ quote: LATIN.slice(0, 30) }, c), "the archived route: a verbatim quote");
  assert.ok(spotCheckBinds({ anchor: "Honolulu" }, c), "the new route: an anchor");
  assert.ok(!spotCheckBinds({}, c), "neither is not a pass");
  assert.ok(!spotCheckBinds({ anchor: "not present anywhere at all" }, c));
});

test("#850 M2 REPLAY: an archived quote-required row still discharges with no anchor", () => {
  // Every archived form carries a quote and no anchor. A check that accepted only anchors would re-open
  // every quote-required row in the corpus — the same trap M1's id fallback exists for.
  const canonical = row([cand("R-AAAAAAAA", LATIN)]);
  const archived = { ruling: "benign", note: "n", receipt_id: "R-AAAAAAAA", quote: LATIN.slice(0, 40) };
  assert.ok(isRuled(archived, canonical), "the archived row is still RULED");
});

// ── the union writes the extracted passage ──────────────────────────────────────────────────────────

const obOne = () => ({
  floor: 4,
  queries: [{ query: "meaning of the wording", results: [
    { id: "R-Q0C0", title: "t", url: "https://example.invalid/0", snippet: LATIN },
  ] }],
  recurrent: [],
});

test("#850 M2 the union writes the EXTRACTED passage into the artifact, and no anchor survives", () => {
  const ob = obOne();
  const submitted = [{ row_id: null, query: "meaning of the wording",
    ruling: "benign", note: "a line", anchor: "Honolulu" }];
  const { form } = unionDispositionForm(null, submitted, ob);
  const r = form.rows[0];
  if (r.quote_required) {
    assert.ok(r.quote, "the passage was copied out by code");
    assert.ok(LATIN.includes(r.quote), "and it is verbatim from the driver's captured snippet");
  }
  assert.ok(!("anchor" in r) || r.anchor == null,
    "the ANCHOR does not persist — it points into a list regenerated every pass, like the ordinal");
});

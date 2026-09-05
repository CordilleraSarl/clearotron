// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Crowds ride the hit list as a sibling array (Option A, ruled on tracker issue 95).
//
// WHY THIS EXISTS AT ALL. The locked design's acceptance 4 is that no stage reads the fat band or an
// unpicked record — `band_lookup` answers from the list instead. A crowd is a zone that could NOT be
// enumerated, so a lookup into a crowded zone that is absent from the list returns nothing, and nothing
// is indistinguishable from "searched and clean". Crowds-then-swap is the required order, and this arm
// is what says the first half is real before the second half is allowed to drop the band read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crowdLine, slimLine, FATES } from "../hit-list.mjs";

// A band crowd as named-band.mjs actually projects one, fat keys and all.
const bandCrowd = (over = {}) => ({
  query: "NOVA in class 9",
  total_hits: 4210,
  fetched: 50,
  reason: "too many hits to enumerate; paged to the cap",
  qid: "q7",
  covered_by: ["q7:a", "q7:b"],
  sample: [{ record_id: "r1" }, { record_id: "r2" }],
  term_counts: { nova: 4210 },
  class_counts: { 9: 4210 },
  ...over,
});

test("the ruled field set rides, and the fat keys do not", () => {
  const c = crowdLine(bandCrowd());
  assert.deepEqual(Object.keys(c).sort(),
    ["covered_by", "fetched", "qid", "query", "reason", "total_hits"].sort());
  for (const fat of ["sample", "term_counts", "class_counts"]) {
    assert.ok(!(fat in c), `${fat} is 82%-of-bytes material that stays on the band — it must not ride the list`);
  }
});

// The bug this arm was written after finding: driving the function, not reading it.
// `Number(null)` is 0 and 0 is finite, so a bare Number.isFinite test turns "the executor could not
// take this count" into "it measured zero" — an absence read as a measurement.
test("a count that could NOT be taken stays null — it never becomes a measured zero", () => {
  assert.equal(crowdLine(bandCrowd({ total_hits: null })).total_hits, null);
  assert.equal(crowdLine({ query: "Q" }).total_hits, null, "an absent count is unknown, not zero");
  assert.equal(crowdLine(bandCrowd({ total_hits: 0 })).total_hits, 0, "and a REAL zero survives as zero");
});

test("type before value: an array is not a count", () => {
  // named-band.mjs's countOrNull carries this rule and its own arm caught it once already.
  // Reused rather than re-implemented, so the two cannot drift.
  for (const bad of [[], [5], {}, "", "  ", "abc", NaN, Infinity]) {
    assert.equal(crowdLine(bandCrowd({ total_hits: bad })).total_hits, null,
      `${JSON.stringify(bad)} is not a count`);
  }
  assert.equal(crowdLine(bandCrowd({ total_hits: "12" })).total_hits, 12, "a numeric string is");
});

// The stamps that say a zero is not a measurement. Each rides only when the band carried it, because
// an absent key ("the executor never stamped one") and a false are different claims.
test("the error stamp survives — a provider failure is never a sanctioned crowd that found nothing", () => {
  const errored = crowdLine({ query: "X", total_hits: 0, fetched: 0, error: true, reason: "provider 500" });
  assert.equal(errored.error, true);
  assert.equal(errored.total_hits, 0, "execute-plan writes 0 deliberately; `error` is the field that says it is not a measurement");
  assert.ok(!("error" in crowdLine(bandCrowd())), "and a healthy crowd carries no error key at all, rather than error:false");
});

test("the deferred stamp survives, and is likewise absent rather than false", () => {
  assert.equal(crowdLine({ query: "X", deferred: true }).deferred, true);
  assert.ok(!("deferred" in crowdLine(bandCrowd())));
});

test("qid and covered_by ride only where the band stamped them", () => {
  const modelAuthored = crowdLine({ query: "judgment block with no executor stamp" });
  assert.ok(!("qid" in modelAuthored), "model-authored judgment blocks carry no qid — absent, not null");
  assert.ok(!("covered_by" in modelAuthored));
  assert.ok(!("covered_by" in crowdLine(bandCrowd({ covered_by: [] }))), "an EMPTY pointer list is not a pointer");
  assert.deepEqual(crowdLine(bandCrowd()).covered_by, ["q7:a", "q7:b"]);
});

test("covered_by is copied, not aliased — the list cannot mutate the band it was projected from", () => {
  const src = bandCrowd();
  const c = crowdLine(src);
  c.covered_by.push("mutated");
  assert.deepEqual(src.covered_by, ["q7:a", "q7:b"]);
});

// ── the two arrays are different populations, and the document must not blur them ───────────────────
test("a crowd carries no fate code — it is not a record and has no denominator to join", () => {
  const c = crowdLine(bandCrowd());
  assert.ok(!("fate" in c),
    "a fate on a crowd would make assertFates count two populations under one denominator");
  // and the record line still does carry one, so the distinction is real rather than asserted
  assert.equal(slimLine({ record_id: "r1" }).fate, FATES.NOT_PICKED);
});

test("the crowd line uses the BAND's key names, not the record line's abbreviations", () => {
  const c = crowdLine(bandCrowd());
  const l = slimLine({ record_id: "r1", _qid: "q7" });
  assert.equal(c.query, "NOVA in class 9");
  assert.equal(l.q, "q7", "on a RECORD line `q` is the qid");
  assert.ok(!("q" in c),
    "reusing `q` for the query text would make one key mean two things across sibling arrays in one document");
});

// The additive guarantee: a reader already landed against the list keeps passing.
test("nothing about the record line moved or changed type", () => {
  const l = slimLine({ record_id: "r1", _qid: "q7", mark_text: "NOVA", classes: [9], jurisdictions: ["EU"], status: "live", owner_name: "Acme" });
  assert.deepEqual(l, { id: "r1", q: "q7", sign: "NOVA", cl: [9], terr: ["EU"], st: "live", own: "Acme", fate: FATES.NOT_PICKED });
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SCREENING PRODUCT'S REVIEWING PASS: what it can reach, what it cannot, and what it may not move.
//
// The rule already reached the clearance product through the stage that rewrites there. The screening
// product had two stages and no reviewing pass, so a flagged line was a note to whoever was fixing the
// run and nothing rewrote it. These arms hold the pass that closes that.
//
// WHY THE PLANTS ARE IN `factors[]` AND IN THE CAVEATS. Measured on the delivered demo record before any
// of this was written, those two surfaces carry ZERO flags — `factors[]` is four short bullets and the
// caveats are short by construction. An arm that only drove the surfaces which already flag cannot tell
// "this field is covered" from "this field is unreachable", because both look like a green run. So the
// coverage claim is made where the record is silent: plant into the quiet surfaces and watch them move.
//
// AND THE EXCLUSION IS DRIVEN IN BOTH DIRECTIONS. Half these words are ordinary English and several are
// plausible marks. Asserting only that a batch screening PREVAIL sees no flag is satisfied by a check
// that has stopped firing altogether, so the same planted sentence is run again under a different name
// and must flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { knockoutVisibleProse } from "../predelivery-lint.mjs";
import {
  ADDRESSABLE, addressKey, applyKnockoutReview, reviewEvidence, reviewAbout,
  validateKnockoutReviewFile, knockoutReviewFile, recordKnockoutReview,
} from "../knockout-review-record.mjs";

// A REAL DELIVERED RECORD, not an invented one: the shape these read is the shape a run writes, and a
// fixture of my own would only prove the fixture matches the reader.
const DEMO = new URL("../../demo/knockout-search/run/knockout-findings.json", import.meta.url);
const record = () => JSON.parse(readFileSync(DEMO, "utf8"));
const MARK = "VENQORI";

// The engine's own survivor sentence, matched at delivery by SURVIVOR_BOUNDARY_RE. Taken from the
// record rather than retyped — a copy here would pass this file while the real one moved.
const survivorIndex = (doc) =>
  doc.batch.standardCaveats.findIndex((c) => /not knocked out at this screen's depth/i.test(c));

const LONG = "This sentence is deliberately written to run well past the limit a default-visible line "
  + "is allowed to carry so that the deterministic read has something it must flag on the surface "
  + "being planted into rather than somewhere else entirely.";

test("the addressable set is what a CLIENT sees first, and every difference from the walk is named", () => {
  // The walk and this set are different on purpose, in two directions, and the arm names each difference
  // rather than asserting they match. Compared as SETS: two counts agreeing is not agreement, and these
  // two lists held nine entries each while being different nines.
  const walked = new Set(knockoutVisibleProse(record()).map((v) => v.at.field));
  const addressable = new Set(Object.keys(ADDRESSABLE));

  // WIDER BY DESIGN, and only by the fields whose exclusion has a stated reason. `registerReads` is
  // walked and is not in DEFAULT_VISIBLE_FIELDS.knockout, so it is not a line a client meets first and
  // the pass does not reach it; reconciling the two product lists is filed separately. Any OTHER field
  // appearing here is a surface a reader meets that nothing can rewrite — the defect this pass closes.
  const WALKED_NOT_ADDRESSABLE = ["registerReads"];
  for (const f of walked) {
    assert.ok(addressable.has(f) || WALKED_NOT_ADDRESSABLE.includes(f),
      `"${f}" is walked as visible prose, cannot be addressed, and has no stated reason`);
  }
  // The reason has to stay true: a field named here that the walk can no longer produce is a stale
  // exclusion. Driven against a record that CARRIES one — the delivered demo has an empty
  // `registerReads`, so asserting this off that record would test the fixture and not the walk.
  const carrying = record();
  carrying.marks[0].registerReads = [{ recordId: "r1", read: "A read of one filing." }];
  const walkedOnAFullRecord = new Set(knockoutVisibleProse(carrying).map((v) => v.at.field));
  for (const f of WALKED_NOT_ADDRESSABLE) {
    assert.ok(walkedOnAFullRecord.has(f), `"${f}" is excluded from the pass and the walk no longer produces it — stale`);
    assert.equal(addressable.has(f), false, `"${f}" is both excluded and addressable`);
  }
  // Nothing addressable may be absent from what a reader meets, or the seat holds an address for a line
  // nobody sees.
  for (const f of addressable) {
    assert.ok(walked.has(f), `"${f}" is addressable but the walk never produces it — an address for a line nobody sees`);
  }
});

test("a line the pass cannot address is never OFFERED to it either", () => {
  // Withholding it from ADDRESSABLE alone would leave the dispatch listing a line and the applier
  // refusing it — the seat's turn spent on a rewrite that was never going to land.
  const doc = record();
  doc.marks[0].registerReads = [{ recordId: "r1", read: LONG }];
  const ev = reviewEvidence(doc, reviewAbout(doc, null));
  assert.equal(ev.rows.some((r) => r.at.field === "registerReads"), false,
    "a field outside the pass was offered as evidence");
  // …and the control: the same planted sentence on an addressable field IS offered, so the arm above
  // is not satisfied by a measurement that found nothing at all.
  doc.marks[0].mitigation = LONG;
  const ev2 = reviewEvidence(doc, reviewAbout(doc, null));
  assert.ok(ev2.rows.some((r) => r.at.field === "mitigation"),
    "the evidence pass found nothing on an addressable field — it is measuring nothing");
});

test("the walk reaches a plausibly large surface — a floor, so a broken walk cannot read as a clean one", () => {
  // Every arm below asserts something about what the walk found. A walk that silently returned nothing
  // would satisfy most of them by vacuity, so the population is asserted before anything about its
  // contents. The number is a floor and not the count: it must not need editing when the demo moves.
  const fields = knockoutVisibleProse(record());
  assert.ok(fields.length >= 10, `the walk found ${fields.length} default-visible lines on a real record — it broke`);
  assert.ok(new Set(fields.map((f) => f.at.field)).size >= 5, "the walk collapsed onto too few distinct fields");
});

test("a quiet surface is REACHABLE: a long line planted in factors[] is offered, and the rewrite lands", () => {
  const doc = record();
  doc.marks[0].factors[2] = LONG;
  const ev = reviewEvidence(doc, reviewAbout(doc, null));
  const row = ev.rows.find((r) => r.at.field === "factors" && r.at.index === 2);
  assert.ok(row, "a planted over-length factor was not offered to the pass — the field is unreachable");

  const { doc: out, receipt } = applyKnockoutReview(doc, {
    rewrites: [{ at: row.at, text: "Two other names sit near this one." }],
  });
  assert.equal(receipt.applied, 1);
  assert.equal(out.marks[0].factors[2], "Two other names sit near this one.");
  assert.equal(out.marks[0].factors.length, doc.marks[0].factors.length, "the array changed length");
});

test("the OTHER quiet surface is refused: the engine's own caveat is never offered and never rewritten", () => {
  const doc = record();
  const i = survivorIndex(doc);
  assert.ok(i >= 0, "the delivered record no longer carries the survivor sentence — this arm is measuring nothing");
  doc.batch.standardCaveats[i] = `${doc.batch.standardCaveats[i]} ${LONG}`;

  const ev = reviewEvidence(doc, reviewAbout(doc, null));
  assert.equal(ev.rows.some((r) => r.at.field === "batch.standardCaveats" && r.at.index === i), false,
    "the engine's own caveat was offered to the pass — a rewrite there breaks the delivery match silently");

  // Not merely withheld from the dispatch: refused at the door, because a seat that composed the address
  // itself would otherwise reach a line the evidence never showed it.
  const { doc: out, receipt } = applyKnockoutReview(doc, {
    rewrites: [{ at: { field: "batch.standardCaveats", index: i }, text: "A shorter note." }],
  });
  assert.equal(receipt.applied, 0);
  assert.equal(receipt.refused.length, 1);
  assert.equal(out.batch.standardCaveats[i], doc.batch.standardCaveats[i], "the engine's caveat was rewritten");
});

test("...and the refusal is about WHO WROTE IT, not about caveats — a rater's own caveat is reachable", () => {
  // Without this the arm above is satisfied by a pass that simply cannot touch `standardCaveats` at all,
  // and the distinction it claims to draw would be untested. The two members of the class are driven
  // separately: one engine-written, one rater-written, same array, opposite outcomes.
  const doc = record();
  doc.batch.standardCaveats.push(LONG);
  const i = doc.batch.standardCaveats.length - 1;
  const ev = reviewEvidence(doc, reviewAbout(doc, null));
  assert.ok(ev.rows.some((r) => r.at.field === "batch.standardCaveats" && r.at.index === i),
    "a caveat the rater supplied was withheld from the pass — the exclusion is too wide");

  const { receipt, doc: out } = applyKnockoutReview(doc, {
    rewrites: [{ at: { field: "batch.standardCaveats", index: i }, text: "Ratings may move once the register is read." }],
  });
  assert.equal(receipt.applied, 1);
  assert.equal(out.batch.standardCaveats[i], "Ratings may move once the register is read.");
  assert.equal(out.batch.standardCaveats[survivorIndex(doc)], doc.batch.standardCaveats[survivorIndex(doc)]);
});

test("the names being screened are never flagged — and the check has not simply stopped firing", () => {
  // A mark can BE one of these words. PREVAIL is a real one and a plausible name, so a batch screening
  // it must not have its own name reported back as the lawyer's vocabulary.
  const planted = (name) => {
    const doc = record();
    doc.marks[0].name = name;
    doc.marks[0].basis = "PREVAIL is coined and nobody else uses it.";
    return reviewEvidence(doc, reviewAbout(doc, { marks: [{ name }] }));
  };
  const own = planted("PREVAIL");
  assert.equal(own.rows.some((r) => r.at.field === "basis"), false,
    "the name under screen was flagged as the profession's vocabulary on its own report");

  // THE OTHER DIRECTION, and it is the half that matters: the same sentence under a different name must
  // still flag, or the arm above is satisfied by a check that fires on nothing at all.
  const other = planted("NORTHWIND");
  assert.ok(other.rows.some((r) => r.at.field === "basis"),
    "the same sentence went unflagged under a name that is not the word — the check has stopped firing");
});

test("a run that named no mark to exclude is TOLD so, rather than reassured", () => {
  const doc = record();
  const named = reviewEvidence(doc, { marks: ["VENQORI"], owners: [] }).exclusionNote;
  const unnamed = reviewEvidence(doc, { marks: [], owners: ["Someone Ltd"] }).exclusionNote;
  assert.match(named, /were removed before reading/);
  assert.match(unnamed, /NAMED NO MARK TO EXCLUDE/,
    "a run with no marks was told the names were removed — false in exactly the state where a flag IS the name");
  // Owners come from the RECORD and marks from the PLAN, so a record full of owners must not fire the
  // reassurance for a batch that named none. Driven on the mixed state, which is the likelier one.
  assert.doesNotMatch(unnamed, /none of these is a hit inside a name being screened/);
});

test("a conflict's one sentence binds on its ORDINAL, not its position in the array", () => {
  // The merged gate re-ranks and renumbers findings on the band, so an index addresses a different row
  // after normalisation. Driven by putting the ordinals out of array order and rewriting the one whose
  // position and ordinal disagree.
  const doc = record();
  const f = doc.marks[0].findings;
  assert.ok(f.length >= 2, "the demo record no longer carries two conflicts — this arm is measuring nothing");
  [f[0].ordinal, f[1].ordinal] = [f[1].ordinal, f[0].ordinal];
  const target = f[1].ordinal;
  const { doc: out, receipt } = applyKnockoutReview(doc, {
    rewrites: [{ at: { field: "findings.net", mark: MARK, ordinal: target }, text: "They would probably win." }],
  });
  assert.equal(receipt.applied, 1);
  assert.equal(out.marks[0].findings.find((x) => x.ordinal === target).net, "They would probably win.");
  assert.notEqual(out.marks[0].findings.find((x) => x.ordinal !== target).net, "They would probably win.",
    "the rewrite landed on the row at that POSITION rather than the one with that ordinal");
});

test("the pass moves no band, no count and no record — and never edits the one it was handed", () => {
  const doc = record();
  const frozen = JSON.stringify(doc);
  const ev = reviewEvidence(doc, reviewAbout(doc, null));
  assert.ok(ev.rows.length, "the demo record flagged nothing — this arm would pass over an empty rewrite set");
  const { doc: out } = applyKnockoutReview(doc, {
    rewrites: ev.rows.map((r) => ({ at: r.at, text: "A short replacement line." })),
  });
  assert.equal(JSON.stringify(doc), frozen, "the record handed in was mutated — the caller has no original to fall back to");
  assert.equal(out.marks.length, doc.marks.length);
  assert.equal(out.batch.standardCaveats.length, doc.batch.standardCaveats.length);
  for (const [i, m] of out.marks.entries()) {
    assert.equal(m.rating, doc.marks[i].rating, "a mark's rating moved");
    assert.equal(m.findings.length, doc.marks[i].findings.length, "the finding count moved");
    assert.deepEqual(m.findings.map((x) => x.band), doc.marks[i].findings.map((x) => x.band), "a finding's band moved");
    assert.deepEqual(m.findings.map((x) => x.ordinal), doc.marks[i].findings.map((x) => x.ordinal), "an ordinal moved");
  }
});

test("an address that names no line on the record changes nothing, and is reported rather than guessed at", () => {
  const doc = record();
  const frozen = JSON.stringify(doc);
  const { doc: out, receipt } = applyKnockoutReview(doc, {
    rewrites: [
      { at: { field: "basis", mark: "A MARK THIS RUN NEVER SCREENED" }, text: "x" },
      { at: { field: "findings.net", mark: MARK, ordinal: 999 }, text: "x" },
    ],
  });
  assert.equal(receipt.applied, 0);
  assert.equal(receipt.unresolved.length, 2);
  assert.equal(JSON.stringify(out), frozen, "an unresolved address still changed the record");
});

test("the validator joins every address against the record on disk, and says so when it cannot look", () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-review-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  const reviewPath = knockoutReviewFile(dir);
  const write = (doc) => { writeFileSync(reviewPath, JSON.stringify(doc)); return readFileSync(reviewPath, "utf8"); };

  // NO RECORD YET: a could-not-look, said as one. Passing here would let every address through unchecked
  // and read on the receipt exactly like a run whose addresses all resolved.
  const blind = write({ rewrites: [{ at: { field: "basis", mark: MARK }, text: "x" }] });
  const v0 = validateKnockoutReviewFile(reviewPath, blind);
  assert.equal(v0.ok, false);
  assert.match(v0.reason, /not on disk/);

  writeFileSync(join(dir, "knockout-findings.json"), JSON.stringify(record()));
  assert.equal(validateKnockoutReviewFile(reviewPath, blind).ok, true, "a resolvable address was refused");

  const bad = write({ rewrites: [{ at: { field: "basis", mark: "NOBODY" }, text: "x" }] });
  const v1 = validateKnockoutReviewFile(reviewPath, bad);
  assert.equal(v1.ok, false);
  assert.match(v1.reason, /names no line on this record/);

  const owned = write({ rewrites: [{ at: { field: "batch.standardCaveats", index: survivorIndex(record()) }, text: "x" }] });
  const v2 = validateKnockoutReviewFile(reviewPath, owned);
  assert.equal(v2.ok, false);
  assert.match(v2.reason, /the engine wrote/);
});

test("a repair turn keeps what it does not re-send", () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-review-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  const first = recordKnockoutReview(dir, {
    rewrites: [
      { at: { field: "basis", mark: MARK }, text: "one" },
      { at: { field: "mitigation", mark: MARK }, text: "two" },
    ],
    declined: [{ at: { field: "batch.executiveSummary" }, why: "already plain" }],
  });
  assert.equal(first.refused, null);

  const again = recordKnockoutReview(dir, { rewrites: [{ at: { field: "basis", mark: MARK }, text: "one, rewritten" }] });
  assert.equal(again.refused, null);
  const doc = JSON.parse(readFileSync(knockoutReviewFile(dir), "utf8"));
  // DERIVED, never a literal: the key's separator is a NUL and a hand-typed expectation would be
  // asserting the spelling rather than the property, and would go red on a separator change that
  // broke nothing.
  assert.deepEqual(doc.rewrites.map((r) => addressKey(r.at)).sort(),
    [addressKey({ field: "basis", mark: MARK }), addressKey({ field: "mitigation", mark: MARK })].sort(),
    "a repair turn deleted the row it did not re-send");
  assert.equal(doc.rewrites.find((r) => r.at.field === "basis").text, "one, rewritten");
  assert.equal(doc.declined.length, 1, "the declined rows did not survive the repair turn");
});

test("an empty call is refused — it cannot be told from a stage that never ran", () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-review-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  const r = recordKnockoutReview(dir, { rewrites: [], declined: [] });
  assert.equal(r.written, null);
  assert.match(String(r.refused), /cannot be told from a stage that never ran/);
});

test("the address grammar cannot express a band, an ordinal reassignment or a new finding", () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-review-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  for (const payload of [
    { rewrites: [{ at: { field: "band", mark: MARK }, text: "High" }] },
    { rewrites: [{ at: { field: "findings", mark: MARK, index: 0 }, text: "a new conflict" }] },
    { rewrites: [{ at: { field: "basis", mark: MARK }, text: "x", band: "High" }] },
  ]) {
    const r = recordKnockoutReview(dir, payload);
    assert.equal(r.written, null, `a payload reaching past presentation was accepted: ${JSON.stringify(payload)}`);
    assert.ok(r.refused, "…and it was not refused by name");
  }
});

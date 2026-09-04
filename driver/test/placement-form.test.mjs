// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — placements.json is the DRIVER'S, rendered from a form the seat only selects and judges into.
//
// THE DEFECT. `placement-inquiry` was the largest stage on all four of the 2026-08-09 round's delivered
// clearances, and on R1 half of its 62 minutes was thrown away:
//
//     att1  wall 1860.664  budget 1800  timeout  hardWall  wrote:true  quiescentMs 371177  rescued:null
//     att2  wall 1844.05   budget 2700  ok
//
// Attempt 1 had written a complete, valid `placement-recommendations.md` and lain quiescent for 371
// seconds against a 60-second bar. The wall rescue looked and REFUSED, because `validators.placement`
// failed `placementmodel_missing` while `placements.json` was absent — and the seat writes the prose
// first. 31 minutes of finished tiers were discarded and re-derived from nothing.
//
// THE ROW SOURCE WAS SETTLED BY MEASUREMENT. The first cut pre-wrote one row per band-shape floor record;
// joined against four archived runs that is the wrong population in BOTH directions (82 placed vs 251
// floors; 79 vs 66). The settling measurement — placed entries joined to `register-positions.json` —
// came back: every register candidate ever placed is a fold POSITION, zero were floor-only, and the fold
// is 5-55x larger than the placed set. So neither end works, and what the data dictates is
// selection-by-reference: the seat names ids, the driver copies the fields, the seat judges the tier.
//
// Run:  node --test driver/test/placement-form.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSelectionIndex, buildPlacementForm, renderPlacementsJson, omittedFromRender,
  selectionOf, formRowKey, rowIsSettled } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { parsePlacementsJson } from "../placement-model.mjs";

// A Madrid-shaped family (one right, three records, three territories) plus a floor record no position
// covers — the two shapes the resolution index has to tell apart.
const INPUT = {
  positions: [{ mark_text: "NOVAPULSE", owners: ["Acme SA"], owner_strings: ["Acme S.A."],
    records: ["/mark/us/U1", "/mark/eu/E1", "/mark/ch/C1"], classes: ["9"], territories: ["US", "EU", "CH"] }],
  floors: [{ record_id: "/mark/us/U1", mark_text: "NOVAPULSE", owner_name: "Acme SA", classes: ["9"] },
           { record_id: "/mark/jp/J9", mark_text: "NOVAPULSAR", owner_name: "Beta KK", classes: ["9"] }],
};
const SEAT_ROW = { kind: "seat", mark: "Novapulse Labs", owner: "Novapulse Labs LLC", jurisdiction: "US",
  records: [], tier: "watchlist-annex", reason: "unregistered marketplace use, no register leg" };

test("#562 the form the seat opens has NO pre-written rows — a row exists because it was selected", () => {
  const form = buildPlacementForm(INPUT);
  assert.deepEqual(form.rows, [],
    "3,489 driver rows for 82 placements is not a form — and with nothing pre-written there is no such "
    + "thing as a pre-written row left untiered, which is the issue's second question dissolving");
  assert.ok(form.select_row_contract && form.seat_row_contract, "both contracts ride as DATA on every pass");
  assert.equal(form.generated_from.selectable_records, 4, "US/EU/CH from the position + the uncovered JP floor");
});

test("#562 selecting ONE record of a family selects the family, and the driver fills every field", () => {
  const u = unionPlacementForm(null, [{ select: "/mark/eu/E1", tier: "headline-candidate", reason: "identical mark, same class" }], INPUT);
  assert.equal(u.total, 1, "three records, one candidate — the unit a tier decision is actually about");
  const row = u.form.rows[0];
  assert.equal(row.mark, "NOVAPULSE");
  assert.equal(row.owner, "Acme SA");
  assert.deepEqual(row.records, ["/mark/ch/C1", "/mark/eu/E1", "/mark/us/U1"]);
  assert.equal(row.jurisdiction, "US, EU, CH");
  assert.equal(u.settled, 1);
});

test("#562 a selected row's driver fields are MACHINE-COPIED — what the seat types in them is ignored", () => {
  // The point of selection-by-reference. A transcription slip on a mark or an owner cannot reach a client
  // deliverable, because the seat's copy of those fields is never read.
  const u = unionPlacementForm(null, [{ select: "/mark/eu/E1", mark: "NOVAPULZE", owner: "Acme Limited",
    records: ["/mark/xx/INVENTED"], tier: "headline-candidate", reason: "identical mark" }], INPUT);
  const row = u.form.rows[0];
  assert.equal(row.mark, "NOVAPULSE", "the register's own mark text, not the seat's retyping of it");
  assert.equal(row.owner, "Acme SA");
  assert.ok(!row.records.includes("/mark/xx/INVENTED"), "and it cannot widen what the row binds");
});

test("#562 THE CURE: a tier placed by an attempt that is then killed survives the next attempt's silence", () => {
  // This is the R1 incident, in miniature. Attempt 1 tiers one candidate and selects a second; the wall
  // kills it. Attempt 2 is a cold re-dispatch that submits NOTHING.
  const att1 = [{ select: "/mark/eu/E1", tier: "headline-candidate", reason: "identical mark, same class" },
                { select: "/mark/jp/J9", tier: null, reason: null },
                SEAT_ROW];
  const u1 = unionPlacementForm(null, att1, INPUT);
  assert.equal(u1.settled, 2, "one register tier + the seat row");
  assert.equal(u1.carried, 0, "nothing carried yet — this attempt did the work");

  const u2 = unionPlacementForm(u1.form, null, INPUT);
  assert.equal(u2.settled, 2, "the kill destroyed nothing");
  assert.equal(u2.carried, 1, "and `carried` counts exactly what a cold re-dispatch used to throw away");
  assert.equal(renderPlacementsJson(u2.form).placements.length, 2, "the deliverable already holds them");
});

test("#562 a selection is STICKY — silence cannot un-place a candidate, but a later pass can re-tier it", () => {
  const u1 = unionPlacementForm(null, [{ select: "/mark/eu/E1", tier: "headline-candidate", reason: "identical mark" }, SEAT_ROW], INPUT);
  // A corrective pass that mentions ONE row and says nothing about the others.
  const u2 = unionPlacementForm(u1.form, [{ select: "/mark/eu/E1", tier: "watchlist-annex", reason: "re-tiered on the fetched record" }], INPUT);
  assert.equal(u2.form.rows[0].tier, "watchlist-annex", "the seat can correct itself — a submitted row the gate accepts wins");
  assert.ok(u2.form.rows.some((r) => r.kind === "seat"),
    "and the common-law rows it did not mention are STILL THERE. #476 retracted seat rows by silence "
    + "because that seat rewrote its whole form every pass; this one writes deltas, so silence-retraction "
    + "would delete a run's 5-11 common-law candidates without a word");
});

test("#562 removal is EXPLICIT, and it is the only way a row leaves the form", () => {
  const u1 = unionPlacementForm(null, [{ select: "/mark/eu/E1", tier: "headline-candidate", reason: "identical mark" }, SEAT_ROW], INPUT);
  const seatId = u1.form.rows.find((r) => r.kind === "seat").row_id;
  const u2 = unionPlacementForm(u1.form, [{ retract: seatId }], INPUT);
  assert.ok(!u2.form.rows.some((r) => r.kind === "seat"), "the named row is gone");
  assert.equal(u2.total, 1, "and nothing else moved");
  // The wrong-row-on-attempt-1 case silence-retraction existed to answer is still answerable.
  const u3 = unionPlacementForm(u2.form, [{ retract: "/mark/eu/E1" }], INPUT);
  assert.equal(u3.total, 0, "a selection is retractable by the id it was selected with");
});

test("#562 a selection the fold does not hold is REPORTED BY ID, never silently dropped", () => {
  const u = unionPlacementForm(null, [{ select: "/mark/xx/NOPE", tier: "watchlist-annex", reason: "typo" }], INPUT);
  assert.equal(u.unresolved, 1);
  assert.deepEqual(u.form.unresolved, [{ select: "/mark/xx/NOPE", tier: "watchlist-annex" }]);
  assert.equal(u.total, 0, "and it mints no row — an id that resolves to nothing has no candidate behind it");
});

test("#562 an untiered selected row is COUNTED, not merely omitted", () => {
  // `renderPlacementsJson` drops unsettled rows, which alone is the silent-vanish the issue named. The
  // count is the other half — and it is deliberately NOT a key on placements.json, whose shape is a
  // contract four consumers read (397 archived entries carry exactly the same seven keys).
  const u = unionPlacementForm(null, [{ select: "/mark/jp/J9", tier: null, reason: null }], INPUT);
  assert.equal(renderPlacementsJson(u.form).placements.length, 0);
  const omitted = omittedFromRender(u.form);
  assert.equal(omitted.length, 1);
  assert.equal(omitted[0].select, "/mark/jp/J9");
  assert.deepEqual(omitted[0].missing, ["tier", "reason"], "and it says WHAT is missing, not just that something is");
});

test("#562 the rendered file is byte-shaped exactly like the seat-written ones it replaces", () => {
  // The parity that protects the deliverable. Across 397 entries in the archived runs the keys are
  // {mark, owner, jurisdiction, records, tier, reason} + optional borderline, in a {schema_version,
  // placements} document. A render that dropped or added one would change what reaches the digest,
  // synthesis, the report cards and placement-carry.
  const u = unionPlacementForm(null, [
    { select: "/mark/eu/E1", tier: "headline-candidate", reason: "identical mark, same class", borderline: true },
    SEAT_ROW], INPUT);
  const doc = renderPlacementsJson(u.form);
  assert.deepEqual(Object.keys(doc), ["schema_version", "placements"]);
  parsePlacementsJson(JSON.stringify(doc));   // the gate's own strict parser, which rejects unknown keys
  assert.deepEqual(Object.keys(doc.placements[0]), ["mark", "owner", "jurisdiction", "records", "tier", "reason", "borderline"]);
  assert.deepEqual(Object.keys(doc.placements[1]), ["mark", "owner", "jurisdiction", "records", "tier", "reason"],
    "borderline is emitted ONLY when declared — absent means not borderline, as 366 of 397 archived entries have it");
  assert.deepEqual(doc.placements[1].records, [], "a common-law candidate carries an empty list, and that is correct");
});

test("#562 a torn or unreadable submission says NOTHING — it can neither add a judgment nor destroy one", () => {
  const u1 = unionPlacementForm(null, [{ select: "/mark/eu/E1", tier: "headline-candidate", reason: "identical mark" }, SEAT_ROW], INPUT);
  for (const torn of [null, undefined, { rows: null }]) {
    const u2 = unionPlacementForm(u1.form, torn, INPUT);
    assert.equal(u2.total, 2, `a submission of ${JSON.stringify(torn)} carries the prior form forward whole`);
    assert.equal(u2.settled, 2);
  }
});

test("#562 a candidate whose records CHANGE is a different row — no invalidation logic, no trigger-sniffing", () => {
  // A row's identity is its record set. After a re-enumeration splits the family, the selection resolves
  // to a smaller position, which is a new key, so it arrives unsettled with no carry — automatically.
  const u1 = unionPlacementForm(null, [{ select: "/mark/eu/E1", tier: "headline-candidate", reason: "identical mark" }], INPUT);
  const SPLIT = { ...INPUT, positions: [{ ...INPUT.positions[0], records: ["/mark/eu/E1"], territories: ["EU"] }] };
  const u2 = unionPlacementForm(u1.form, null, SPLIT);
  assert.notEqual(formRowKey(u2.form.rows[0]), formRowKey(u1.form.rows[0]), "different record set, different row");
  assert.equal(u2.settled, 0, "the tier does not silently transfer to a candidate that is not the one it judged");
  assert.ok(!rowIsSettled(u2.form.rows[0], u2.form.rows[0]));
});

test("#562 selectionOf falls back to a named record, so a seat row naming a fold record FOLDS rather than duplicating", () => {
  assert.equal(selectionOf({ select: " /mark/us/U1 " }), "/mark/us/U1");
  assert.equal(selectionOf({ records: ["/mark/us/U1"] }), "/mark/us/U1");
  assert.equal(selectionOf({ mark: "X" }), null);
  // A seat-authored row that names a record the fold holds is talking about the driver's candidate. It
  // must not become a second entry for the same right in a file a lawyer reads.
  const u = unionPlacementForm(null, [{ kind: "seat", mark: "NOVAPULSE", owner: "Acme SA", jurisdiction: "US",
    records: ["/mark/us/U1"], tier: "sheet-2", reason: "same right, written as a seat row" }], INPUT);
  assert.equal(u.total, 1);
  assert.equal(u.form.rows[0].kind, "register", "folded onto the register candidate it names");
  assert.equal(u.form.rows[0].tier, "sheet-2", "and its judgment survived the fold");
});

test("#562 a projection that could not be read is RECORDED, never read as an empty band", () => {
  const blind = buildSelectionIndex({ floors: null, positions: null });
  assert.equal(blind.derived_from.floors_unreadable, true);
  assert.equal(blind.derived_from.positions_unreadable, true);
  assert.equal(blind.derived_from.selectable_records, 0);
  assert.equal(blind.resolve("/mark/us/U1"), null, "and nothing resolves, so nothing is invented");
});

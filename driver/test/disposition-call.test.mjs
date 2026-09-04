// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// B — THE TYPED TRANSPORT. What the seat can no longer do wrong, asserted as impossibility rather than
// as detection wherever the design claims impossibility.
//
// The class being removed: a model hand-typed a 140 KB JSON document, one row's delimiters were
// typographic quotes, and 74 correct rulings were voided by a quote character. Nothing in this file
// parses a document the seat wrote, because under this transport the seat writes no document.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDispositionCall, callAnswer, MAX_ROWS_PER_CALL, CEREMONY_BUDGET_CALLS, ceremonyCallsFor,
  CALL_REFUSALS, RETIRED_CALL_REFUSALS, CALL_ROW_FIELDS,
} from "../disposition-call.mjs";
import { obligationRows, connotationObligations , MEANING_SEAT_FIELDS } from "../connotation-search.mjs";

// Real shape: a two-candidate query row (a choice to make) and a spot-checked one (an anchor owed).
const SNIPPET = "The 1871 Meridian race riot was a violent episode recorded in contemporary newspapers.";
const RECORDED = [
  { query: "a meaning query", results: [
    { id: "R-AAAA1111", title: "first", url: "https://e.test/1", snippet: SNIPPET },
    { id: "R-BBBB2222", title: "second", url: "https://e.test/2", snippet: "y".repeat(240) }] },
  { query: "a second meaning query", results: [
    { id: "R-CCCC3333", title: "only", url: "https://e.test/3", snippet: "z".repeat(240) }] },
];
const rows = () => obligationRows(connotationObligations(RECORDED));
// THE RECEIPT IDS ARE THE DRIVER'S OWN, minted from the result — they are NOT the ledger's `id`. That is
// the whole of decision 2 stated as a fact about the data: there is no identifier in the seat's world to
// type, so the tests read every id off the canonical row rather than hardcoding one.
const idOf = (rowIdx, candIdx) => rows()[rowIdx].candidates[candIdx].receipt_id;
// Both fixture rows carry usable snippets, so both are spot-checked and owe a POINTER and a PROOF —
// the realistic case, and the field the old transport lost every time.
//
// — `anchor` became `segment_index` + `fragment`. One string was doing two jobs with incompatible
// requirements: long enough to pin an extraction span by exact match, short enough to be copied right.
// The locator duty is what made it unsatisfiable in CJK. These tests moved with the shape rather than
// being deleted, because what each was DEFENDING mostly still needs defending.
const FRAGMENT = "1871 Meridian";
const ok = (over = {}) => ({ row_index: 1, ruling: "benign", note: "a dictionary entry, nothing charged", receipt_index: 1, segment_index: 1, fragment: FRAGMENT, ...over });

test("the happy path: the driver resolves the position to an id the seat never typed", () => {
  const r = validateDispositionCall([ok()], RECORDED);
  assert.deepEqual(r.refused, []);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].receipt_id, idOf(0, 0),
    "the id comes off the DRIVER's candidate, never off the seat's bytes");
});

test("IMPOSSIBLE, NOT REJECTED: a typed identifier is refused BY NAME", () => {
  // One run wrote the literal `R-RECEIPT` into 27 rows because a prompt had displayed the token's shape.
  // A schema that cannot express an id removes that class; a validator that catches it only moves it.
  const r = validateDispositionCall([ok({ receipt_id: "R-RECEIPT" })], RECORDED);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.refused[0].reason, "identifier_supplied");
  assert.match(r.refused[0].detail, /POSITION/,
    "and the refusal says what to do instead — a refusal that only says no is the R6 shape");
});

test("…and it is refused rather than IGNORED, which would be a confident wrong answer", () => {
  // Silently dropping the field would let a seat believe it had cited a receipt while the row bound to
  // whatever the position said. That is the failure mode of the entire week, in miniature.
  const r = validateDispositionCall([ok({ receipt_id: idOf(0, 1), receipt_index: 1 })], RECORDED);
  assert.equal(r.accepted.length, 0, "a row naming an id must not quietly bind to something else");
});

test("A TEMPLATE CONSTANT CANNOT SATISFY A PER-ROW VALUE — checked against THAT row", () => {
  const [q, sole] = rows();
  const r = validateDispositionCall([
    { row_index: 1, ruling: "benign", note: "n", receipt_index: 99 },
    { row_index: 2, ruling: "benign", note: "n", receipt_index: 99 },
  ], RECORDED);
  assert.equal(r.accepted.length, 0);
  assert.deepEqual(r.refused.map((x) => x.reason), ["position_invalid", "position_invalid"]);
  assert.match(r.refused[0].detail, /own candidate list/);
});

test("PARTIAL ACCEPT: one bad row does not void its neighbours", () => {
  // The old transport's whole disease: one row's quote character voided 73 good ones. Anything that
  // re-creates all-or-nothing here has re-created the bug in a new place.
  const [q, sole] = rows();
  const r = validateDispositionCall([
    { row_index: 1, ruling: "benign", note: "good", receipt_index: 1, segment_index: 1, fragment: FRAGMENT },
    { row_index: 2, ruling: "nonsense", note: "bad" },
  ], RECORDED);
  assert.equal(r.accepted.length, 1, "the good row is RECORDED");
  assert.equal(r.refused.length, 1);
  assert.equal(r.refused[0].reason, "ruling_invalid");
});

test("a spot-checked row's POINTER AND PROOF are resolved at CALL time, against that row's captured text", () => {
  const q = rows()[0];
  const spot = { ...q, quote_required: true };
  const recorded = RECORDED;
  // Bound: a fragment copied out of the snippet the driver captured.
  const good = validateDispositionCall([{ row_index: 1, ruling: "loaded", note: "n", receipt_index: 1, segment_index: 1, fragment: "1871 Meridian" }], recorded);
  assert.deepEqual(good.refused, [], "a fragment that occurs in the pointed passage of the row's own snippet binds");
  // THE ANCHOR RESOLVES TO A QUOTE, like the position resolves to an id. The union does not persist
  // `anchor` — it points into a candidate list regenerated every pass — so carrying one would hand the
  // accumulator a field it drops, and the row would read as unquoted on the next regeneration.
  assert.equal(good.accepted[0].anchor, undefined, "`anchor` must not be carried; it does not survive the union");
  // Same rule, same reason, for both replacements: a POINTER into a list the driver regenerates every
  // pass cannot be persisted — only the extracted text is durable. The proof is not carried either: it
  // has done its job at the door and means nothing afterwards.
  assert.equal(good.accepted[0].segment_index, undefined, "`segment_index` points into a regenerated list; persisting it is the fixed-point defect resolveCandidate's comment describes");
  assert.equal(good.accepted[0].fragment, undefined, "`fragment` proves reading at CALL time and is not evidence afterwards");
  assert.ok(good.accepted[0].quote, "the DRIVER's extract is what survives, and it is the whole point of the exchange");
  assert.ok(good.accepted[0].quote, "the DRIVER's extract is what is durable");
  assert.match(good.accepted[0].quote, /Meridian race riot/, "and it is copied out of the RAW snippet");
  assert.ok(spot.quote_required, "premise held");
});

test("a one-candidate row asks for no position — there is nothing to choose", () => {
  const sole = rows()[1];
  // Its own snippet, so its own anchor — every per-row value is checked against THAT row.
  const r = validateDispositionCall([{ row_index: 2, ruling: "off-topic", note: "n", segment_index: 1, fragment: "zzzzzzzzzz" }], RECORDED);
  assert.deepEqual(r.refused, [], "ceremony over a decision that does not exist is how a tool gets routed around");
  assert.equal(r.accepted[0].receipt_id, idOf(1, 0));
});

test("a row the driver never owed is refused — the obligation set is the driver's", () => {
  const r = validateDispositionCall([ok({ row_index: 99 })], RECORDED);
  assert.equal(r.refused[0].reason, "row_position_invalid");
  assert.match(r.refused[0].detail, /numbered 1 to 2/, "the refusal states the range, so the remedy is countable");
});

// ── — THE ADDRESS IS A POSITION, AND AN ID IS REFUSED WITH THE POSITION ATTACHED ─────────────
//
// The issue this replaces reads "the seat invents its own row ids". It was never given any: the block
// printed none, the sidecar it named lists query strings, and the block's own header says "YOU CITE NO
// IDENTIFIER ANYWHERE". The seat sent the one per-row label it had been shown — the query text.
test("#1173 a typed row id is refused BY NAME, never ignored", () => {
  const r = validateDispositionCall([ok({ row_id: rows()[0].row_id })], RECORDED);
  assert.equal(r.accepted.length, 0, "a row that names an id must not quietly bind");
  assert.equal(r.refused[0].reason, "row_addressed_by_id");
});

test("#1173 the refusal for a QUERY STRING names the number that query is — one round trip, not a hunt", () => {
  // The exact observed payload: 27 distinct query strings sent where a row id belonged, all refused
  // `unknown_row` with a detail that said only what the value was NOT. The seat could not act on that,
  // because nothing it had ever read carried a row id to send instead.
  const r = validateDispositionCall([ok({ row_id: "a second meaning query", row_index: undefined })], RECORDED);
  assert.equal(r.refused[0].reason, "row_addressed_by_id");
  assert.match(r.refused[0].detail, /that is row 2 in the obligations list/i,
    "the remedy must name the number, or the seat is one refusal wiser and no closer");
});

test("#1173 a row with no address at all is refused for the address, not for something downstream", () => {
  const r = validateDispositionCall([ok({ row_index: undefined })], RECORDED);
  assert.equal(r.refused[0].reason, "row_position_absent");
});

test("#1173 the numbers are the ones the seat was SHOWN, not the ones we would mint now", () => {
  // A ledger that grows mid-turn re-derives the obligation set. If the addressing list were re-derived
  // with it, a row inserted ahead of another would slide every number after it, and the seat — counting
  // off the page in front of it — would address row 2 and bind row 1. A wrong id is refused; a wrong
  // NUMBER is accepted, which is why this is pinned rather than left to the order coming out the same.
  const canonical = rows();
  const told = ["Q-NOTINTHISRUN", ...canonical.map((r) => r.row_id)];
  const r = validateDispositionCall([{ row_index: 2, ruling: "benign", note: "n", receipt_index: 1, segment_index: 1, fragment: FRAGMENT }], RECORDED, { told });
  assert.deepEqual(r.refused, [], "row 2 of the TOLD list is the first canonical row, and it binds");
  assert.equal(r.accepted[0].receipt_id, idOf(0, 0));

  // The hole is a hole. Address it and you are told so, rather than being handed the row that slid up.
  const hole = validateDispositionCall([{ row_index: 1, ruling: "benign", note: "n", receipt_index: 1 }], RECORDED, { told });
  assert.equal(hole.refused[0].reason, "row_position_invalid");
  assert.match(hole.refused[0].detail, /no longer owed/);
});

test("the same row twice in one call is refused rather than guessed at", () => {
  const r = validateDispositionCall([ok(), ok({ note: "a different answer" })], RECORDED);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.refused[0].reason, "duplicate_row");
});

test("THE CEREMONY BUDGET, pre-registered: 74 rows in at most four calls", () => {
  // Written down before the tool existed so "ergonomic" is a measurement. 17 of 23 recorded runs already
  // route around the old transport by writing a generator program; a tedious replacement gets routed
  // around too, and by this design's own argument that is a correctness failure, not a UX one.
  assert.ok(ceremonyCallsFor(74) <= CEREMONY_BUDGET_CALLS,
    `74 rows need ${ceremonyCallsFor(74)} calls at ${MAX_ROWS_PER_CALL}/call; the budget is ${CEREMONY_BUDGET_CALLS}`);
  assert.equal(ceremonyCallsFor(74), 3);
  assert.equal(ceremonyCallsFor(0), 0, "a half owing nothing owes no calls");
});

test("rows past the per-call limit are OVERFLOW, never silently dropped", () => {
  const many = Array.from({ length: MAX_ROWS_PER_CALL + 3 }, () => ok());
  const r = validateDispositionCall(many, RECORDED);
  assert.equal(r.overflow.length, 3, "a truncation nobody is told about is an absence reading as a pass");
  assert.equal(r.accepted.length + r.refused.length, MAX_ROWS_PER_CALL);
});

test("the answer states what is OUTSTANDING — the seat never has to guess whether it is finished", () => {
  // "I thought I was done" is the state behind every form_untouched in the record.
  const done = callAnswer({ accepted: [{}], refused: [], overflow: [] }, []);
  assert.match(done, /Nothing is outstanding/);
  const left = callAnswer({ accepted: [{}], refused: [], overflow: [] }, [{ row_index: 1 }, { row_index: 2 }]);
  assert.match(left, /2 obligations still outstanding/);
  assert.match(left, /row 1/, "#1173 — the answer names rows the way the page numbers them, not by an id nobody was shown");
});

test("a refusal answer keeps the accepted rows visible, so nothing reads as a total loss", () => {
  const a = callAnswer({ accepted: [{}, {}], refused: [{ row_index: "1", detail: "do this instead" }], overflow: [] }, [{ row_index: 1 }]);
  assert.match(a, /Recorded 2 rows/);
  assert.match(a, /the rest of this call was KEPT/);
  assert.match(a, /do this instead/);
});

test("PAIRWISE DISTINCT: no two refusals can be satisfied by the same remedy", () => {
  // Asserted, not left to discipline. This whole issue is what happens when two states share one
  // message: `connotation_form_damaged` carried two unrelated faults, and its corrective sent a seat
  // whose JSON had broken to go and fix a receipt id.
  const [q, sole] = rows();
  const cases = [
    ["row_position_invalid", ok({ row_index: 99 })],
    ["row_position_absent", ok({ row_index: undefined })],
    ["row_addressed_by_id", ok({ row_id: "Q-NOTAROW1" })],
    ["ruling_invalid", ok({ ruling: "maybe" })],
    ["note_absent", ok({ note: "  " })],
    ["identifier_supplied", ok({ receipt_id: "R-RECEIPT" })],
    ["position_invalid", ok({ receipt_index: 99 })],
    ["position_absent", { row_index: 1, ruling: "benign", note: "n" }],
  ];
  const details = new Map();
  for (const [expected, payload] of cases) {
    const r = validateDispositionCall([payload], RECORDED);
    assert.equal(r.refused[0]?.reason, expected, `${expected} must be reachable, or this asserts nothing`);
    details.set(expected, r.refused[0].detail);
  }
  const seen = new Set();
  for (const [reason, detail] of details) {
    assert.ok(!seen.has(detail), `${reason} shares its remedy text with another refusal`);
    seen.add(detail);
  }
  assert.ok(q.row_id && sole.row_id, "premise held: two canonical rows, addressed 1 and 2");
});

test("every refusal the code can emit is in the declared vocabulary", () => {
  // The lesson from `CONNOTATION_REASONS`: a reason that exists in the code and not in the exported list
  // is invisible to every routing site, and nothing fails to say so.
  const src = CALL_REFUSALS;
  for (const r of ["row_position_absent", "row_position_invalid", "row_addressed_by_id",
    "duplicate_row", "ruling_invalid", "note_absent", "identifier_supplied",
    "position_invalid", "position_absent",
    // — the pointer tokens that replaced the anchor's three. retired the three `fragment_*`
    // members: the pointer binds and a fragment is recorded rather than required, so no live path emits
    // them. They are asserted RETIRED below instead of declared here.
    "segment_absent", "segment_invalid", "segment_dead_end"])
    assert.ok(src.includes(r), `${r} is emitted and undeclared`);
  // The other direction, which is the half that rots: a token nothing can emit must not sit in the live
  // vocabulary, or a routing site keeps a branch for a state that never arrives.
  for (const gone of ["fragment_absent", "fragment_too_short", "fragment_unbound"])
    assert.ok(!src.includes(gone), `${gone} is declared live and #1172 retired it`);
});

test("#1098: the anchor tokens are RETIRED, not deleted — an old ledger must stay readable", () => {
  // A vocabulary change that drops names makes two corpora incomparable, and the comparison is the only
  // evidence this cure worked: `anchor_unbound` was 162 of 170 refusals on R5, and what `fragment_unbound`
  // does on the next CJK round is the measurement. A token in neither list reads as corruption.
  for (const r of ["anchor_absent", "anchor_unbound", "anchor_foreign"]) {
    assert.ok(RETIRED_CALL_REFUSALS.includes(r), `${r} must stay resolvable for readers of archived ledgers`);
    assert.ok(!CALL_REFUSALS.includes(r), `${r} is retired and must not be emitted by live code`);
  }
  // And the two lists are disjoint, or a reader cannot tell live from historical.
  assert.deepEqual(CALL_REFUSALS.filter((r) => RETIRED_CALL_REFUSALS.includes(r)), []);
});

test("a malformed payload is REFUSED, never thrown — an exception tells the seat nothing", () => {
  for (const bad of [null, undefined, "not an array", 7, [null], [{}]]) {
    const r = validateDispositionCall(bad, RECORDED);
    assert.ok(Array.isArray(r.accepted) && Array.isArray(r.refused), `threw or misshaped on ${JSON.stringify(bad)}`);
  }
});

// ── THE EVIDENCE MUST COME FROM THE RECEIPT THAT WAS RULED ON ───────────────────────────────────────
//
// Found reviewing this file AFTER it reached main (see 's comment): `anchorBinding` was called with
// the whole row's candidate list, so a bound quote could be lifted out of a receipt the seat had not
// ruled on. The accepted row then said "receipt X, and here is the passage proving it" over text from
// receipt Y — that week's defect shape exactly, inside the module built to end it.
//
// CHANGES THE STATUS OF THAT BUG FROM CAUGHT TO UNREACHABLE. `segmentBinding` is handed the ONE
// candidate `resolveCandidate` already bound, so there is no wider list to stray into. The tests below
// are kept and rewritten rather than deleted: the property still has to hold, and a property that now
// holds by construction still needs an assertion, or the next refactor quietly reintroduces the search.

test("evidence lifted from a DIFFERENT receipt CANNOT REACH the record — the quote is the ruled receipt's", () => {
  // FRAGMENT's text lives only in candidate 1's snippet; the seat rules on candidate 2.
  // — THE HAZARD IS NOW STRUCTURAL, NOT REFUSED, AND THAT IS STRONGER. The row binds on the
  // pointer, and the quote is extracted from the RULED candidate's snippet because `segmentBinding` is
  // only ever handed that one candidate. So a quote from a receipt the seat did not rule on cannot be
  // produced at all — it is not caught after the fact, it has no route in.
  //
  // The arm's own sentence is what is being kept: "an accepted row must never carry a quote from a
  // receipt it did not rule on." It is now asserted directly, over the accepted row, instead of
  // indirectly via a refusal.
  const r = validateDispositionCall([ok({ receipt_index: 2, fragment: FRAGMENT })], RECORDED);
  assert.equal(r.refused.length, 0, "a foreign fragment must not cost the seat a call — #1172");
  assert.equal(r.accepted.length, 1);
  const ruled = obligationRows(connotationObligations(RECORDED))[0].candidates[1];
  assert.equal(r.accepted[0].receipt_id, ruled.receipt_id, "the row bound to a receipt it did not rule on");
  assert.ok(ruled.snippet.includes(r.accepted[0].quote.slice(0, 24)),
    "an accepted row carried a quote from a receipt it did not rule on — the structural guarantee is gone");
  assert.equal(r.accepted[0].fragment_state, "unbound",
    "the foreign fragment was not recorded — the signal must survive the duty");
});

test("`anchor_foreign` is now UNREACHABLE, not merely refused", () => {
  // The old pair existed because the anchor was searched row-wide: one refusal said "wrong receipt", the
  // other "no such text anywhere", and collapsing them would have sent a seat that mis-indexed off hunting
  // a transcription error it never made. Both now resolve to the same state BECAUSE the wider search is
  // gone — the distinction was a consequence of the defect, not a requirement of the design.
  // — both are now the SAME NON-EVENT. `anchor_foreign` was unreachable under because the
  // row-wide search was gone; under its successor is unreachable too, because nothing about the
  // fragment refuses. What still matters, and is what this arm now pins, is that the two cases remain
  // INDISTINGUISHABLE in outcome — a seat that mis-indexed and a seat that mistyped are not sent down
  // different paths, which is the confusion the original pair caused.
  const foreign = validateDispositionCall([ok({ receipt_index: 2, fragment: FRAGMENT })], RECORDED);
  const nowhere = validateDispositionCall([ok({ receipt_index: 2, fragment: "wording that appears in no snippet at all" })], RECORDED);
  assert.deepEqual(foreign.refused, []);
  assert.deepEqual(nowhere.refused, []);
  assert.equal(foreign.accepted[0].fragment_state, "unbound");
  assert.equal(nowhere.accepted[0].fragment_state, "unbound");
  assert.equal(foreign.accepted[0].receipt_id, nowhere.accepted[0].receipt_id,
    "the two cases bound to different receipts — the ruled candidate decides the row, not the fragment");
});

test("text present in BOTH receipts still binds — the check must not refuse honest work", () => {
  // KEPT DELIBERATELY, AND IT NOW PASSES TRIVIALLY. That is the reason to keep it, not to delete it: it
  // is the positive control that the check does not refuse correct work. A suite that only asserts what
  // gets REFUSED is satisfied by a function that refuses everything.
  const shared = "identical wording carried by both of these results in the captured text";
  const rec = [{ query: "a meaning query", results: [
    { id: "R-AAAA1111", title: "first", url: "https://e.test/1", snippet: `alpha ${shared} omega` },
    { id: "R-BBBB2222", title: "second", url: "https://e.test/2", snippet: `beta ${shared} zeta` }] }];
  const row = obligationRows(connotationObligations(rec))[0];
  assert.ok(row, "premise held: the fixture mints one obligation row, addressed 1");
  const r = validateDispositionCall([{ row_index: 1, ruling: "benign", note: "n", receipt_index: 2, segment_index: 1, fragment: shared }], rec);
  assert.deepEqual(r.refused, [], "the fragment occurs in the pointed passage of the ruled receipt, so it binds");
  assert.equal(r.accepted[0].receipt_id, row.candidates[1].receipt_id, "and it binds to the receipt the seat RULED on");
});

test("VOID CONTROL: the fixture's fragment really is foreign to candidate 2", () => {
  // Every assertion above rests on FRAGMENT living in candidate 1 and not candidate 2. If the fixture ever
  // drifted so that both snippets carried it, the refusal tests would pass by finding nothing to refuse.
  const row = rows()[0];
  assert.ok(row.candidates[0].snippet.includes(FRAGMENT), "candidate 1 must carry the fragment text");
  assert.ok(!row.candidates[1].snippet.includes(FRAGMENT), "candidate 2 must NOT — otherwise these tests measure nothing");
  // — and the pointer needs a list to point into: a candidate whose snippet segments to nothing
  // would make every assertion here vacuous for a reason that has nothing to do with fragments.
  assert.ok(row.candidates.every((c) => c.segments.length >= 1), "every fixture candidate must expose at least one numbered passage");
});

test("CALL_ROW_FIELDS is row_index plus the seat's own fields — bound, never retyped", () => {
  assert.deepEqual([...CALL_ROW_FIELDS], ["row_index", ...MEANING_SEAT_FIELDS],
    "the literal the vocabulary sweep reads must equal the derivation the seat is asked for");
});

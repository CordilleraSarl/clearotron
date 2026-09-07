// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// M1 — the seat names a candidate by POSITION and code resolves the position to the id.
//
// Two properties are load-bearing and neither has a natural witness, so both are planted here:
//
//   1. THE SOLE-CANDIDATE PRE-BIND FIRES AT EXACTLY ONE CANDIDATE AND NEVER AS A TIEBREAK. A version
//      that fell back to `candidates[0]` whenever nothing else bound would invent a ruling on precisely
//      the rows where the seat was least sure, and every test that only ever checks one-candidate rows
//      would pass. So a TWO-candidate row is planted at all three sites that instantiate the rule.
//   2. AN ORDINAL NEVER REACHES THE ACCUMULATOR. `2` means a different receipt on any regeneration whose
//      candidate order moved, and formRowFinder's own doc block records what a foreign receipt in the
//      accumulator costs: the row becomes a permanent fixed point and the ladder runs out. The union is
//      therefore checked for the resolved ID, not merely for "something bound".
//
// The three sites are obligationRows (writes the pre-fill), seatTouched via connotationAuditCounts (must
// not read the driver's own pre-fill as a seat edit) and unionDispositionForm (carries it). They were one
// rule wearing a `kind === "recurrence"` condition; M1 dropped the condition, so a test that exercises
// only recurrence rows can no longer tell whether the rule is right.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { resolveCandidate, isRuled, obligationRows, meaningSweepReceiptsInstruction }
  from "../connotation-search.mjs";
import { unionDispositionForm } from "../disposition-union.mjs";
import { trackedFiles as trackedCorpus, skipReason } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const row = (id, cands) => ({ row_id: id, kind: "query", query: `q-${id}`, candidates: cands, quote_required: false });
const cand = (id) => ({ receipt_id: id, title: `t-${id}`, url: `https://example.invalid/${id}`, snippet: "" });
const ruled = (extra) => ({ ruling: "benign", note: "a line of reasoning", ...extra });

// ── resolveCandidate ────────────────────────────────────────────────────────────────────────────────

test("#850 M1 a 1-based index resolves to that candidate's id", () => {
  const c = row("Q1", [cand("R-AAA"), cand("R-BBB"), cand("R-CCC")]);
  assert.deepEqual(resolveCandidate({ receipt_index: 2 }, c), { id: "R-BBB", from: "index", state: "bound" });
  assert.equal(resolveCandidate({ receipt_index: "1" }, c).id, "R-AAA", "a digit STRING is an ordinal too");
  assert.equal(resolveCandidate({ receipt_index: 3 }, c).id, "R-CCC");
});

test("#850 M1 the index is 1-BASED — 0 is not the first candidate, it is out of range", () => {
  // Off-by-one here would silently mean "the seat ruled on the wrong receipt", which no downstream check
  // can see: every id involved is a real id on a real row.
  const c = row("Q1", [cand("R-AAA"), cand("R-BBB")]);
  assert.equal(resolveCandidate({ receipt_index: 0 }, c).state, "out_of_range");
  assert.equal(resolveCandidate({ receipt_index: 3 }, c).state, "out_of_range");
});

test("#850 M1 a non-integer is not an ordinal — it does not become one", () => {
  const c = row("Q1", [cand("R-AAA"), cand("R-BBB")]);
  for (const junk of ["2.5", "2px", " ", "two", "-1", "1e0"]) {
    assert.equal(resolveCandidate({ receipt_index: junk }, c).id, "",
      `${JSON.stringify(junk)} must not resolve — Number() would take several of these`);
  }
});

test("#850 M1 REPLAY: an archived form carries ids and no indices, and still binds", () => {
  // Every form written before this change names ids. A resolution that took only indices would re-open
  // every discharged row on every historical run — the whole archive, silently, as "outstanding".
  const c = row("Q1", [cand("R-AAA"), cand("R-BBB")]);
  assert.deepEqual(resolveCandidate({ receipt_id: "R-BBB" }, c), { id: "R-BBB", from: "id", state: "bound" });
  assert.ok(isRuled(ruled({ receipt_id: "R-BBB" }), c), "and the archived row is still RULED");
});

test("#850 M1 a bad ordinal does not destroy a good id sitting beside it", () => {
  const c = row("Q1", [cand("R-AAA"), cand("R-BBB")]);
  assert.equal(resolveCandidate({ receipt_index: 9, receipt_id: "R-AAA" }, c).from, "id");
});

test("#850 M1 an id that is not on THIS row's candidate list does not bind", () => {
  // The failure and were both about: a ruling citing a receipt from another row.
  const c = row("Q1", [cand("R-AAA")]);
  const other = row("Q2", [cand("R-ZZZ"), cand("R-YYY")]);
  assert.equal(resolveCandidate({ receipt_id: "R-ZZZ" }, other).state, "bound");
  assert.equal(resolveCandidate({ receipt_id: "R-NOPE" }, other).state, "unknown_id");
  assert.equal(resolveCandidate({ receipt_id: "R-ZZZ" }, c).state, "unknown_id",
    "a foreign id does not bind just because this row happens to hold one candidate");
});

test("#850 M1 THE PRE-BIND DOES NOT LIVE HERE — an id-less answer binds to nothing, one candidate or ten", () => {
  // The regression the EXISTING suite caught, and the reason this function has no sole-candidate clause.
  // isRuled is what formRowFinder's BOUND search calls, so a sole-candidate fallback lets ONE submitted
  // ruling discharge BOTH of two twins — distinct obligations sharing a folded key, answered once. The
  // pre-bind belongs to the form the driver WRITES and to the merged row, never to what an answer binds.
  const one = row("Q1", [cand("R-AAA")]);
  const two = row("Q2", [cand("R-AAA"), cand("R-BBB")]);
  assert.deepEqual(resolveCandidate({}, one), { id: "", from: null, state: "unnamed" });
  assert.deepEqual(resolveCandidate({}, two), { id: "", from: null, state: "unnamed" });
  assert.ok(!isRuled(ruled({}), one), "a bare ruling binds to no row, however few candidates it has");
  assert.ok(!isRuled(ruled({}), two));
});

test("#850 M1 the pre-bind still WORKS end to end — the seat never selects on a one-candidate row", () => {
  // The property M1 asked for, proved where it lives rather than where it was convenient: the driver
  // writes the receipt, the union re-asserts it, and a seat sending only ruling+note is ruled.
  const ob = obWith([1]);
  const rid = obligationRows(ob)[0].row_id;
  const { form, ruled: n } = unionDispositionForm(null, [{ row_id: rid, ruling: "benign", note: "n" }], ob);
  assert.equal(n, 1, "ruling + note is the whole of the seat's work on a row with nothing to choose");
  assert.equal(form.rows[0].receipt_id, "R-Q0C0");
});

test("#850 M1 no candidates at all is its own state, not an absence read as a pass", () => {
  assert.deepEqual(resolveCandidate({ receipt_index: 1 }, row("Q1", [])),
    { id: "", from: null, state: "no_candidates" });
});

test("#850 M1 the failure states are DISTINCT — a reader must tell them apart", () => {
  const two = row("Q1", [cand("R-AAA"), cand("R-BBB")]);
  const states = new Set([
    resolveCandidate({ receipt_index: 9 }, two).state,
    resolveCandidate({ receipt_id: "R-NOPE" }, two).state,
    resolveCandidate({}, two).state,
    resolveCandidate({}, row("Q1", [])).state,
  ]);
  assert.equal(states.size, 4, `four different failures, four names — got ${JSON.stringify([...states])}`);
});

// ── site 1: obligationRows writes the pre-fill ──────────────────────────────────────────────────────

const obWith = (resultsPerQuery) => ({
  floor: 4,
  queries: resultsPerQuery.map((n, i) => ({
    query: `query ${i}`,
    results: Array.from({ length: n }, (_, j) => ({ id: `R-Q${i}C${j}`, title: `t${j}`, url: `https://example.invalid/${i}/${j}`, snippet: "" })),
  })),
  recurrent: [],
});

test("#850 M1 site 1 — obligationRows pre-fills a one-candidate row and LEAVES a two-candidate row null", () => {
  const rows = obligationRows(obWith([1, 2, 3]));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].receipt_id, "R-Q0C0", "one candidate ⇒ pre-filled");
  assert.equal(rows[1].receipt_id, null, "TWO candidates ⇒ the seat still chooses");
  assert.equal(rows[2].receipt_id, null, "three ⇒ likewise");
});

test("#850 M1 site 1 — a recurrence row is still pre-filled: the general rule subsumes the special case", () => {
  const rows = obligationRows({
    floor: 4, queries: [],
    recurrent: [{ id: "R-REC", result: { title: "t", url: "https://example.invalid/r", snippet: "" },
      owners: [{ query: "a" }, { query: "b" }] }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "recurrence");
  assert.equal(rows[0].receipt_id, "R-REC");
  assert.equal(rows[0].candidates.length, 1, "which is WHY it is pre-filled — the count, not the kind");
});

// ── site 2: seatTouched must not read the driver's own pre-fill as a seat edit ──────────────────────

test("#850 M1 site 2 — the driver's own pre-fill is NOT the seat's work (every pre-filled row still owes its ruling)", async () => {
  // B retired the whole-file collapse (`form_untouched`) with the form path, but the hazard this arm
  // guards survives it: the driver pre-fills `receipt_id` on every one-candidate row, and a census that
  // read the pre-fill as the seat's work would silently discount rows nobody ruled. Every pre-filled
  // row must still be reported OWED until a ruling lands.
  const { findConnotationViolations, connotationObligations } = await import("../connotation-search.mjs");
  // Built from a RECORDED ledger, not from hand-made rows: the receipt ids are minted by receiptId() and
  // a fixture that chose its own would be testing a form the driver never writes.
  const recorded = [
    { query: "alpha meaning", results: [{ title: "t1", url: "https://example.invalid/1", snippet: "" }] },
    { query: "beta meaning", results: [{ title: "t2", url: "https://example.invalid/2", snippet: "" },
      { title: "t3", url: "https://example.invalid/3", snippet: "" }] },
  ];
  const canonical = obligationRows(connotationObligations(recorded));
  const oneCand = canonical.filter((r) => r.candidates.length === 1);
  assert.equal(oneCand.length, 1, "the fixture must actually carry a pre-filled row or it proves nothing");
  assert.ok(oneCand[0].receipt_id, "…and that row must be pre-filled");

  // The seat hands back exactly what the driver wrote: pre-fills present, nothing else touched.
  const rows = canonical.map((r) => ({ row_id: r.row_id, kind: r.kind, query: r.query,
    receipt_id: r.receipt_id, receipt_index: "", ruling: "", note: "", quote: "" }));
  const v = findConnotationViolations("## Meaning sweep\n", recorded.length, { recorded, form: rows });
  const reasons = (v ?? []).map((x) => x.reason);
  assert.equal(reasons.filter((x) => x === "token_absent").length, canonical.length,
    `EVERY row is owed — the pre-filled one included — got ${JSON.stringify(reasons)}`);

  // And the other direction, or the assertion above would pass on a check that fires unconditionally.
  const worked = rows.map((r) => ({ ...r, ruling: "benign", note: "reasoning" }));
  const v2 = findConnotationViolations("## Meaning sweep\n", recorded.length, { recorded, form: worked });
  assert.ok(!(v2 ?? []).some((x) => x.reason === "form_untouched"),
    "a form the seat DID work must not report form_untouched");
});

// ── site 3: the union carries the RESOLVED id, never the ordinal ────────────────────────────────────

test("#850 M1 site 3 — the union writes the resolved ID into the accumulator, never the ordinal", () => {
  const ob = obWith([3]);
  const submitted = [{ row_id: obligationRows(ob)[0].row_id, receipt_index: 2, ruling: "loaded", note: "n" }];
  const { form, ruled: n } = unionDispositionForm(null, submitted, ob);
  assert.equal(n, 1, "the row is discharged by an ordinal alone");
  assert.equal(form.rows[0].receipt_id, "R-Q0C1", "and what LANDS is the id at that position");
  assert.ok(!("receipt_index" in form.rows[0]) || form.rows[0].receipt_index == null,
    "no ordinal survives into a carried row — it means a different receipt on the next regeneration");
});

test("#850 M1 site 3 — a two-candidate row with no selection is carried UNRULED, not pre-bound", () => {
  const ob = obWith([2]);
  const submitted = [{ row_id: obligationRows(ob)[0].row_id, ruling: "benign", note: "n" }];
  const { form, ruled: n, outstanding } = unionDispositionForm(null, submitted, ob);
  assert.equal(n, 0, "ruling + note without a selection does not discharge a row that had a choice");
  assert.equal(outstanding, 1);
  assert.equal(form.rows[0].receipt_id, null, "and NOTHING was invented into the receipt field");
});

test("#850 M1 site 3 — a one-candidate row's receipt stays the driver's even if the seat overwrites it", () => {
  const ob = obWith([1]);
  const submitted = [{ row_id: obligationRows(ob)[0].row_id, receipt_id: "R-INVENTED", ruling: "benign", note: "n" }];
  const { form } = unionDispositionForm(null, submitted, ob);
  assert.equal(form.rows[0].receipt_id, "R-Q0C0", "the driver's receipt, not the seat's invention");
});

test("#850 M1 site 3 — rulings still ACCUMULATE across attempts under the new resolution", () => {
  // The property bought and the one most easily lost by a change to what "ruled" means.
  const ob = obWith([2, 2]);
  const rows = obligationRows(ob);
  const first = unionDispositionForm(null,
    [{ row_id: rows[0].row_id, receipt_index: 1, ruling: "benign", note: "n1" }], ob);
  const second = unionDispositionForm(first.form,
    [{ row_id: rows[1].row_id, receipt_index: 2, ruling: "loaded", note: "n2" }], ob);
  assert.equal(second.ruled, 2, "the first attempt's ruling survives a submission that never mentions it");
  assert.equal(second.carried, 1);
  assert.equal(second.form.rows[0].receipt_id, "R-Q0C0");
  assert.equal(second.form.rows[1].receipt_id, "R-Q1C1");
});

// ── the instruction is emitted ONCE ─────────────────────────────────────────────────────────────────

test("#850 M1 the meaning-sweep instruction asks for the POSITION and says the id is not needed", () => {
  const s = meaningSweepReceiptsInstruction();
  assert.match(s, /receipt_index/);
  assert.match(s, /POSITION/);
  assert.match(s, /never type an id/i);
  assert.match(s, /exactly ONE receipt is already resolved/);
  assert.ok(!/set `receipt_id` to the id of the candidate/.test(s), "the old dictate is gone");
});

test("#850 M1 the half-lane and whole-run forms differ ONLY where the lanes differ", () => {
  // THIS TEST PINNED THE DEFECT. It asserted the may-own-nothing sentence goes to every half-lane seat,
  // which is what the code did and NOT what the contract wanted — so the wrong condition passed CI every
  // day and read as protected. A test that pins current behaviour rather than intent turns a wrong
  // condition into a defended wrong condition. It now pins the intent: the sentence is about the FORM.
  const whole = meaningSweepReceiptsInstruction();
  const mayHaveNone = meaningSweepReceiptsInstruction({ mayOwnNoQueries: true });
  assert.ok(mayHaveNone.includes("may own zero meaning queries"));
  assert.ok(!whole.includes("may own zero meaning queries"));
  assert.ok(mayHaveNone.includes("receipt_index") && whole.includes("receipt_index"),
    "but the CONTRACT is identical — that is the whole point of one composer");
});

test("the may-own-nothing sentence never reaches a seat that HOLDS a form", () => {
  // The meaning seat always owns meaning queries, so the tool always writes it a form
  // (engine/mcp/perplexity-server.mjs:113 — `const dispositionsPath = spec.connotation?.dispositions_path`,
  // read by `renderConnotationObligations` on the next line). A seat holding
  // a 74-row form previously read a sentence ending "you fill in nothing"; it is now unreachable for it.
  const meaningSeat = meaningSweepReceiptsInstruction({ lead: "MEANING-SWEEP RECEIPTS — THIS IS THE WORK.", findingsTail: false });
  assert.equal(meaningSeat.includes("may own zero meaning queries"), false, meaningSeat.slice(0, 160));
  assert.ok(meaningSeat.includes("receipt_index"), "the contract it DOES owe is untouched");
});

test("the sentence licenses recording NOTHING, never inventing something", () => {
  // The old tail read "…the tool then writes no form and you fill in nothing", and the trailing clause is
  // what a form-holding seat could adopt. The explanation a/b need is kept; the excuse is gone.
  const mayHaveNone = meaningSweepReceiptsInstruction({ mayOwnNoQueries: true });
  assert.ok(mayHaveNone.includes("recording nothing is the complete and correct outcome"));
  assert.ok(mayHaveNone.includes("do not invent"), "and it must not invent rulings either");
  assert.ok(mayHaveNone.includes("do not create any dispositions file"), "nor resurrect the dead file");
  assert.equal(/you fill in nothing/.test(mayHaveNone), false, "the clause that read as a licence is gone");
});

test("`half` is no longer an option — the proxy cannot come back by name", () => {
  // Passing the retired key must not resurrect the sentence: a caller that still says `half: true` gets
  // the no-sentence default, which is the safe direction (a missing explanation is visible; a false
  // licence to a form-holder is not).
  const stale = meaningSweepReceiptsInstruction({ half: true });
  assert.equal(stale.includes("may own zero meaning queries"), false, stale.slice(0, 160));
});

test("#850 M1 NO SECOND AUTHORING of the instruction survives anywhere in the tree", (t) => {
  // This is the guard that matters in a year. The sentence was hand-written four times; a fifth copy
  // added later would tell a seat to type the id while the driver reads a position, and NOTHING would
  // fail — the seat would simply keep missing, exactly as it has since 10 Aug.
  const files = trackedCorpus("disposition-index-selection", { root: ROOT, pathspec: ["*.mjs", "*.md"] });
  if (files === null) return t.skip(skipReason("disposition-index-selection"));

  // BROADENED, because the first version tested ONE SENTENCE and passed while a fifth copy of the
  // contract sat in driver/skills/prelim-common-law/SKILL.md phrased differently — telling the seat to
  // supply `receipt_id` while the driver had been changed to read `receipt_index`. A guard on a phrasing
  // is not a guard on a contract. This matches any text that pairs the field with "the candidate you
  // ruled on", however the sentence is built.
  const OFFENDER = /`?receipt_id`?[^.\n]{0,90}candidate\s+you\s+(actually\s+)?ruled\s+on/i;

  // THE CHECK MUST BE PROVED TO HAVE RUN, not merely to have returned nothing. An empty `guilty` list is
  // what this test reports as a pass, and an empty CORPUS produces exactly that — a mistyped pathspec, a
  // walk that stopped enumerating, a source zip with no git — all read as "no second copy exists". Both
  // halves are therefore asserted: the corpus really holds the file the copies lived in, and the pattern
  // really still matches the text it was written for.
  assert.ok(files.length > 100, `the corpus must be the tree, not a fragment — got ${files.length} files`);
  assert.ok(files.includes("driver/stages.mjs"),
    "the file that carried three of the four copies must be IN the corpus being searched");
  assert.ok(OFFENDER.test('set "receipt_id" to the candidate you ruled on, "ruling" to exactly benign'),
    "the pattern must still match the text it was written to ban — origin/main's stages.mjs:1394");
  assert.ok(OFFENDER.test("- `receipt_id` — the id of the candidate you actually ruled on, from the ones listed"),
    "AND the SKILL.md phrasing. The first version of this guard tested one sentence and passed while a "
    + "FIFTH copy of the contract sat in the doctrine, telling the seat the opposite of what M1 asks");
  assert.ok(!OFFENDER.test("set `receipt_index` to the POSITION of the candidate you ruled on"),
    "…and must NOT match the replacement, or every future run fails on the fix itself");

  const guilty = [];
  for (const f of files) {
    if (f.endsWith("driver/test/disposition-index-selection.test.mjs")) continue;   // this file names it to ban it
    if (f === "driver/contract-e3-backlog.mjs") continue;                           // an AUDIT record of the old text, by design
    if (f === "driver/test/contract-dictation.test.mjs") continue;                  // E12's fixtures state the old text to prove E12 catches it
    let body;
    try { body = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    if (OFFENDER.test(body)) guilty.push(f);
  }
  assert.deepEqual(guilty, [],
    `the instruction is composed by meaningSweepReceiptsInstruction; these author their own copy: ${guilty.join(", ")}`);
});

test("#850 M1 NO SEAT-FACING TEXT DISPLAYS A RECEIPT-ID SHAPE — a shape shown is a shape produced", (t) => {
  // The `R-RECEIPT` mechanism, closed at the source rather than at the refusal. A model shown
  // `R-XXXXXXXX` and asked for an id writes something of that shape; one production seat wrote the
  // literal placeholder into 27 rows. Nothing the seat reads may display the token shape any more —
  // and after M1 nothing needs to, because the seat answers with a position.
  //
  // Scoped to what a SEAT reads: the rendered skills and the prompt composers. Code that handles the
  // field, tests that assert on it, and the E3 audit record that quotes the old text are not prompts.
  const files = trackedCorpus("receipt-shape-not-shown", { root: ROOT, pathspec: ["*.mjs", "*.md"] });
  if (files === null) return t.skip(skipReason("receipt-shape-not-shown"));
  const SEAT_FACING = (f) => f.startsWith("driver/skills/")
    || f === "driver/connotation-search.mjs" || f === "driver/stages.mjs";
  const SHAPE = /R-X{4,}/;

  const scope = files.filter(SEAT_FACING);
  assert.ok(scope.length >= 3,
    `the guard must actually be looking at the seat-facing set — got ${JSON.stringify(scope)}`);
  assert.ok(SHAPE.test("with an id of the form `R-XXXXXXXX`. Open it"),
    "the pattern must match the text it bans — the doctrine's own line before this change");

  // COMMENTS ARE NOT SEAT-FACING, and the distinction has to be drawn or the guard fires on the very
  // comment that explains why the ban exists. Stripping `//` and `/* */` from the .mjs files is a static
  // approximation of "what a seat could read": prompt text lives in string literals, and a token inside
  // one survives this. A markdown skill is read whole — all of it is seat-facing.
  const seatText = (f, body) => (f.endsWith(".md") ? body
    : body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " "));
  assert.ok(!SHAPE.test(seatText("x.mjs", "// a comment mentioning R-XXXXXXXX is not a prompt")),
    "a comment must not trip this, or the explanation of the ban becomes the violation");
  assert.ok(SHAPE.test(seatText("x.mjs", '  "with an id of the form R-XXXXXXXX",')),
    "…while a STRING LITERAL still does, which is the case that matters");

  const showing = scope.filter((f) => {
    try { return SHAPE.test(seatText(f, readFileSync(join(ROOT, f), "utf8"))); } catch { return false; }
  });
  assert.deepEqual(showing, [],
    `these display a receipt-id shape to the seat: ${showing.join(", ")}`);
});

test("#850 M1 / #915 the dispatch names BOTH row kinds — the recurrence rows are not a surprise", () => {
  // e2e's hypothesis (b), confirmed on origin/main and fixed here: taught the doctrine what a
  // recurrence row is and the DISPATCH text was never brought along. It said "one row per recorded
  // meaning query … carrying that query", singular, so a seat opening the form met rows with a `queries`
  // LIST and a pre-filled receipt that nothing had described. common-law-half:m is 0 of 7 first-attempt.
  const s = meaningSweepReceiptsInstruction();
  assert.match(s, /recurrence/, "the kind must be named");
  assert.match(s, /`queries` field is a LIST/, "and its list-shaped field must be named as a list");
  assert.match(s, /already resolved/, "and its receipt must be described as the driver's");
  assert.ok(!/one row per recorded meaning query that returned results/.test(s),
    "the query-only description is what made the recurrence rows invisible");
});

test("#850 M1 a placeholder receipt is NAMED as one, so the seat learns what it did", async () => {
  // The refusal already existed: any id that is not on the row's candidate list fails `form_damaged`,
  // and a placeholder never is. What was missing is that the message could not tell the seat apart from
  // one that simply picked the wrong receipt — and a seat that cannot tell those apart repeats the
  // second forever. 27 rows on one production seat.
  const { isPlaceholderReceipt } = await import("../connotation-search.mjs");
  for (const bad of ["R-RECEIPT", "R-XXXXXXXX", "R-", "r-receipt", "R-ID", "R-PLACEHOLDER"]) {
    assert.equal(isPlaceholderReceipt(bad), true, `${bad} is invented`);
  }
  // A REAL id must never be called a placeholder — that would put a misleading sentence on a seat that
  // merely chose the wrong candidate.
  for (const good of ["R-NHT33E0A", "R-Q0C0AAAA", "R-0123456789".slice(0, 10)]) {
    assert.equal(isPlaceholderReceipt(good), false, `${good} is a real receipt shape`);
  }
  assert.equal(isPlaceholderReceipt(""), false, "an absent id is a different state, not a placeholder");
  assert.equal(isPlaceholderReceipt(null), false);
  assert.equal(isPlaceholderReceipt("Q-ABCDEFGH"), false, "not in the receipt namespace at all");
});

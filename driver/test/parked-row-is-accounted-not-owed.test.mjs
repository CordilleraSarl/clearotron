// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// / — A PARKED ROW IS ACCOUNTED FOR, AND BEING SURFACED IS THE CONDITION OF ACCEPTING IT.
//
// THE DEFECT, MEASURED ON 32adfe1c BEFORE ANY OF THIS WAS WRITTEN. The park was built at the disposition
// TOOL, which drops the row from `outstanding` so the seat stops being asked for it. The census that
// decides whether the findings DOCUMENT is accepted never heard of it. Replayed with both controls
// behaving — a properly ruled row PASSES, an unsubmitted row FAILS `token_absent` — a parked row FAILED:
// by the counter as `token_absent`, by seat declaration as `quote_unbound`.
//
// So the stage failed anyway, the ladder retried, and the seat COULD NOT FIX IT: the tool refuses the row
// it has already parked. Byte-identical attempts, ladder breaks on repeat-signature — the fatal sub-case
// this file's subject documents, where a retry can only escape a state the seat believes is wrong. Three
// merged PRs said a parked row can never kill a run. It killed it faster.
//
// AND THE OBVIOUS FIX IS THE OTHER ISSUE. Simply not counting a parked row would complete the stage over
// an undecided obligation and let the document say "73 processed; all benign" — 's lying receipt,
// filed against this exact seam. So the tests below come in pairs: the stage must stop failing, AND the
// row must appear in the census with its own provenance. Neither alone is the fix.
// EVERY PLANTED PARK BELOW ARRIVES THROUGH THE REAL CALL PATH (`validateDispositionCall`) or the real
// counter (`parkedIds`), never by hand-writing a row. That is deliberate, and it is the second question
// this census had to answer about every guard: not only WHERE enforcement lives, but whether any REAL
// input can reach it. Two guards failed exactly that test today — a `--check` flag the script did not
// parse, which fell through to an unconditional-0 dry run, and `findFloorBreaches`, which returned []
// unless a manifest line carried a literal ⭐ that no rendered manifest can contain. Both were green
// forever and guarding nothing. A hand-built row would have made these tests the same shape: passing
// against a state the production path cannot produce.
import { test } from "node:test";
import assert from "node:assert/strict";
import { connotationObligations, obligationRows, findConnotationViolations,
  CONNOTATION_REASONS, CONNOTATION_UNRULED_REASONS } from "../connotation-search.mjs";
import { unionDispositionForm } from "../disposition-union.mjs";
import { validateDispositionCall } from "../disposition-call.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const SNIP = "A long enough passage of captured text to be usable for a spot check on this row.";
const RECORDED = [{ query: "a meaning query", results: [
  { id: "R-AAAA1111", title: "first", url: "https://e.test/1", snippet: SNIP }] }];
const OB = connotationObligations(RECORDED);
const ID = obligationRows(OB)[0].row_id;
// — its ADDRESS in a call: the position of that row in the driver's list. The FORM rows below
// still key on ID, which is the driver's own and did not move — only what the SEAT types changed.
const AT = 1;
const DOC = ["## Connotation / meaning", "Meaning sweep ran; nothing loaded.",
  "- **Connotation-search source:** https://e.test/1"].join("\n");

const census = (u) => findConnotationViolations(DOC, 1, { recorded: RECORDED, form: u.form.rows });
const owed = (v) => v.reduce((n, x) => n + (CONNOTATION_UNRULED_REASONS.includes(x.reason) ? (Number(x.count) || 1) : 0), 0);
const union = (submitted, opts = {}) => unionDispositionForm({ rows: [] }, { rows: submitted }, OB, { half: "b", ...opts });
const ruledRow = () => validateDispositionCall([{ row_index: AT, ruling: "benign", note: "ordinary",
  receipt_index: 1, segment_index: 1, fragment: "A long enough" }], RECORDED).accepted;
const declaredRow = () => validateDispositionCall([{ row_index: AT, ruling: "loaded", note: "n",
  receipt_index: 1, obstacle: "every passage is an elision marker" }], RECORDED).accepted;

// ── THE CONTROLS RUN FIRST. Three earlier versions of this probe reported "no violations" for every case
// including ones that must fail — `recorded` is the pr_risk DATA, not a count, so a number censused an
// empty set and returned early. A census that cannot produce a pass AND a fail proves nothing about the
// case in between, so both are asserted before any parked row is looked at.
test("#1230 CONTROL: a properly ruled row passes the census", () => {
  const u = union(ruledRow());
  assert.equal(u.ruled, 1, "the fixture's ruled row was not accepted — every assertion below is measuring the wrong thing");
  assert.deepEqual(census(u).map((v) => v.reason), [], "a complete row is being reported as a violation");
});

test("#1230 CONTROL: an unsubmitted row still fails the census", () => {
  const v = census(union([]));
  assert.ok(v.length > 0, "the census stopped reporting an obligation nobody answered — the guard is inert");
  assert.equal(owed(v), 1, "an unanswered obligation must still be OWED");
});

test("#1230 a row parked BY THE COUNTER is no longer owed — the stage stops failing on it", () => {
  const u = union([], { parkedIds: [ID] });
  assert.equal(u.parked, 1);
  assert.equal(u.outstanding, 0, "the tool's own count already excluded it — that half was never the defect");
  assert.equal(owed(census(u)), 0,
    "the census still OWES a row the seat has been told to stop sending — the ladder retries and the seat cannot fix it");
});

test("#1230 …and it is SURFACED, because that is the condition of accepting it", () => {
  const p = census(union([], { parkedIds: [ID] })).find((v) => v.reason === "parked");
  assert.ok(p, "the parked row vanished from the census — the stage now completes over an obligation nobody decided, "
    + "which is the lying receipt this pair of issues is about");
  assert.equal(p.parked_kind, "exhausted", "the park's provenance did not reach the census");
  assert.match(p.detail, /UNDECIDED/, "the census row does not say the obligation is undecided");
  assert.match(p.detail, /no count may report it as one/, "nothing in the row warns a summarising seam off counting it");
});

test("#1230 a row parked BY SEAT DECLARATION carries its own kind and its own sentence", () => {
  const v = census(union(declaredRow()));
  assert.equal(owed(v), 0);
  const p = v.find((x) => x.reason === "parked");
  assert.ok(p, "a seat-declared park still fails the document census");
  assert.equal(p.parked_kind, "declared", "the two kinds collapsed at the census — the declared:exhausted ratio cannot be read");
  assert.match(p.detail, /elision marker/, "the seat's own sentence did not reach the reader who has to act on it");
  assert.doesNotMatch(p.detail, /per-row bound/,
    "a row that was never refused is telling the lawyer it was refused past a bound");
});

test("#1230 `parked` is DECLARED and is NOT an unruled reason — both halves matter", () => {
  // Declared: pins the reason vocabulary to what this module can emit, so an undeclared reason is a
  // reader that cannot resolve what it is looking at.
  assert.ok(CONNOTATION_REASONS.includes("parked"), "the census emits a reason the vocabulary does not declare");
  // Not unruled: outstanding means "the seat still owes this", and the park means it has been told to
  // stop. Both true at once is the deterministic death.
  assert.ok(!CONNOTATION_UNRULED_REASONS.includes("parked"),
    "a parked row counts as outstanding — the stage fails forever on a row nobody may re-send");
});

test("#1230 THE PAIRING IS THE PROPERTY: nothing is un-owed without being reported", () => {
  // The one shape that must never exist — dropped from the owed count AND absent from the census — is the
  // delivered lie. Asserted as a property over both park kinds rather than trusting the two tests above.
  for (const [label, u] of [["counter", union([], { parkedIds: [ID] })], ["declared", union(declaredRow())]]) {
    const v = census(u);
    const un = owed(v) === 0, seen = v.some((x) => x.reason === "parked");
    assert.equal(un && seen, true, `${label}: un-owed=${un} surfaced=${seen} — a row may only leave the owed count by being reported`);
  }
});

// ── THE OTHER THREE CLERKS ───────────────────────────────────────────────────────────────────────────
//
// Enumerated on before this was written, because six readers were assumed and fourteen matched the
// grep. Two of the misses reach the client. Each below is its own decision-maker, and each gets its own
// planted park: a merged mega-checker would have hidden which one was broken.
import { connotationAuditCounts, renderDispositionTable } from "../connotation-search.mjs";

test("#1230 CLERK 3 — the DELIVERED table carries the undecided row instead of dropping it", () => {
  // The worst of the four. `usable` filtered to rows with a ruling, which was right while an unruled row
  // meant the stage FAILED and nothing shipped. A parked row ships — so the filter silently removed the
  // one obligation nobody could decide, and the reader got a complete-looking table with no gap in it.
  // Carried the way the REAL flow carries it: disposition-tool.mjs writes the exhausted sentence with the
  // count and the bound, and the union preserves it. Building the union alone would test a shape the
  // production path does not produce — the same hand-built-row mistake the header warns about.
  const u = unionDispositionForm(
    { rows: [{ row_id: ID, parked: true, parked_kind: "exhausted", parked_refusals: 30,
               parked_reason: "refused 30 times without binding (bound 30) — parked unresolvable so the stage can complete" }] },
    { rows: [] }, OB, { half: "b" });
  const out = renderDispositionTable(u.form.rows, OB);
  assert.notEqual(out, "", "a sweep whose only outcome was a park rendered NOTHING — the same disappearance one level up");
  assert.match(out, /UNDECIDED/, "the delivered table does not say any obligation was left undecided");
  assert.match(out, /1 of 1 obligation/, "the table does not state how many of how many were left undecided");
  assert.match(out, /refused 30 times without binding \(bound 30\)/,
    "the reason the row is undecided did not reach the reader who has to act on it");

  // And a park that somehow carries NO sentence still renders an honest placeholder, never a blank cell a
  // reader has to interpret.
  const bare = renderDispositionTable(union([], { parkedIds: [ID] }).form.rows, OB);
  assert.match(bare, /no reason was recorded/, "an undecided row with no sentence renders an empty cell");
});

test("#1230 CLERK 3 — a park does not hide inside the RULING column", () => {
  // Rendered as its own block on purpose: an undecided row sitting under a heading that says "Ruling" is
  // read as a ruling whatever the cell contains.
  const mixed = unionDispositionForm({ rows: [] }, { rows: ruledRow() }, OB, { half: "b" });
  const out = renderDispositionTable(mixed.form.rows, OB);
  assert.match(out, /\| Ruling \|/, "the ruling table stopped rendering — this assertion is measuring nothing");
  assert.doesNotMatch(out, /UNDECIDED/, "a run with nothing parked is advertising an undecided section");
});

test("#1230 CLERK 2 — the audit's numbers count the parks, split by kind", () => {
  const c = (u) => connotationAuditCounts(census(u));
  const byCounter = c(union([], { parkedIds: [ID] }));
  assert.equal(byCounter.parked, 1, "the audit reports zero problems over an obligation nobody decided");
  assert.equal(byCounter.parkedDeclared, 0);
  const bySeat = c(union(declaredRow()));
  assert.equal(bySeat.parked, 1);
  assert.equal(bySeat.parkedDeclared, 1,
    "the two kinds collapsed in the audit — the declared:exhausted ratio is the only evidence the honest exit works");
  // The three original numbers must not absorb it: that was the defect, not the fix.
  assert.equal(byCounter.neverAddressed, 0, "a parked row is being counted as never addressed — it is not owed");
  assert.equal(byCounter.quotesUnbound, 0);
  assert.equal(byCounter.didNotBind, 0);
});

const GUARD = "disposition row-state readers";
test("#1230 THE READER TRIPWIRE — a new module that reads row state must be taught the park", (ctx) => {
  // 's assurance is a COUNT, so it has to be enforced as one. A fifteenth module arriving silently
  // is exactly how the fourteenth went unnoticed.
  //
  // THE INSTRUMENT READS CODE, AND IT DID NOT USED TO. The first version matched raw file text, so a
  // module NAMING the vocabulary in prose was indistinguishable from one USING it. That fired three
  // times in one day on accurate documentation — most sharply on contract-vocabulary.mjs, whose ruling
  // has to say WHY a code is renamed rather than namespaced, and cannot say it without naming
  // CONNOTATION_REASONS. Each firing then reopened the same argument: reword the doctrine, or classify
  // it out by hand. Both are wrong. An instrument asserting a CODE property must read code, and prose
  // never gets made worse to buy a green.
  //
  // So the population is split rather than filtered, because "matches only in comments" is information
  // worth keeping: a module that talks about row state is often one about to read it. READERS must be
  // taught the park. PROSE must not — but a new member of EITHER list still fails, so nothing arrives
  // silently and classification is now the machine's job instead of a duty somebody has to remember.
  //
  // THROUGH THE HELPER, never a raw `git ls-files`: outside a checkout there is no corpus, and
  // `trackedFiles` makes that a STATED skip instead of a wall of failures that say nothing about this
  // tree. Same reason the census and identifier sweeps use it — and CI asserts no guard SKIPPED silently.
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const tracked = trackedFiles(GUARD, { root: ROOT, pathspec: ["*.mjs"] });
  if (tracked === null) return ctx.skip(skipReason(GUARD));
  const files = tracked.map((f) => f.trim()).filter(Boolean).filter((f) => !f.startsWith("test/"));   // driver-relative: "test/x.mjs" has no leading slash
  const PATTERN = /\bisRuled\b|\bunionDispositionForm\b|\bfindConnotationViolations\b|\bCONNOTATION_REASONS\b|\bCONNOTATION_UNRULED_REASONS\b|\bparseDispositionForm\b/;
  // Block comments first, then line comments — enough for this tree, where the vocabulary never appears
  // inside a string literal. Over-stripping is the DANGEROUS direction (a real reader would go quiet),
  // so the arithmetic assertion at the foot of this test exists to catch it.
  const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const read = (f) => readFileSync(new URL(f, new URL("../", import.meta.url)), "utf8");
  const matched = files.filter((f) => PATTERN.test(read(f)));
  const base = (f) => f.split("/").pop();
  const readers = matched.filter((f) => PATTERN.test(codeOf(read(f)))).map(base).sort();
  const prose = matched.filter((f) => !PATTERN.test(codeOf(read(f)))).map(base).sort();

  // publish/render.mjs is in NEITHER list, and its absence is a correction to the first enumeration: that
  // grep was unanchored, so `isRuledOut` — a LOCAL predicate about a FINDING being ruled out — matched
  // `isRuled`. With word boundaries it does not, which is the right answer: the module never touches a
  // disposition row.
  const READERS = [
    "connotation-search.mjs", "disposition-tool.mjs", "disposition-union.mjs",
    "gateway.mjs", "pipeline.mjs", "stages.mjs", "verify.mjs",
  ];
  // Every one of these names the vocabulary in prose and reads no row. coverage-form.mjs is the one the
  // hand enumeration called a reader: it DOES import from connotation-search.mjs, but the import is
  // `shortId`, which is not row state. Importing from the module and reading a row are different facts,
  // and only the second one has to know about parks.
  const PROSE = [
    "case-law-ledger.mjs", "common-law-receipts.mjs", "contract-vocabulary.mjs", "coverage-form.mjs",
    "disposition-call-audit.mjs", "doubt-closure-tool.mjs", "repairs.mjs",
  ];

  assert.deepEqual(readers, READERS,
    "the set of modules whose CODE touches disposition row state CHANGED. A reader must be taught that a "
    + "parked row is not ruled and not owed, and no count may report it as either — re-run #1230's "
    + "enumeration and classify the new member before updating this list.");
  assert.deepEqual(prose, PROSE,
    "the set of modules that NAME row state in prose without reading it CHANGED. This is not a defect by "
    + "itself: if the new member only documents the vocabulary, add it here. If it actually reads a row, "
    + "it belongs in READERS and has to handle parks first. Do not reword accurate documentation to "
    + "empty this list.");

  // VOID CONTROL, and the reason the split is safe. If `codeOf` ever over-strips — a stray unterminated
  // block comment, a syntax this crude stripper mishandles — real readers migrate silently into `prose`
  // and the tripwire stops watching them. Both assertions above would fail, but only if these two lists
  // stay complete, so the arithmetic is asserted directly against the raw match set.
  assert.equal(readers.length + prose.length, matched.length,
    "a matched module landed in neither list — the classification lost a file");
  assert.ok(readers.includes("connotation-search.mjs"),
    "the module that DEFINES this vocabulary is not classified as reading it — `codeOf` is over-stripping "
    + "and every other reader may have gone quiet with it");
});

test("#1233 A PARK IS RELEASABLE, and releasing clears it at every reader", () => {
  // Observed on a live client matter: the park fired at the bound on two rows, then RELEASED when both
  // were ruled on the next call during the recovery retry — final form 73/73 ruled, 0 parked standing.
  // "The park instructs, it does not destroy" is therefore a live property, not a design intention, and
  // every reader has to tolerate parked -> ruled. A dictionary that treated parked as terminal would have
  // reported an undecided obligation on a run that decided all of them.
  const parked = union([], { parkedIds: [ID] });
  assert.equal(parked.parked, 1, "the fixture did not park — the release below would prove nothing");
  assert.deepEqual(census(parked).map((v) => v.reason), ["parked"]);

  // The prior form carries the park; the seat then rules the row. parkedIds STILL names it, exactly as it
  // does live — being in the parked set must lose to being ruled.
  const released = unionDispositionForm(parked.form, { rows: ruledRow() }, OB, { half: "b", parkedIds: [ID] });
  const row = released.form.rows.find((r) => r.row_id === ID);
  assert.equal(released.ruled, 1, "a ruling arriving after the park was discarded — the park destroyed work");
  assert.equal(released.parked, 0);
  assert.equal(row.parked, false);
  assert.equal(row.parked_kind, "", "a released row still carries a park kind — a later reader will re-report it");
  assert.equal(row.parked_reason, "", "a released row still carries the sentence explaining why it was undecided");
  assert.deepEqual(census(released).map((v) => v.reason), [],
    "the document census still reports a row that was released — the stage fails on work that landed");
});

test("#1233 the EXHAUSTED sentence is left for the writer that knows the numbers", () => {
  // The defect this pins: this module used to invent a generic sentence for the exhausted kind, which
  // made disposition-tool.mjs's informative writer — guarded on emptiness — unreachable on EVERY real
  // park. Live parks read "refused the per-row bound without binding" while the tool stood ready to say
  // "refused 30 times without binding (bound 30)". The count and the bound are exactly the two facts a
  // reader of an undecided row needs.
  const u = union([], { parkedIds: [ID] });
  const row = u.form.rows.find((r) => r.row_id === ID);
  assert.equal(row.parked, true);
  assert.equal(String(row.parked_reason ?? "").trim(), "",
    "the union filled the exhausted sentence again — the tool's writer is guarded on emptiness and is now unreachable");

  // …and a reason CARRIED from a prior form still wins, which is why the fix is here and not a dropped
  // guard in the tool: dropping it would overwrite a genuine sentence on every re-union.
  const carried = unionDispositionForm(
    { rows: [{ row_id: ID, parked: true, parked_kind: "exhausted", parked_reason: "refused 30 times without binding (bound 30)", parked_refusals: 30 }] },
    { rows: [] }, OB, { half: "b" });
  assert.match(carried.form.rows.find((r) => r.row_id === ID).parked_reason, /refused 30 times/,
    "a sentence already written was re-invented — a re-union is overwriting the record");
});

test("#1233 a DECLARED park still carries the seat's own sentence from this module", () => {
  // The declared kind IS this module's to write: the seat's obstacle arrives on the submission and there
  // is no later writer that knows it. Asserted so the fix above cannot be over-applied to both kinds.
  const row = union(declaredRow()).form.rows.find((r) => r.row_id === ID);
  assert.match(row.parked_reason, /elision marker/, "the seat's own sentence was dropped along with the generic one");
  assert.equal(row.parked_kind, "declared");
});

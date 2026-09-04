// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the reviewer's flags reach both passes as DATA, and the recheck is handed what the driver saw.
//
// THE EVIDENCE GATE, AND WHY IT IS NOW MET. `docs/design/clearance-critical-path.md` §4 refused to build
// this on the one measurement it had: an all-zero `[kind: …]` histogram on a BLOCKING run, because the
// reviewer's skill taught the token twice, both `rating`. taught all four. The first clearance after
// it deployed came back:
//
//     {"event":"correction-kinds","verdict":"BLOCKING",
//      "counts":{"coverage-disposition":3,"fact":6,"rating":2,"narrative":1},"untyped":4,"total":12}
//
// Four kinds, eight of twelve lines typed. The channel carries content.
//
// WHAT IS BUILT, and what deliberately is not. The corrective pass gets the flags as a typed worklist
// (the raw review still rides below it). The recheck gets a driver-built table of what MOVED in the
// findings, flag by flag, so it re-reads two documents to JUDGE rather than to re-derive. The verdict
// gate, the stage order and the reviewer's authority are untouched.
//
// Run:  node --test driver/test/corrections-feedforward.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCorrections, parseCorrectionKinds, CORRECTION_KINDS } from "../verify.mjs";
import { buildCorrectionsApplied, correctionsWorklist, correctionsAppliedTable, targetsOf } from "../corrections-feedforward.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REPAIR_COMPOSERS } from "../repair-composers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const REVIEW = [
  "BLOCKING",
  "",
  "## Corrections",
  "- [kind: fact] The ACME SA owner attribution is not supported by any fetched record.",
  "- [kind: rating] BREEZEBERRY is rated high on goods proximity; the record shows class 5 only.",
  "- [kind: narrative] The second paragraph overstates how crowded the field is.",
  "- An untyped line about ACME SA that should still be read as a fact correction.",
  "- [kind: bogus] A line whose declared kind is not in the closed enum.",
  "",
  "PLAN-EXECUTION CHECK",
  "- [kind: fact] this line is inside the plan audit and is NOT a correction",
].join("\n");

const finding = (mark, owner, extra = {}) => ({ mark, owner: { name: owner }, band: "Medium",
  meters: { mark_similarity: { token: "high" } }, legal_position: "x", practical_position: "y", ...extra });
const PRE = { findings: [finding("ACME SA", "Acme SA"), finding("BREEZEBERRY", "Beta KK")] };

test("#526 the flags parse into typed rows, and the histogram is DERIVED from them", () => {
  const rows = parseCorrections(REVIEW);
  assert.equal(rows.length, 5, "five correction lines — the plan-audit line is not one of them");
  assert.deepEqual(rows.map((r) => r.kind), ["fact", "rating", "narrative", "fact", "fact"]);
  // The enum is CLOSED, and the fail-safe is `fact` — the kind that always keeps the corrective pass
  // running. A token outside it is not trusted just because it was declared: a mis-typed line may only
  // ever over-correct, never route a real correction into a kind nothing acts on.
  assert.deepEqual(rows.map((r) => r.typed), [true, true, true, false, false]);
  assert.equal(rows[4].kind, "fact", "an unknown token falls back, exactly as a missing one does");
  assert.ok(!rows.some((r) => /\[kind:/.test(r.text)), "the token is the channel, not the instruction — it does not ride back");
  assert.ok(!rows.some((r) => /^[-*•]/.test(r.text)), "and neither does the bullet");

  // ONE walk, ONE definition of "a correction line". The histogram used to be a second copy of this loop.
  const ck = parseCorrectionKinds(REVIEW);
  assert.equal(ck.total, rows.length);
  assert.equal(ck.untyped, 2);
  assert.deepEqual(ck.counts, { "coverage-disposition": 0, fact: 3, rating: 1, narrative: 1 });
  for (const k of CORRECTION_KINDS) assert.equal(typeof ck.counts[k], "number", `${k} is always present, even at zero`);
});

test("#526 the worklist groups by kind, because four kinds want four different moves", () => {
  const w = correctionsWorklist(parseCorrections(REVIEW));
  assert.match(w, /fact \(3\):/);
  assert.match(w, /rating \(1\):/);
  assert.match(w, /narrative \(1\):/);
  assert.match(w, /an untyped line reads as `fact`/, "the fail-safe is stated, not left to be discovered");
  assert.equal(correctionsWorklist([]), "", "a review with no flagged lines adds nothing to the prompt");
});

test("#526 the driver observes what MOVED, per flag — not what the author says it did", () => {
  // The corrective pass withdrew the ACME finding and left BREEZEBERRY untouched.
  const POST = { findings: [
    { ...PRE.findings[0], disposition: "withdrawn", withdrawn_reason: "no record supports the attribution" },
    PRE.findings[1],
  ] };
  const applied = buildCorrectionsApplied(parseCorrections(REVIEW), PRE, POST);
  assert.deepEqual(applied.map((r) => r.outcome),
    ["findings-changed", "findings-unchanged", "not-entity-scoped", "findings-changed", "not-entity-scoped"]);
  assert.deepEqual(applied[0].targets, ["ACME SA"]);
  assert.deepEqual(applied[1].targets, ["BREEZEBERRY"]);
  assert.deepEqual(applied[2].targets, [], "a prose flag names no finding, and that is a different fact from naming one and moving nothing");
});

test("#526 `findings-unchanged` is a place to look, never a verdict — and the table says so", () => {
  const POST = { findings: PRE.findings };            // the pass changed nothing at all
  const applied = buildCorrectionsApplied(parseCorrections(REVIEW), PRE, POST);
  const table = correctionsAppliedTable(applied);
  assert.match(table, /machine-derived from the findings before and after/);
  assert.match(table, /`findings-unchanged` is NOT a failure/,
    "a narrative-only correction and a reasoned no-change both land there; rendering it as failure would "
    + "teach the reviewer to demand a findings edit for every prose flag");
  assert.match(table, /\| 1 \| fact \|/, "one row per flag, numbered as the reviewer numbered them");
});

test("#526 with NO pre-corrective snapshot nothing is claimed — the absence is its own outcome", () => {
  const applied = buildCorrectionsApplied(parseCorrections(REVIEW), null, { findings: PRE.findings });
  assert.ok(applied.every((r) => r.outcome === "not-checkable"),
    "an absent snapshot must not read as 'nothing moved' — that is an absence reported as a finding");
});

test("#526/#1067 a finding that APPEARED is a change; one that VANISHED is a REMOVAL", () => {
  // merged both into `findings-changed`, and its fixture only ever exercised the vanished half — so
  // the name claimed a population of two over a population of one. measured what the merge cost: a
  // corrective pass answered a flag by DELETING the fact it named, and this table, the driver's own
  // evidence, called that deletion a change — the outcome that reads as the flag having landed.
  // 's actual assertion is intact: a removed finding is still not `findings-unchanged`.
  const POST = { findings: [PRE.findings[1]] };       // ACME is gone entirely
  const applied = buildCorrectionsApplied(parseCorrections(REVIEW), PRE, POST);
  assert.equal(applied[0].outcome, "findings-removed", "a finding the pass removed is not 'unchanged' — and it is not 'changed' either");
  assert.deepEqual(applied[0].removed, ["ACME SA"], "…and the fact that left the report is named");

  // The half the old name claimed and the old fixture never ran.
  const grew = buildCorrectionsApplied(parseCorrections(REVIEW), { findings: [PRE.findings[1]] }, PRE);
  assert.equal(grew[0].outcome, "findings-changed", "a finding the pass ADDED is a change, and stays one");
  assert.deepEqual(grew[0].removed, [], "…with nothing removed, said as a value rather than left absent");
});

test("#526 targetsOf matches on the finding's OWN names, so an unrelated flag claims nothing", () => {
  const known = new Map([["acme sa", "ACME SA"], ["breezeberry", "BREEZEBERRY"]]);
  assert.deepEqual(targetsOf("the ACME SA attribution is unsupported", known), ["ACME SA"]);
  assert.deepEqual(targetsOf("the second paragraph is overstated", known), []);
  assert.deepEqual(targetsOf("both ACME SA and BREEZEBERRY need a look", known).sort(), ["ACME SA", "BREEZEBERRY"]);
});

test("#526 an empty review produces no worklist and no table — the prompts are byte-identical to today", () => {
  assert.deepEqual(parseCorrections(""), []);
  assert.equal(correctionsWorklist(parseCorrections("")), "");
  assert.equal(correctionsAppliedTable([]), "");
  assert.equal(correctionsAppliedTable(null), "");
});

test("#526 the RECHECK dispatch carries the observed table — asserted on the COMPOSED text (#1183)", () => {
  // RE-POINTED FROM A SOURCE WINDOW TO THE COMPOSED TEXT. This used to slice 6000 characters of
  // pipeline.mjs after `trigger: "verdict-recheck"`, and its own comment recorded the cost — "WINDOW
  // WIDENED, not the assertion weakened" — a window that must be re-tuned every time the dispatch
  // grows. The composer is registered now, so both branches can be composed and read directly.
  const e = REPAIR_COMPOSERS.find((c) => c.key === "narrative-refutation:verdict-recheck");
  assert.ok(e, "the recheck composer must be registered — if it moved, re-point rather than delete");
  const src = String(e.compose);
  const [wide, narrow] = e.samples.map((x) => e.compose(x.args));

  assert.match(src, /appliedTable/,
    "without it the reviewer re-reads two documents to re-derive what the driver already recorded");
  assert.match(src, /correctionsScope\?\.scoped/, "the narrowing is gated on the declaration");
  assert.match(wide, /Re-read BOTH updated files/, "an undeclared review still gets the wide read");
  assert.match(narrow, /YOU DECLARED WHICH FINDINGS YOUR FLAGS WERE ABOUT/, "the declared branch narrows");
  assert.doesNotMatch(narrow, /Re-read BOTH updated files/, "…and the two branches are exclusive");
  assert.ok(src.indexOf("appliedTable") < src.indexOf("planAuditCarry"),
    "and it rides before the plan-audit carry, beside the evidence it is about");
});

// ── — A NAMELESS FINDING USED TO SWALLOW A DECLARED ORDINAL ─────────────────────
//
// Measured across four runs before these arms existed: on the one run where the reviewer declared
// ordinals for every flag — `named=[1..12]`, `unbound=[]`, so every declaration resolved — FOUR of its
// twelve flags still came out `not-entity-scoped`. The join resolved the ordinal to the finding's NAME
// and then matched on that, so a finding carrying neither `mark` nor `owner.name` produced an empty
// list, fell through to the prose match, and found nothing there either.
//
// The outcome was indistinguishable from a flag where the reviewer declared nothing at all — which is
// the shape that makes this worth arms rather than a fix: the measurement said "the reviewer did not
// scope it" about flags the reviewer had scoped precisely.
const NAMELESS_PRE = { findings: [
  { ordinal: 7, band: "MANAGEABLE", composite: 3 },                       // no mark, no owner.name
  { ordinal: 8, mark: "CEDARLINE", owner: { name: "Cedar Ltd" }, band: "CLEAR", composite: 1 },
]};
const flag = (n, ordinals, text) => ({ n, kind: "fact", typed: true, text, ordinals });

test("#1946 a declared ordinal joins even when the finding it names has no name", () => {
  const post = { findings: [{ ...NAMELESS_PRE.findings[0], band: "SERIOUS", composite: 5 }, NAMELESS_PRE.findings[1]] };
  const [row] = buildCorrectionsApplied([flag(1, [7], "the band on this finding is not supported.")], NAMELESS_PRE, post);
  assert.notEqual(row.outcome, "not-entity-scoped",
    "the reviewer declared ordinal 7, the run HAS ordinal 7, and the driver knew exactly which finding "
    + "the flag was about. Reporting it as unscoped throws away a certainty in favour of a name lookup, "
    + "and reads in the measurement as the reviewer's failure to scope");
  assert.equal(row.outcome, "findings-changed", "and the band moved, so the pass acted on it");
  assert.deepEqual(row.targets, ["finding 7"],
    "a finding with no name still needs a readable label — falling out of `targets` is what dropped it "
    + "out of the join in the first place");
});

test("#1946 …and an unmoved nameless finding is `findings-unchanged`, not `not-entity-scoped`", () => {
  // The half that matters for the client's report: these two outcomes print DIFFERENT sentences. One
  // says the run checked and nothing moved; the other says the run could not check. Before this, a
  // nameless finding got the second when the first was true.
  const [row] = buildCorrectionsApplied([flag(1, [7], "the band on this finding is not supported.")],
    NAMELESS_PRE, { findings: [...NAMELESS_PRE.findings] });
  assert.equal(row.outcome, "findings-unchanged");
});

test("#1946 an ordinal the run does not have falls back to prose, and is not a phantom join", () => {
  const [row] = buildCorrectionsApplied([flag(1, [99], "CEDARLINE is rated against the wrong goods.")],
    NAMELESS_PRE, { findings: [...NAMELESS_PRE.findings] });
  assert.deepEqual(row.ordinals, [99], "the declaration is recorded even when it resolves to nothing");
  assert.ok(row.targets.includes("CEDARLINE"),
    "ordinal 99 exists in no findings doc, so the declaration is useless and the prose match is all "
    + "there is — a declared-but-unbound ordinal must not short-circuit the fallback");
});

test("#1946 the saved row carries `ordinals`, which the artifact could not answer for", () => {
  const rows = buildCorrectionsApplied(
    [flag(1, [8], "a declared flag."), { n: 2, kind: "narrative", typed: true, text: "an undeclared flag.", ordinals: null }],
    NAMELESS_PRE, { findings: [...NAMELESS_PRE.findings] });
  assert.deepEqual(rows.map((r) => r.ordinals), [[8], null],
    "`ordinals` was computed and then dropped from the row, so corrections-applied.json could not say "
    + "how many flags declared one — the number that decides whether an unjoined flag is the reviewer's "
    + "doing or the join's. A four-run read found it unrecoverable from the artifact");
  assert.ok("ordinals" in rows[1],
    "and the undeclared case must carry the key with null rather than omitting it — an absent key and a "
    + "null read the same to a counter that uses `?.` and differently to one that uses `in`");
});

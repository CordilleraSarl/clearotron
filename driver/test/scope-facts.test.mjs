// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scope-facts.mjs — the per-class scope truth (PR compute-don't-author): instructed classes × frozen
// plan × band states × coverage ledger, joined by CODE. Fixtures are synthetic, structure-copied from
// real artifact SHAPES only (instructed-scope.json / register-plan.json / plan-execution.json /
// register-coverage-ledger.json) — no client data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveScopeFacts } from "../scope-facts.mjs";
import { classTokensFromScopeText } from "../coverage-ledger.mjs";

// A minimal frozen-plan shape (provider-NEUTRAL: qid/nice_classes/regions only — never a vendor field).
const PLAN = {
  schema_version: 1, plan_version: 1, nice_classes: ["5", "32"], regions: ["us", "eu", "ch"],
  entries: [
    { qid: "primary-sweep:exact:markname", axis: "primary-sweep", predicate: "exact", term: "MARKNAME", nice_classes: ["5", "32"], regions: ["us", "eu", "ch"] },
    { qid: "primary-sweep:exact:variant", axis: "primary-sweep", predicate: "exact", term: "VARIANT", nice_classes: ["5", "32"], regions: ["us", "eu", "ch"] },
    { qid: "primary-sweep:default:mark", axis: "primary-sweep", predicate: "default", term: "MARK", nice_classes: ["5", "32"], regions: ["us", "eu", "ch"] },
    { qid: "primary-sweep:exact:markname+merch", axis: "primary-sweep", predicate: "exact", term: "MARKNAME", nice_classes: ["25"], regions: ["us", "eu", "ch"] },
  ],
};

const EXEC = {
  executed: [
    { qid: "primary-sweep:exact:markname", state: "enumerated" },
    { qid: "primary-sweep:exact:variant", state: "enumerated" },
    { qid: "primary-sweep:default:mark", state: "incomplete" },
  ],
  missing: [], skipped: [], deferred: [],
};

const INSTRUCTED = { marks: ["MARKNAME"], classes: [5, 32], jurisdictions: ["us", "eu", "ch"], goods: null, customer: "X" };

test("scope-facts: the full join — per-class counts, state, classes_line, coverage_line", () => {
  const f = deriveScopeFacts({ instructedScope: INSTRUCTED, plan: PLAN, planExecution: EXEC, coverageRows: [] });
  assert.deepEqual(f.instructed.classes, ["5", "32"]);
  assert.equal(f.classes_line, "5, 32");
  for (const c of ["5", "32"]) {
    assert.equal(f.per_class[c].total, 3, "the planned-slice denominator rides the sidecar");
    assert.equal(f.per_class[c].enumerated, 2);
    assert.equal(f.per_class[c].incomplete, 1);
    assert.equal(f.per_class[c].deferred, 0);
    assert.equal(f.per_class[c].state, "incomplete", "one crowd slice ⇒ the class is NOT claimable as fully searched");
    assert.deepEqual(f.per_class[c].dispatched_qids.length, 3);
  }
  // Spec B4 (2026-07-30): a partial class carries the PROPORTION plus a plain-language reason —
  // never the old worst-state-wins word, never a bare "searched".
  assert.match(f.coverage_line, /Classes 5 and 32: 2 of 3 searches completed — the remaining 1 returned more records than could be listed in full/);
  // office codes display uppercase — "us" reads as a pronoun, "US" as a jurisdiction
  assert.match(f.coverage_line, /registers: US, EU, CH/);
  // the merch-only class 25 is NOT instructed → no per_class row for it
  assert.equal(f.per_class["25"], undefined);
});

test("scope-facts: fully-enumerated classes read plainly as 'searched'; worldwide scope_basis rides the tail", () => {
  const exec = { ...EXEC, executed: EXEC.executed.map((x) => ({ ...x, state: "enumerated" })) };
  const f = deriveScopeFacts({ instructedScope: INSTRUCTED, plan: { ...PLAN, scope_basis: "worldwide" }, planExecution: exec, coverageRows: [] });
  assert.equal(f.per_class["5"].state, "executed");
  assert.match(f.coverage_line, /Classes 5 and 32: searched/);
  assert.match(f.coverage_line, /registers: worldwide/);
  assert.equal(f.scope_basis, "worldwide");
});

test("scope-facts: a missing qid ⇒ unexecuted; a capability-gap qid ⇒ deferred — never 'searched'", () => {
  const missingExec = { ...EXEC, executed: EXEC.executed.slice(0, 2), missing: ["primary-sweep:default:mark"] };
  const f1 = deriveScopeFacts({ instructedScope: INSTRUCTED, plan: PLAN, planExecution: missingExec, coverageRows: [] });
  assert.equal(f1.per_class["5"].state, "unexecuted");
  assert.match(f1.coverage_line, /Classes 5 and 32: 2 of 3 searches completed — the remaining 1 did not complete/);

  const deferredExec = { ...EXEC, executed: EXEC.executed.slice(0, 2),
    deferred: [{ qid: "primary-sweep:default:mark", reason: "predicate not supported by the active register provider" }] };
  const f2 = deriveScopeFacts({ instructedScope: INSTRUCTED, plan: PLAN, planExecution: deferredExec, coverageRows: [] });
  assert.equal(f2.per_class["5"].state, "deferred");
  assert.equal(f2.per_class["5"].deferred, 1);
  assert.match(f2.per_class["5"].open_reasons[0], /not supported by the active register provider/,
    "the engine-vocabulary reason stays in the SIDECAR for the audit trail");
  // Spec B4: "provider gap" died as vendor-shaped language — a Latin-term capability gap reads as the
  // proportion plus plain "could not be searched"; engine/vendor vocabulary never reaches the line.
  assert.match(f2.coverage_line, /Classes 5 and 32: 2 of 3 searches completed — the remaining 1 could not be searched/);
  assert.doesNotMatch(f2.coverage_line, /provider|vendor|deferred|dispatch|enumerat|qid/i,
    "no vendor-shaped or engine vocabulary on the reader-facing line");
});

test("scope-facts: coverage-ledger gap rows join per class — structured classes[] wins, free text falls back", () => {
  const rows = [
    { axis: "primary-sweep", scope: "owner sweep", status: "coverage-limited", reason: "total_hits 805 exceeds the enumerate ceiling", classes: ["32"] },
    { axis: "incumbent-class", scope: "Cl. 5 incumbent shadow", status: "deferred", reason: "provider unavailable" },
    { axis: "primary-sweep", scope: "worldwide", status: "confirmed-clean", reason: "clean" },   // clean rows never become open_reasons
  ];
  const f = deriveScopeFacts({ instructedScope: INSTRUCTED, plan: PLAN, planExecution: EXEC, coverageRows: rows });
  assert.ok(f.per_class["32"].open_reasons.some((r) => /enumerate ceiling/.test(r)), "structured classes[] attributes the row to Cl.32");
  assert.ok(!f.per_class["5"].open_reasons.some((r) => /enumerate ceiling/.test(r)), "the Cl.32 row never smears onto Cl.5");
  assert.ok(f.per_class["5"].open_reasons.some((r) => /provider unavailable/.test(r)), "a legacy free-text 'Cl. 5' row still joins via the token scan");
});

test("scope-facts: degraded inputs stay honest — no plan ⇒ no coverage claim; no instructed classes ⇒ plan classes", () => {
  const noPlan = deriveScopeFacts({ instructedScope: INSTRUCTED, plan: null, planExecution: null, coverageRows: [] });
  assert.equal(noPlan.classes_line, "5, 32", "instructed classes still stated");
  assert.equal(noPlan.coverage_line, null, "no plan ⇒ NO coverage claim (never an invented one)");
  assert.equal(noPlan.per_class["5"].state, "unplanned");

  const noInstructed = deriveScopeFacts({ instructedScope: null, plan: PLAN, planExecution: EXEC, coverageRows: [] });
  assert.equal(noInstructed.classes_line, "5, 32", "plan nice_classes are the fallback");

  const nothing = deriveScopeFacts({});
  assert.equal(nothing.classes_line, null);
  assert.equal(nothing.coverage_line, null);
});

test("scope-facts: classes_line orders the coverage line numerically and never claims an unenumerated class as searched", () => {
  const plan = { ...PLAN, nice_classes: ["32", "5"], entries: PLAN.entries.map((e) => ({ ...e, nice_classes: e.nice_classes[0] === "25" ? e.nice_classes : ["32", "5"] })) };
  const exec = { executed: [{ qid: "primary-sweep:exact:markname", state: "enumerated" }], missing: [], skipped: [],
    deferred: [] };   // variant + default never joined a band → dispatched-not-enumerated territory
  const f = deriveScopeFacts({ instructedScope: { ...INSTRUCTED, classes: ["32", "5"] }, plan, planExecution: exec, coverageRows: [] });
  // collapsed identical per-class clauses onto one line, so the ordering property is now about the
  // CLASS LIST inside the head: 5 before 32, whatever order the instruction named them in.
  assert.match(f.coverage_line, /^Classes 5 and 32:/, "numeric order regardless of instructed order");
  assert.ok(!/(?:Class|Classes)[^:]*: searched/.test(f.coverage_line), "a class with un-joined dispatched slices is never a bare 'searched'");
  assert.match(f.coverage_line, /Classes 5 and 32: 1 of 3 searches completed — the remaining 2 did not complete/,
    "un-joined dispatched slices read fail-closed as not completed, with the proportion");
});

test("classTokensFromScopeText: explicit class markers only — hit counts and years never read as classes", () => {
  assert.deepEqual(classTokensFromScopeText("[cl 5,32] owner sweep"), ["5", "32"]);
  assert.deepEqual(classTokensFromScopeText("Class 30 leg unopened"), ["30"]);
  assert.deepEqual(classTokensFromScopeText("nice classes 5/32 and Cl. 25 merch"), ["5", "32", "25"]);
  assert.deepEqual(classTokensFromScopeText("total_hits 805 exceeds the 600 ceiling (2019 filing)"), [], "bare numbers are counts, not classes");
  assert.deepEqual(classTokensFromScopeText("class 99 out of range"), [], "Nice classes stop at 45");
});

// PR-11 — the masthead may not claim "searched" for a class whose every slice was gated out. A guard
// skip (the `when` parent came back a crowd) means nothing was dispatched for that class; the old
// fall-through read it as "executed" and printed "searched", which is the exact class of claim this
// module exists to stop. Wording is plain per spec B4 ("gated out by a crowd" was engine vocabulary);
// the fail-closed "not searched" lead stays.
test("scope-facts: a class whose every slice was guard-skipped reads 'not searched', never 'searched'", () => {
  const exec = { executed: [], missing: [], deferred: [], skipped: PLAN.entries.map((e) => ({ qid: e.qid, guard: "parent-crowd" })) };
  const f = deriveScopeFacts({ instructedScope: INSTRUCTED, plan: PLAN, planExecution: exec, coverageRows: [] });
  assert.equal(f.per_class["5"].state, "skipped");
  assert.equal(f.per_class["32"].state, "skipped");
  assert.match(f.coverage_line, /Classes 5 and 32: not searched — every planned search was skipped after a broader search came back crowded/);
  assert.ok(!/Class 5: searched/.test(f.coverage_line), "the bare 'searched' claim never appears for a skipped class");
});

// ── Spec B4 (2026-07-30) — the coverage line carries the proportion the join already computed ──────
// The module exists because a run once claimed "searched" over unexecuted slices; the available move
// is MORE accurate, never less alarming. A partial class states how many of its planned slices fully
// completed and, in plain language, what the remainder is — never a worst-state-wins engine word.

test("spec B4: a mostly-searched class reads the proportion + the script-form reason, verbatim", () => {
  // The B4 motivating shape: a class of 99 slices, 76 fully enumerated, the rest deferred because
  // their terms are non-Latin script forms. Synthetic, structure-copied from the real artifact shape.
  const entries = [];
  for (let i = 1; i <= 76; i++)
    entries.push({ qid: `primary-sweep:exact:t${i}`, axis: "primary-sweep", predicate: "exact", term: `TERM${i}`, nice_classes: ["5"], regions: ["us"] });
  for (let i = 1; i <= 23; i++)
    entries.push({ qid: `translit:exact:s${i}`, axis: "transliteration", predicate: "exact", term: `提基${i}`, nice_classes: ["5"], regions: ["us"] });
  const plan = { schema_version: 1, plan_version: 1, nice_classes: ["5"], regions: ["us"], entries };
  const exec = {
    executed: entries.slice(0, 76).map((e) => ({ qid: e.qid, state: "enumerated" })),
    missing: [], skipped: [],
    deferred: entries.slice(76).map((e) => ({ qid: e.qid, reason: "predicate not supported by the active register provider" })),
  };
  const f = deriveScopeFacts({ instructedScope: { ...INSTRUCTED, classes: [5] }, plan, planExecution: exec, coverageRows: [] });
  assert.equal(f.per_class["5"].total, 99);
  assert.equal(f.per_class["5"].deferred_script_forms, 23);
  assert.equal(f.coverage_line,
    "Class 5: 76 of 99 searches completed — the remaining 23 are non-Latin script forms · registers: US");
});

test("spec B4: a mixed remainder lists every bucket with its count, fail-closed rank first", () => {
  const mk = (i, extra = {}) => ({ qid: `primary-sweep:exact:m${i}`, axis: "primary-sweep", predicate: "exact", term: `TERM${i}`, nice_classes: ["9"], regions: ["us"], ...extra });
  const entries = [mk(1), mk(2), mk(3), mk(4), mk(5), mk(6), mk(7, { when: { runs_if_enumerated: "primary-sweep:exact:m1" } })];
  const plan = { schema_version: 1, plan_version: 1, nice_classes: ["9"], regions: ["us"], entries };
  const exec = {
    executed: [
      { qid: "primary-sweep:exact:m1", state: "enumerated" },
      { qid: "primary-sweep:exact:m2", state: "enumerated" },
      { qid: "primary-sweep:exact:m3", state: "enumerated" },
      { qid: "primary-sweep:exact:m4", state: "incomplete" },
    ],
    missing: ["primary-sweep:exact:m5"],
    deferred: [{ qid: "primary-sweep:exact:m6", reason: "predicate not supported by the active register provider" }],
    skipped: [{ qid: "primary-sweep:exact:m7", guard: "parent-crowd" }],
  };
  const f = deriveScopeFacts({ instructedScope: { ...INSTRUCTED, classes: [9] }, plan, planExecution: exec, coverageRows: [] });
  assert.equal(f.coverage_line,
    "Class 9: 3 of 7 searches completed — of the remaining 4, 1 did not complete, 1 could not be searched, "
    + "1 was skipped after a broader search came back crowded and 1 returned more records than could be listed in full"
    + " · registers: US");
});

test("spec B4: skipped slices beside enumerated ones no longer read bare 'searched' (stricter, never quieter)", () => {
  // Old behaviour: no missing/deferred/incomplete + ≥1 enumerated ⇒ state "executed" ⇒ bare
  // "searched", even with guard-skipped slices in the class. The proportion form closes that.
  const exec = {
    executed: [{ qid: "primary-sweep:exact:markname", state: "enumerated" }, { qid: "primary-sweep:exact:variant", state: "enumerated" }],
    missing: [], deferred: [],
    skipped: [{ qid: "primary-sweep:default:mark", guard: "parent-crowd" }],
  };
  const f = deriveScopeFacts({ instructedScope: INSTRUCTED, plan: PLAN, planExecution: exec, coverageRows: [] });
  assert.match(f.coverage_line,
    /Classes 5 and 32: 2 of 3 searches completed — the remaining 1 was skipped after a broader search came back crowded/);
  assert.ok(!/Class 5: searched/.test(f.coverage_line));
});

// §L jurisdiction ruling (Reviewer 2026-07-30): specific list OR worldwide, never both — "worldwide + EU
// US CH WO doesn't make sense". A worldwide token riding an instructed list collapses the tail.
test("jurisdiction tail: a worldwide token collapses the register list — never both", () => {
  const exec = { ...EXEC, executed: EXEC.executed.map((x) => ({ ...x, state: "enumerated" })) };
  const f = deriveScopeFacts({
    instructedScope: { ...INSTRUCTED, jurisdictions: ["Worldwide", "EU", "US", "CH", "WO"] },
    plan: { ...PLAN, regions: [] },   // archived worldwide shape: empty regions, no scope_basis flag
    planExecution: exec, coverageRows: [],
  });
  assert.match(f.coverage_line, /registers: worldwide$/);
  assert.doesNotMatch(f.coverage_line, /registers: .*(EU|US|CH|WO)/, "the named list never rides beside worldwide");
});

// ── post-merge audit 2 (d): crowd-context count descriptors leave the fully-searched denominator ────
// Shape-VERBATIM from a real 2026-07-29 archived run's stores (_driver/register-plan.json ×
// plan-execution.json), identity-scrubbed per this file's fixture rule. Per instructed class: 20
// expected_kind:"count" descriptors — every one taken, band state "incomplete" BY CONSTRUCTION (a
// count probe lists nothing, that is its whole job) — beside 107 enumerate slices of which 76
// enumerated, 3 genuinely overflowed their listing, 26 deferred (25 non-Latin script + 1 other) and
// 2 were guard-skipped. As delivered the line pooled the counts into the enumerate arithmetic:
// "…of the remaining 51, … 23 returned more records than could be listed in full" — false for 20 of
// the 23 — and bare "searched" was unreachable for ANY class carrying a count descriptor.
function ikShapedStores() {
  const entries = [], executed = [], deferred = [], skipped = [];
  for (let i = 0; i < 20; i++) {
    entries.push({ qid: `probe:count:${i}`, axis: i < 1 ? "saturation-probe" : "incumbent-class",
      predicate: i < 1 ? "default" : "owner", term: `CROWD${i}`, nice_classes: ["5", "32"], expected_kind: "count" });
    executed.push({ qid: `probe:count:${i}`, state: "incomplete" });
  }
  for (let i = 0; i < 107; i++) {
    const nonLatin = i >= 79 && i < 104;
    // i === 104 is the run's MIXED-script form chunk (the audit 2 (e) shape, as it stood in these
    // stores): terms not ALL non-Latin ⇒ entryIsNonLatinScript false ⇒ the deferred-other bucket.
    entries.push({ qid: `primary-sweep:exact:t${i}`, axis: "primary-sweep", predicate: "exact",
      ...(i === 104 ? { terms: ["FORMNEIGHBOUR", "词形"] } : { term: nonLatin ? `词形${i}` : `TERM${i}` }),
      nice_classes: ["5", "32"], expected_kind: "enumerate" });
    if (i < 76) executed.push({ qid: `primary-sweep:exact:t${i}`, state: "enumerated" });
    else if (i < 79) executed.push({ qid: `primary-sweep:exact:t${i}`, state: "incomplete" });
    else if (i <= 104) deferred.push({ qid: `primary-sweep:exact:t${i}`, reason: "capability-gap: term is not in Latin script" });
    else skipped.push({ qid: `primary-sweep:exact:t${i}`, guard: "primary-sweep:default:parent" });
  }
  return {
    instructedScope: { marks: ["MARKNAME"], classes: [5, 32], jurisdictions: null, goods: null, customer: null },
    plan: { schema_version: 1, plan_version: 1, nice_classes: ["5", "32"], regions: [], entries },
    planExecution: { executed, missing: [], skipped, deferred },
  };
}

test("audit 2 (d): count descriptors ride their own honest clause — never the searched denominator, never 'returned more records'", () => {
  const s = ikShapedStores();
  const f = deriveScopeFacts({ ...s, coverageRows: [] });
  for (const c of ["5", "32"]) {
    assert.equal(f.per_class[c].total, 127, "total stays the planned-work denominator, counts included");
    assert.equal(f.per_class[c].count_slices, 20);
    assert.equal(f.per_class[c].counts_taken, 20);
    assert.equal(f.per_class[c].incomplete, 3, "incomplete now means ENUMERATE slices that overflowed — the 20 by-construction count states left the bucket");
  }
  assert.match(f.coverage_line,
    /Classes 5 and 32: 76 of 107 searches completed — of the remaining 31, 1 could not be searched, 25 are non-Latin script forms, 2 were skipped after a broader search came back crowded and 3 returned more records than could be listed in full · 20 oversized result sets were counted rather than listed/,
    "the searched denominator is the enumerate slices; the counts get their own trailing clause");
  assert.ok(!/23 returned more records/.test(f.coverage_line),
    "the false phrasing — a count probe narrated as an overflowing enumeration — is dead");
});

test("audit 2 (d): bare 'searched' is reachable once every enumerate slice enumerates — counts stay disclosed, never quieter", () => {
  const s = ikShapedStores();
  // the healed shape: every enumerate slice enumerates; count descriptors keep their by-construction state
  const healed = {
    executed: s.plan.entries.map((e) => ({ qid: e.qid, state: e.expected_kind === "count" ? "incomplete" : "enumerated" })),
    missing: [], skipped: [], deferred: [],
  };
  const f = deriveScopeFacts({ instructedScope: s.instructedScope, plan: s.plan, planExecution: healed, coverageRows: [] });
  assert.match(f.coverage_line, /Classes 5 and 32: searched · 20 oversized result sets were counted rather than listed/,
    "the bare claim, with the crowd context still on the line");
  assert.equal(f.per_class["5"].state, "executed");
});

test("audit 2 (d): a count shortfall stays loud — 'N of M crowd-context counts taken', and a count-only class never claims searched", () => {
  const s = ikShapedStores();
  const healed = {
    executed: s.plan.entries
      .filter((e) => e.qid !== "probe:count:19")
      .map((e) => ({ qid: e.qid, state: e.expected_kind === "count" ? "incomplete" : "enumerated" })),
    missing: [], skipped: [], deferred: [],
  };
  const f = deriveScopeFacts({ instructedScope: s.instructedScope, plan: s.plan, planExecution: healed, coverageRows: [] });
  assert.match(f.coverage_line, /Classes 5 and 32: searched · 19 of 20 oversized result sets were counted rather than listed/, "a missing count is never narrated as taken");

  // counts alone are context, not coverage: the class keeps its fail-closed "not searched" wording
  const countsOnly = {
    instructedScope: { classes: [30] },
    plan: { entries: [{ qid: "probe:count:solo", axis: "saturation-probe", predicate: "default", term: "CROWD", nice_classes: ["30"], expected_kind: "count" }] },
    planExecution: { executed: [{ qid: "probe:count:solo", state: "incomplete" }], missing: [], skipped: [], deferred: [] },
  };
  const g = deriveScopeFacts({ ...countsOnly, coverageRows: [] });
  assert.match(g.coverage_line, /Class 30: not searched on the registers · 1 oversized result set was counted rather than listed/);
  assert.equal(g.per_class["30"].state, "dispatched", "taken counts are dispatched work — never 'executed', never 'unexecuted'");
});

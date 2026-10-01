// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Step 3 after the judges: code checks each answer, merges the two, and records what became of every owner
// of the pile — carried, set aside with the reason, shown and not taken up, or never shown. The pile is the
// invented fixture the owner table's own tests use; the answers are invented here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { loadPile } from "../pile.mjs";
import { buildOwnerTable } from "../owner-table.mjs";
import { checkAnswer, mergeJudgments, fateCounts, judgmentDiscardReason, FATES, ANSWER_FORM } from "../owner-judgment.mjs";
import { acceptedAttemptWindow, ownersLookedUp, recordOwnerIndex, judgmentSeam } from "../owner-judgment-run.mjs";
import { seamRows } from "../record-discard.mjs";
import { settleCoverageRowsFromFacts, coverageRowFacts } from "../coverage-form.mjs";
import { decisionAuditRows } from "../publish/audit-from-spine.mjs";
import { clearedNames } from "../publish/search-depth.mjs";

const PILE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "owner-pile");
const SCALE = { bands: [{ label: "High" }, { label: "Medium" }, { label: "Low" }] };
const pile = loadPile(PILE);
const table = buildOwnerTable(pile);
const ids = new Set(pile.records.map((r) => r.id));
const facts = { recordIds: ids, webUrls: new Set(["https://example.invalid/one"]), framework: SCALE };

const carry = (owners, records, rating, reason = "The same mark, live, in the order's classes.") => ({ owners, decision: "carry", records, rating, reason });
const aside = (owners, records, reason = "Different goods.") => ({ owners, decision: "set_aside", records, rating: "", reason });
const answer = (considered, overall = "High") => ({ considered, overall_rating: overall, advice: "Invented advice.", questions_wished_for: [] });
const judge = (n, a, { opening = [], looked = [] } = {}) => ({ judge: n, answer: a, opening: new Set(opening), looked: new Set(looked) });
const fateOf = (merged, key) => merged.fates.find((f) => f.key === key);

test("the fixture pile has the owners these arms are written against", () => {
  assert.deepEqual(table.rows.map((r) => r.key).sort(), ["owner late", "owner one", "owner three", "owner two"]);
});

test("the check: a clean answer passes, and each failure names itself", () => {
  const good = answer([carry(["Owner One K.K."], ["/mark/AA/0000-A1"], "High"), aside(["Owner Two GmbH"], ["/mark/CC/0000-C3"])]);
  assert.deepEqual(checkAnswer(good, facts), { ok: true, failures: [] });
  // a web address the run saved is held; one it never saved is not
  assert.equal(checkAnswer(answer([carry(["A web user"], ["https://example.invalid/one"], "Medium")]), facts).ok, true);
  const bad = checkAnswer(answer([
    carry([], ["/mark/ZZ/9999"], "Severe", ""),
    { owners: ["X"], decision: "maybe", records: [], rating: "", reason: "?" },
    aside(["Y"], [], "fine"),
  ], "Very High"), facts);
  assert.equal(bad.ok, false);
  for (const token of ["judgment_record_not_held:1:/mark/ZZ/9999", "judgment_carry_no_owner:1", "judgment_carry_no_reason:1",
    "judgment_rating_not_a_band:1:Severe", "judgment_decision_invalid:2", "judgment_overall_not_a_band:Very High"]) {
    assert.ok(bad.failures.includes(token), `missing ${token} in ${bad.failures.join(", ")}`);
  }
  assert.deepEqual(checkAnswer(null, facts).failures, ["judgment_no_answer"]);
  assert.deepEqual(checkAnswer({ overall_rating: "High" }, facts).failures, ["judgment_considered_missing"]);
});

test("the answer form is strict: every field required, nothing else accepted", () => {
  assert.equal(ANSWER_FORM.additionalProperties, false);
  assert.deepEqual(ANSWER_FORM.required, ["considered", "overall_rating", "advice", "questions_wished_for"]);
  const item = ANSWER_FORM.properties.considered.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required, ["owners", "decision", "records", "rating", "reason"]);
  assert.deepEqual(item.properties.decision.enum, ["carry", "set_aside"]);
});

test("carried by either is carried; set aside by both is set aside, with both reasons", () => {
  const m = mergeJudgments({ table, judges: [
    judge(1, answer([carry(["Owner One K.K."], ["/mark/AA/0000-A1"], "High"), aside(["Owner Two GmbH"], ["/mark/CC/0000-C3"], "Expired.")])),
    judge(2, answer([aside(["OWNER ONE"], ["/mark/BB/0000-B2"], "Pending only."), aside(["Owner Two"], [], "A dead filing.")])),
  ] });
  const one = fateOf(m, "owner one");
  assert.equal(one.fate, FATES.CARRIED);
  assert.deepEqual(one.by, [1]);
  const two = fateOf(m, "owner two");
  assert.equal(two.fate, FATES.SET_ASIDE);
  assert.deepEqual(two.reasons, [{ judge: 1, reason: "Expired." }, { judge: 2, reason: "A dead filing." }]);
  // the carried group keeps the other judge's dissent beside the carry, for synthesis to settle
  assert.equal(m.carried.length, 1);
  assert.deepEqual(m.carried[0].decisions.map((d) => [d.judge, d.decision]), [[1, "carry"], [2, "set_aside"]]);
  assert.deepEqual(m.carried[0].carried_by, [1]);
  assert.equal(m.carried[0].agreed, false);
  // the set-aside group is the owners nobody carried
  assert.equal(m.setAside.length, 1);
  assert.deepEqual(m.setAside[0].owners_in_the_pile.map((o) => o.owner), ["Owner Two GmbH"]);
  assert.deepEqual(m.setAside[0].set_aside_by, [1, 2]);
});

test("a decision naming a crowd of owners joins the other judge's decisions naming them one by one", () => {
  const m = mergeJudgments({ table, judges: [
    judge(1, answer([carry(["Owner One", "Owner Two"], [], "Medium", "Both hold the word in the order's classes.")])),
    judge(2, answer([carry(["Owner One K.K."], ["/mark/AA/0000-A1"], "High"), carry(["Owner Two GmbH"], ["/mark/CC/0000-C3"], "Medium")])),
  ] });
  assert.equal(m.carried.length, 1, "one group: the crowd decision and both one-by-one decisions name the same owners");
  const shown = (key) => table.byKey.get(key).row.owner;   // the name the table gives the owner, its most frequent spelling
  assert.deepEqual(m.carried[0].owners_in_the_pile.map((o) => o.owner).sort(), [shown("owner one"), shown("owner two")].sort());
  assert.deepEqual(m.carried[0].decisions.map((d) => d.judge), [1, 2, 2]);
  assert.equal(fateOf(m, "owner one").fate, FATES.CARRIED);
  assert.equal(fateOf(m, "owner two").fate, FATES.CARRIED);
});

test("differing ratings are both kept and passed on; agreeing ratings say so", () => {
  const differ = mergeJudgments({ table, judges: [
    judge(1, answer([carry(["Owner One"], ["/mark/AA/0000-A1"], "High")])),
    judge(2, answer([carry(["Owner One"], ["/mark/BB/0000-B2"], "Medium")])),
  ] });
  assert.deepEqual(differ.carried[0].ratings, [{ judge: 1, rating: "High" }, { judge: 2, rating: "Medium" }]);
  assert.equal(differ.carried[0].agreed, false);
  const agree = mergeJudgments({ table, judges: [
    judge(1, answer([carry(["Owner One"], ["/mark/AA/0000-A1"], "High")])),
    judge(2, answer([carry(["Owner One"], [], "High")])),
  ] });
  assert.equal(agree.carried[0].agreed, true);
  assert.deepEqual(agree.overall, [{ judge: 1, rating: "High" }, { judge: 2, rating: "High" }]);
});

test("every owner gets a fate: shown and not taken up, from the opening pages or a tool's answer, or never shown", () => {
  const m = mergeJudgments({ table, judges: [
    judge(1, answer([carry(["Owner One"], ["/mark/AA/0000-A1"], "High")]), { opening: ["owner one", "owner two"] }),
    judge(2, answer([aside(["Owner One"], [], "x")]), { opening: ["owner one", "owner two"], looked: ["owner three"] }),
  ] });
  assert.equal(fateOf(m, "owner one").fate, FATES.CARRIED);
  assert.deepEqual(fateOf(m, "owner two"), { key: "owner two", owner: "Owner Two GmbH", fate: FATES.SHOWN_NOT_TAKEN_UP, opening: [1, 2], looked: [] });
  assert.deepEqual(fateOf(m, "owner three").looked, [2]);
  assert.equal(fateOf(m, "owner late").fate, FATES.NEVER_SHOWN);
  const counts = fateCounts(m.fates);
  assert.equal(counts.owners, table.rows.length);
  assert.equal(counts.carried + counts.set_aside + counts.shown_not_taken_up + counts.never_shown, counts.owners, "every owner has exactly one fate");
});

test("the fate record: one discard row per record, and no record leaves without a reason", () => {
  const m = mergeJudgments({ table, judges: [
    judge(1, answer([carry(["Owner One"], ["/mark/AA/0000-A1"], "High"), aside(["Owner Two"], ["/mark/CC/0000-C3"], "Expired.")]), { opening: ["owner three"] }),
  ] });
  const seam = judgmentSeam(m, recordOwnerIndex(table));
  const saw = pile.records.map((r) => ({ uri: r.id }));
  const rows = seamRows({ seam: "judgment", stage: "owner-judgment", saw,
    carried: saw.filter((r) => seam.isCarried(r.uri)),
    reasonFor: (_rec, uri) => seam.reasonFor(uri) });
  assert.equal(rows.length, pile.records.length, "one row per record of the pile");
  const byUri = new Map(rows.map((r) => [r.uri, r]));
  const rowOf = (id) => byUri.get(id.toLowerCase()) ?? byUri.get(id);
  assert.equal(rowOf("/mark/AA/0000-A1")?.verdict, "carried", "the record the judge cited is carried");
  // …and the carried owner's records the judge did NOT cite are not carried: the writer is handed only the
  // cited ones, so each of these leaves with a reason code holds.
  const uncited = pile.records.filter((r) => recordOwnerIndex(table)(r.id) === "owner one" && r.id !== "/mark/AA/0000-A1");
  assert.ok(uncited.length >= 1, "the fixture's carried owner holds a record the judge did not cite");
  for (const r of uncited) {
    assert.equal(rowOf(r.id)?.verdict, "discarded");
    assert.equal(rowOf(r.id)?.reason, "judgment:owner-carried-on-other-records");
    assert.equal(rowOf(r.id)?.reason_source, "step-structural");
  }
  for (const r of rows.filter((x) => x.verdict === "discarded")) {
    assert.notEqual(r.reason_source, "absent", `${r.uri} left with no reason`);
    assert.match(r.reason, /^judgment:(set-aside|not-taken-up|never-shown|owner-carried-on-other-records)$/);
  }
  const reasons = new Set(rows.filter((x) => x.verdict === "discarded").map((x) => `${x.reason}/${x.reason_source}`));
  assert.ok(reasons.has("judgment:set-aside/step-stated"));
  assert.ok(reasons.has("judgment:not-taken-up/step-silent"));
  assert.ok(reasons.has("judgment:never-shown/step-structural"));
  assert.equal(judgmentDiscardReason(undefined).reason_source, "absent", "an owner with no fate is the one case that reads as absent");
});

test("only the accepted attempt's reads count as shown: a failed attempt's, and the other judge's, do not", () => {
  const dir = mkdtempSync(join(tmpdir(), "judge-reads-"));
  try {
    mkdirSync(join(dir, "_driver"), { recursive: true });
    const t = (s) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
    writeFileSync(driverDir(dir, "owner-judgment:1.jsonl"), [
      { ts: t(10), attempt: 1, fail: "judgment_record_not_held:1:x" },
      { ts: t(30), attempt: 2, fail: null },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(join(dir, "_driver", "reading-log.jsonl"), [
      { ts: t(5), session: "s-1", owner_keys_shown: ["owner two"] },           // the failed attempt
      { ts: t(20), session: "s-1", owner_keys_shown: ["owner one"] },          // the accepted attempt
      { ts: t(25), session: "s-1", shown: ["/mark/CC/0000-C3"] },              // the accepted attempt, by record
      { ts: t(22), session: "s-2", owner_keys_shown: ["owner three"] },        // the other judge
    ].map((r) => JSON.stringify(r)).join("\n") + "\n");
    const window = acceptedAttemptWindow(dir, "owner-judgment:1");
    assert.equal(window.attempt, 2);
    const seen = ownersLookedUp(dir, { session: "s-1", window, keyOfRecord: recordOwnerIndex(table) });
    assert.deepEqual([...seen].sort(), ["owner one", "owner two"]);
    assert.ok(!seen.has("owner three"), "the other judge's reads are its own");
    // owner two is counted through the record the accepted attempt listed, not through the failed one's page
    const onlyFailed = ownersLookedUp(dir, { session: "s-1", window: { from: -Infinity, to: Date.parse(t(10)) }, keyOfRecord: recordOwnerIndex(table) });
    assert.deepEqual([...onlyFailed], ["owner two"]);
    assert.equal(acceptedAttemptWindow(dir, "owner-judgment:2"), null, "a judge with no accepted attempt has no window");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the coverage form is settled from each row's own facts, in the ledger's own words", () => {
  const rows = [
    { kind: "axis", axis: "primary-sweep", open: false, status: null },
    { kind: "block", axis: "primary-sweep", open: true, total_hits: 1200, unaccounted_classes: ["9"], status: null },
    { kind: "axis", axis: "phonetic", open: false, status: null },
    { kind: "deferred", axis: "phonetic", open: true, receipt_reason: "the provider cannot express it", status: null },
    { kind: "family", axis: "phonetic", open: true, status: null },
    { kind: "family", axis: "phonetic", open: true, status: "withheld-by-judgment", reason: "the list answered it" },
    { kind: "axis", axis: "translit", skeleton_state: "executed", open: false, status: null },
    { kind: "axis", axis: "incumbent", open: true, status: null },
  ];
  const settled = settleCoverageRowsFromFacts(rows);
  assert.deepEqual(settled.map((r) => r.status), ["coverage-limited", "coverage-limited", "coverage-limited", "deferred", null, "withheld-by-judgment", "confirmed-clean", "deferred"]);
  assert.equal(settled[1].reason, "1200 hits; classes unaccounted: 9");
  assert.equal(settled[3].reason, "receipt: the provider cannot express it");
  assert.equal(settled[5].reason, "the list answered it", "a row already settled keeps its ruling");
  assert.equal(coverageRowFacts({}), "");
});

test("coverage settled by code: an axis is clean only where its slices ran and were read", () => {
  // The never-searched states a clean claim was always refused over (register-plan.mjs,
  // findUnexecutedCleanClaims). Code writes the statuses now, so code must never write a clean over them.
  const axis = (axisName, state) => ({ kind: "axis", axis: axisName, skeleton_state: state, open: false, status: null });
  const family = (axisName, status) => ({ kind: "family", axis: axisName, open: true, status, reason: status ? "the question is answered" : null });
  const rows = [
    axis("ran", "executed"),
    axis("never-ran", "unexecuted"),
    axis("skipped", "skipped"),
    axis("waiting-withheld", "awaiting-judgment"), family("waiting-withheld", "withheld-by-judgment"),
    axis("waiting-open", "awaiting-judgment"), family("waiting-open", "withheld-by-judgment"), family("waiting-open", null),
    axis("torn", "executed"),
  ];
  const byAxis = (out) => Object.fromEntries(out.filter((r) => r.kind === "axis").map((r) => [r.axis, r.status]));
  assert.deepEqual(byAxis(settleCoverageRowsFromFacts(rows, { bandsUnreadable: ["torn"] })), {
    "ran": "confirmed-clean",
    "never-ran": "deferred",
    "skipped": "coverage-limited",
    "waiting-withheld": "withheld-by-judgment",
    "waiting-open": "deferred",
    "torn": "deferred",
  });
  // The control: the same torn axis, with its band readable, is clean — it is the unreadable band that
  // keeps it from a clean, not the arm's other rows.
  assert.equal(byAxis(settleCoverageRowsFromFacts(rows)).torn, "confirmed-clean");
  // An axis minted from a stray unit file has no search behind it: deferred, never clean.
  const stray = [axis("stray-notes", null)];
  assert.equal(byAxis(settleCoverageRowsFromFacts(stray, { unknownAxes: ["stray-notes"] }))["stray-notes"], "deferred");
  // A count the plan asked for leaves no open block row, by doctrine, so its axis is clean; and an axis with
  // no skeleton state is one the plan put no question to, so nothing was owed on it. Neither is a limit.
  assert.deepEqual(byAxis(settleCoverageRowsFromFacts([axis("counted", "incomplete"), axis("asked-nothing", null)])),
    { "counted": "confirmed-clean", "asked-nothing": "confirmed-clean" });
});

test("the audit's register rows: carried owners as findings, set-aside owners as the 'also considered' names", () => {
  const m = mergeJudgments({ table, judges: [judge(1, answer([
    carry(["Owner One K.K."], ["/mark/AA/0000-A1"], "High"),
    aside(["Owner Two GmbH"], ["/mark/CC/0000-C3"], "Expired."),
  ]))] });
  const recordFacts = (id) => {
    const r = pile.recordById.get(id);
    return r ? { mark: r.mark, owner: r.owner, country: r.ownerCountry, office: r.office, classes: r.classes, status: r.status, filed: r.filed, screenVerdict: "drop:dead" } : null;
  };
  const { findings, negatives } = decisionAuditRows({ decisions: { carried: m.carried, set_aside: m.setAside }, recordFacts });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "ZZMARK");
  assert.equal(findings[0].owner, "Owner One K.K.");
  assert.equal(findings[0].key_factors, "judge 1: High");
  assert.match(findings[0].description, /^judge 1: The same mark/);
  assert.equal(negatives.length, 1);
  // the shape the report's "also considered" list reads, read back by its own reader
  const audit = `# Negative results\n\n## NR1\n${Object.entries(negatives[0]).filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n`;
  const cleared = clearedNames(audit, {});
  assert.equal(cleared.register.length, 1);
  assert.equal(cleared.register[0].uri, "/mark/CC/0000-C3");
  assert.equal(cleared.register[0].group, "dead-filing");
});

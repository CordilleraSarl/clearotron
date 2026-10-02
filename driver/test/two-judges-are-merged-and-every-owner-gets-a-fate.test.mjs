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
import { acceptedAttemptWindow, ownersLookedUp, recordOwnerIndex, judgmentSeam, judgesForPass, judgeOutcomes } from "../owner-judgment-run.mjs";
import { seamRows } from "../record-discard.mjs";
import { settleCoverageRowsFromFacts, coverageRowFacts, coverageFormRows, renderCoverageLedgerJsonFromForm, NOT_ASKED } from "../coverage-form.mjs";
import { decisionAuditRows } from "../publish/audit-from-spine.mjs";
import { clearedNames } from "../publish/search-depth.mjs";
import { pickingExits } from "../hand-off-exits.mjs";

const PILE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "owner-pile");
const SCALE = { bands: [{ label: "High" }, { label: "Medium" }, { label: "Low" }] };
const pile = loadPile(PILE);
const table = buildOwnerTable(pile);
const ids = new Set(pile.records.map((r) => r.id));
const facts = { recordIds: ids, webUrls: new Set(["https://example.invalid/one"]), framework: SCALE };

const carry = (owners, records, rating, reason = "The same mark, live, in the order's classes.", reads = { marks_alike: "same", goods_close: "same" }) => ({ owners, decision: "carry", records, rating, ...reads, reason });
const aside = (owners, records, reason = "Different goods.") => ({ owners, decision: "set_aside", records, rating: "", marks_alike: "close", goods_close: "different", reason });
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
  assert.deepEqual(item.required, ["owners", "decision", "records", "rating", "marks_alike", "goods_close", "reason"]);
  assert.deepEqual(item.properties.decision.enum, ["carry", "set_aside"]);
  // The two reads (owner, 2026-10-02): exactly the values he named, described as `decision` is, by its values.
  assert.deepEqual(item.properties.marks_alike.enum, ["same", "close", "different"]);
  assert.deepEqual(item.properties.goods_close.enum, ["same", "overlapping", "different"]);
  assert.equal(item.properties.marks_alike.description, "`same`, `close` or `different`.");
  assert.equal(item.properties.goods_close.description, "`same`, `overlapping` or `different`.");
});

test("the check names a read that is not one of its values, on a carried owner and a set-aside one alike", () => {
  // Saved and mocked answers never pass the program's schema, so the check is what refuses them.
  const bad = checkAnswer(answer([
    carry(["Owner One K.K."], ["/mark/AA/0000-A1"], "High", "The same mark.", { marks_alike: "similar", goods_close: "same" }),
    { ...aside(["Owner Two GmbH"], ["/mark/CC/0000-C3"]), goods_close: undefined },
  ]), facts);
  assert.deepEqual(bad.failures, ["judgment_marks_alike_not_a_choice:1:similar", "judgment_goods_close_not_a_choice:2:"]);
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
  assert.deepEqual(differ.carried[0].ratings, [{ judge: 1, rating: "High", marks_alike: "same", goods_close: "same" },
    { judge: 2, rating: "Medium", marks_alike: "same", goods_close: "same" }], "each judge's two reads travel beside that judge's rating");
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
    assert.match(r.reason, /^judgment:(set-aside|seen-not-raised|never-shown|owner-carried-on-other-records)$/);
  }
  const reasons = new Set(rows.filter((x) => x.verdict === "discarded").map((x) => `${x.reason}/${x.reason_source}`));
  assert.ok(reasons.has("judgment:set-aside/step-stated"));
  assert.ok(reasons.has("judgment:seen-not-raised/step-structural"));
  assert.ok(reasons.has("judgment:never-shown/step-structural"));
  // AN OWNER SEEN AND RAISED BY NEITHER IS A DECISION WITH A REASON, NOT A SILENCE (design ruling,
  // 2026-10-01): no record leaves the judges with no ground, so the hand-off count of such exits is zero.
  assert.equal(rows.filter((x) => x.verdict === "discarded" && x.reason_source === "step-silent").length, 0,
    "a record shown to the judges and raised by neither still leaves as a silence");
  assert.equal(pickingExits({ rows: rows.map((r) => ({ ...r, stopped_at: r.verdict === "discarded" ? "judgment" : null })) }).exits, 0,
    "the hand-off count still finds records that left the judges with no ground");
  const seen = rows.find((x) => x.reason === "judgment:seen-not-raised");
  assert.match(seen.detail, /^seen by (both judges|judge \d), raised by neither$/);
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
  // A count the plan asked for leaves no open block row, by doctrine, so its axis is clean when the count came
  // back with a number. An axis with no skeleton state is one the plan put no question to: nothing was owed
  // and nothing was searched, so it is NOT ASKED (owner, 2026-10-01) — never clean, and never a limit.
  assert.deepEqual(byAxis(settleCoverageRowsFromFacts([axis("counted", "incomplete"), axis("asked-nothing", null)])),
    { "counted": "confirmed-clean", "asked-nothing": NOT_ASKED });
  // CLEAN ONLY ON POSITIVE EVIDENCE. A planned count that came back with no number says nothing about the
  // crowd it was to count, and a state the rule does not name is no evidence of anything.
  assert.deepEqual(byAxis(settleCoverageRowsFromFacts([
    { ...axis("count-not-taken", "incomplete"), counts_not_taken: ["sat:count:1"] },
    axis("unheard-of", "some-state-no-builder-writes"),
  ])), { "count-not-taken": "deferred", "unheard-of": "deferred" });
});

test("the audit's register rows: carried owners as findings, set-aside owners as the 'also considered' names", () => {
  const m = mergeJudgments({ table, judges: [judge(1, answer([
    carry(["Owner One K.K."], ["/mark/AA/0000-A1"], "High"),
    aside(["Owner Two GmbH"], ["/mark/CC/0000-C3"], "Expired."),
  ]))] });
  const recordFacts = (id) => {
    const r = pile.recordById.get(id);
    return r ? { mark: r.mark, owner: r.owner, country: r.ownerCountry, office: r.office, classes: r.classes, status: r.status, filed: r.filed, expiry: "2031-01-01", screenVerdict: "drop:dead" } : null;
  };
  const { findings, negatives } = decisionAuditRows({ decisions: { carried: m.carried, set_aside: m.setAside }, recordFacts });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "ZZMARK");
  assert.equal(findings[0].owner, "Owner One K.K.");
  assert.equal(negatives.length, 1);
  // the shape the report's "also considered" list reads, read back by its own reader
  const audit = `# Negative results\n\n## NR1\n${Object.entries(negatives[0]).filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n`;
  const cleared = clearedNames(audit, {});
  assert.equal(cleared.register.length, 1);
  assert.equal(cleared.register[0].uri, "/mark/CC/0000-C3");
  assert.equal(cleared.register[0].group, "dead-filing");
});

// The workbook is linked from the report and readable by a client's account, and nothing new reaches a
// client in this phase (owner, 2026-10-01): its rows keep the cells and the words the old register rows
// had. Each judge's reason and rating stays in the run's record.
test("the audit's register rows carry the record's facts and nothing a judge wrote, in the old rows' shape", () => {
  const m = mergeJudgments({ table, judges: [
    judge(1, answer([carry(["Owner One K.K."], ["/mark/AA/0000-A1"], "High"), aside(["Owner Two GmbH"], ["/mark/CC/0000-C3"], "Expired.")])),
    judge(2, answer([carry(["Owner One K.K."], ["/mark/AA/0000-A1"], "Medium"), aside(["Owner Two GmbH"], ["/mark/CC/0000-C3"], "Lapsed long ago.")])),
  ] });
  const recordFacts = (id) => {
    const r = pile.recordById.get(id);
    return r ? { mark: r.mark, owner: r.owner, country: r.ownerCountry, office: r.office, classes: ["9", "42"], status: "REGISTERED", filed: "2020-02-02", registered: "2021-03-03", expiry: "2031-01-01", screenVerdict: "drop:dead" } : null;
  };
  const decisions = { carried: m.carried, set_aside: m.setAside };
  const { findings, negatives } = decisionAuditRows({ decisions, recordFacts });
  const cells = [...findings, ...negatives].flatMap((row) => Object.values(row)).join(" | ");
  for (const word of ["judge", "High", "Medium", "The same mark", "Expired.", "Lapsed long ago."])
    assert.ok(!cells.includes(word), `a judge's words reached the workbook: ${word}`);
  for (const row of [...findings, ...negatives])
    for (const read of ["marks_alike", "goods_close"]) assert.ok(!(read in row), `a judge's read reached the workbook: ${read}`);
  assert.equal(findings[0].dates, "Filed 2020-02-02; Expiry 2031-01-01", "the dates read as the old rows read them");
  assert.equal(findings[0].description, "");
  assert.equal(findings[0].key_factors, "");
  assert.equal(negatives[0].platform, "", "a register negative's Platform cell stays empty, as the old rows left it");
  assert.equal(negatives[0].result, "");
  assert.equal(negatives[0].notes, "URI /mark/CC/0000-C3; screen_verdict=drop:dead; class=9, 42; status=REGISTERED", "the Notes cell in the old order");
  // A decision resting on web pages alone is no register row, carried or set aside.
  const web = decisionAuditRows({ decisions: {
    carried: [{ owners: ["Web Only Ltd"], records: [], web: ["https://example.test/shop"], ratings: [{ judge: 1, rating: "High" }], decisions: [] }],
    set_aside: [{ owners: ["Web Too Ltd"], records: [], web: ["https://example.test/other"], decisions: [] }],
  }, recordFacts });
  assert.deepEqual(web, { findings: [], negatives: [] });
});

// ── TWO JUDGES ON THE FIRST PASS, ONE ON A RE-RUN, AND A JUDGE'S LAST ACCEPTED ANSWER STANDS ───────────────
//
// The owner's ruling of 2026-10-01. A re-run judges the changed table with one judge and merges it with the
// other's last accepted answer; a judge that loses every attempt of a re-run keeps its earlier answer in the
// merge, because the gateway deletes a stage's output before each attempt and the merge used to take only
// what this pass produced.
test("a first pass dispatches both judges; a re-run dispatches one, the one without an answer or with the oldest", () => {
  const at = (ts) => ({ ts, answer: { considered: [] } });
  assert.deepEqual(judgesForPass({ trigger: "fresh", accepted: [at("2026-01-01T00:00:01Z"), at("2026-01-01T00:00:02Z")] }), [1, 2]);
  assert.deepEqual(judgesForPass({ trigger: "experiment", accepted: [null, null] }), [1, 2]);
  assert.deepEqual(judgesForPass({ trigger: "settlement-flush", accepted: [null, null] }), [1, 2], "nothing accepted yet: this is a first pass");
  assert.deepEqual(judgesForPass({ trigger: "settlement-flush", accepted: [at("2026-01-01T00:00:01Z"), at("2026-01-01T00:00:02Z")] }), [1]);
  assert.deepEqual(judgesForPass({ trigger: "stale-repair", accepted: [at("2026-01-01T00:00:03Z"), at("2026-01-01T00:00:02Z")] }), [2], "the older answer is the one re-judged");
  assert.deepEqual(judgesForPass({ trigger: "late-bind", accepted: [at("2026-01-01T00:00:01Z"), null] }), [2], "a judge with no answer comes first");
});

test("a judge that loses every attempt of a re-run keeps its earlier answer, and the owners only it carried stay carried", () => {
  const earlier = (n, carries) => ({ ts: "2026-01-01T00:00:00Z", answer: answer(carries), opening: new Set(), looked: new Set([`k${n}`]) });
  const accepted = {
    1: earlier(1, [carry(["Owner One K.K."], ["/mark/AA/0000-A1"], "High")]),
    2: earlier(2, [carry(["Owner Two GmbH"], ["/mark/CC/0000-C3"], "Medium")]),
  };
  // The re-run dispatches judge 2 only, and its every attempt fails: the gateway left no output to read.
  const outcomes = judgeOutcomes({ dispatch: [2], results: () => ({ ok: false, fail: "status_error", attempts: 3 }),
    accepted: (n) => accepted[n], answerOf: () => ({ fail: "judgment_no_answer" }), shownOf: () => ({ opening: new Set(), looked: new Set() }) });
  assert.deepEqual(outcomes.map((o) => [o.judge, o.ran, o.ok, o.answer_from, o.fail]),
    [[1, false, true, "an earlier pass", null], [2, true, true, "an earlier pass", "status_error"]]);
  const merged = mergeJudgments({ table, judges: outcomes.filter((o) => o.ok) });
  const carriedOwners = merged.carried.flatMap((g) => g.owners);
  assert.ok(carriedOwners.includes("Owner Two GmbH"), "the owner only the failed judge had carried lost 'carried'");
  assert.ok(carriedOwners.includes("Owner One K.K."), "the judge this pass did not run lost its carries");
  // The same pass, measured the way the merge used to be fed — only the answers this pass produced — drops it.
  assert.equal(outcomes.filter((o) => o.ran && !o.fail).length, 0, "premise: this pass produced no answer at all");
});

test("a judge that answers on a re-run gives this pass's answer, with the owners this pass showed it", () => {
  const kept = { ts: "2026-01-01T00:00:00Z", answer: answer([]), opening: new Set(["old"]), looked: new Set() };
  const fresh = answer([carry(["Owner One K.K."], ["/mark/AA/0000-A1"], "High")]);
  const [one, two] = judgeOutcomes({ dispatch: [1], results: () => ({ ok: true, attempts: 1 }), accepted: () => kept,
    answerOf: () => ({ answer: fresh }), shownOf: () => ({ opening: new Set(["new"]), looked: new Set(["seen"]) }) });
  assert.equal(one.answer_from, "this pass");
  assert.deepEqual([...one.opening], ["new"]);
  assert.equal(two.answer_from, "an earlier pass");
  assert.deepEqual([...two.opening], ["old"], "a judge this pass did not run is merged with what its own session was shown");
  // A judge stage freshness skipped stands on the answer it gave before.
  const [skipped] = judgeOutcomes({ dispatch: [1], results: () => ({ ok: true, skipped: true }), accepted: () => kept,
    answerOf: () => ({ answer: fresh }), shownOf: () => ({ opening: new Set(["new"]), looked: new Set() }) });
  assert.equal(skipped.answer, kept.answer);
  assert.equal(skipped.answer_from, "an earlier pass");
});

test("the axis row carries each planned count that came back with no number, and a not-asked axis reaches no ledger", () => {
  const plan = { entries: [
    { qid: "sat:count:1", axis: "saturation-probe", expected_kind: "count", terms: ["ZZ"] },
    { qid: "sat:count:2", axis: "saturation-probe", expected_kind: "count", terms: ["ZZQ"] },
    { qid: "ps:exact:1", axis: "primary-sweep", terms: ["ZZ"] },
  ] };
  const skeleton = [{ axis: "saturation-probe", state: "incomplete" }, { axis: "primary-sweep", state: "executed" }];
  const bandBlocksByAxis = {
    // As the executor writes a count it took, and one that came back with no number.
    "saturation-probe": [{ qid: "sat:count:1", state: "incomplete", total_hits: 412 }, { qid: "sat:count:2", state: "incomplete", total_hits: null }],
    "primary-sweep": [{ qid: "ps:exact:1", state: "enumerated", total_hits: 3, records: [] }],
  };
  const { rows } = coverageFormRows({ skeleton, plan, bandBlocksByAxis, activeAxes: ["incumbent-class"] });
  const axisRow = (a) => rows.find((r) => r.kind === "axis" && r.axis === a);
  assert.deepEqual(axisRow("saturation-probe").counts_not_taken, ["sat:count:2"]);
  assert.equal(axisRow("primary-sweep").counts_not_taken, undefined, "a sweep that listed its records owes nothing");
  const settled = settleCoverageRowsFromFacts(rows);
  const status = (a) => settled.find((r) => r.kind === "axis" && r.axis === a).status;
  assert.equal(status("saturation-probe"), "deferred", "an axis settled clean over a count that never came back");
  assert.equal(status("primary-sweep"), "confirmed-clean");
  assert.equal(status("incumbent-class"), NOT_ASKED, "an axis the plan asked nothing of read as something");
  // The machine ledger, which every reader of coverage takes, carries no not-asked row.
  const ledger = JSON.parse(renderCoverageLedgerJsonFromForm(settled, () => []));
  assert.deepEqual(ledger.map((r) => r.axis).sort(), ["primary-sweep", "saturation-probe"]);
});

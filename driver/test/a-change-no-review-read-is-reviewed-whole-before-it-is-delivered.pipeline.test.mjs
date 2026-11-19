// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEW AFTER A DELIVERY-CHECK REPAIR, END TO END ON THE MOCK PIPELINE, ON BOTH ENGINES: A CHANGE NO REVIEW READ IS
// REVIEWED WHOLE BEFORE IT IS DELIVERED, ON A RESUME TOO, AND THE RULE THAT DECIDES WHEN THE REVIEW CAN BE NARROWED.
// Its setup is shared with the other two review-after-a-repair files in `review-after-repair-harness.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { synthesisCallPaths } from "../synthesis-record.mjs";
import { repairBasePath, writePostRepairRecord } from "../repair-scope.mjs";
import { tempDir, ENGINES, runPipeline, stageEvents, dispatches, WHOLE_CORRECTION_OPENS, codenameOf } from "./review-after-repair-harness.mjs";

test("a narrative repair whose review is refused, on a stage that still reads ok, is reviewed whole before it is delivered", async () => {
  // The refused call leaves the earlier review's file standing, so the stage reads ok: only the accepted call counts.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_POST_REPAIR_FLAGS: "[]", MOCK_POST_REPAIR_VERDICT: "BLOCKING" });
  const reads = events.filter((e) => e.event === "post-repair-review");
  assert.deepEqual(reads.map((e) => [e.read, e.whole ?? false]), [[false, false], [true, true]], `the two reads: ${JSON.stringify(reads)}`);
  assert.equal(JSON.parse(readFileSync(driverDir(res.runDir, "post-repair-review.json"), "utf8")).status, "read");
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
});

// A CHANGE AN EARLIER PASS LEFT UNREVIEWED, ON A RUN THAT STOPPED BEFORE DELIVERY FOR ANOTHER CAUSE. A run is never
// held on an unread review, so only a stop for some other cause leaves such a change to a resume: pass 1 stops at the
// report overview, after the first full review, and the record an earlier repair would have left is written beside
// it, with the mock's mark that the narrowed review of that repair went unread.
const STOP_AT_OVERVIEW = "record_report_overview";
async function stoppedWithAnUnreadChange(engine) {
  // A recovery park: an overview failure whose recovery is spent is delivered without the overview, so pass 1 is given the
  // one park it takes, and the stage it stopped at is the one its status records.
  const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_FAIL_STAGE: STOP_AT_OVERVIEW, CLEAROTRON_RECOVERY_MAX: "1" }, engine);
  assert.notEqual(res.ok, true, "premise: pass 1 stopped before delivery");
  const stoppedAt = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8")).failedStage;
  assert.equal(stoppedAt, "report-overview", `premise: pass 1 stopped at the overview, after the first full review (stopped at ${stoppedAt})`);
  writePostRepairRecord(res.runDir, { status: "unread", whole: true, findingOnly: false, fail: "no-accepted-call" });
  writeFileSync(`${res.runDir}.mock-post-repair-unread`, "1\n");
  return { res, events };
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a resume's whole review that is refused does not mark the unreviewed change read, and the resume still delivers`, async () => {
    const { res: r1, events: e1 } = await stoppedWithAnUnreadChange(engine);
    const codename = codenameOf(r1.runDir);
    // The resume runs no repair of its own: the record queues the reviewer, and its whole review is a call the tool
    // refuses, on a stage that reads ok on the earlier review's file.
    const { res: r2, events: all2 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_POST_REPAIR_UNREAD: "narrowed", MOCK_WHOLE_FALLBACK_FLAGS: "[]",
      MOCK_WHOLE_FALLBACK_VERDICT: "BLOCKING" }, engine, { codename });
    const e2 = all2.slice(e1.length);   // the run log carries every pass: this one's rows only
    assert.ok(e2.some((e) => e.event === "post-repair-review-queued" && /went unreviewed/.test(e.why)), "premise: the record queued the reviewer");
    assert.equal(stageEvents(e2, "synthesis", "lint-repair").length, 0, "premise: the resume ran no repair of its own");
    assert.ok(stageEvents(e2, "narrative-refutation", "stale-repair").some((e) => e.ok === true), "premise: the whole review's stage read ok");
    assert.equal(JSON.parse(readFileSync(driverDir(r2.runDir, "post-repair-review.json"), "utf8")).status, "unread",
      "a whole review the tool refused marked the change read");
    // …and the resume delivers all the same: a run is never held on an unread review. A whole review that is read
    // closes the record (the next test).
    assert.ok(!e2.some((e) => e.event === "delivery-stale-blocked"), "the guard held the resume");
    assert.equal(r2.ok, true, JSON.stringify(r2).slice(0, 300));
  });
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a resume's whole review of an unreviewed change sends its flags to the one correction`, async () => {
    const { res: r1, events: e1 } = await stoppedWithAnUnreadChange(engine);
    const flags = [{ kind: "fact", text: "An invented point the resumed whole review raised about the repaired narrative." }];
    const { res: r2, events: all2 } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_POST_REPAIR_UNREAD: "narrowed", MOCK_WHOLE_FALLBACK_FLAGS: JSON.stringify(flags) },
      engine, { codename: codenameOf(r1.runDir) });
    const e2 = all2.slice(e1.length);
    assert.deepEqual(e2.filter((e) => e.event === "post-repair-review").map((e) => [e.read, e.whole ?? false]), [[true, true]], "the resume's review is not the whole review, read once");
    assert.equal(stageEvents(e2, "synthesis", "post-repair-corrective").length, 1, "the whole review's flags went to no correction");
    const msg = dispatches(r2.runDir, "synthesis").find((m) => m.includes(WHOLE_CORRECTION_OPENS) && m.includes(flags[0].text));
    assert.ok(msg, "the correction does not carry the whole review's flag");
    assert.ok(e2.some((e) => e.event === "verdict-hardened-by-repair" && e.now === "CONDITIONAL"), "its verdict never reached the late-review rule");
    const rec = JSON.parse(readFileSync(driverDir(r2.runDir, "post-repair-review.json"), "utf8"));
    assert.equal(rec.status, "read");
    assert.equal(rec.findingOnly, false, "the resume relabelled a narrative change as a change to the findings alone");
    assert.equal(r2.ok, true, JSON.stringify(r2).slice(0, 300));
  });
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a change no review read is reviewed whole on a resume, even when the resume's own repair could be narrowed`, async () => {
    const { res: r1, events: e1 } = await stoppedWithAnUnreadChange(engine);
    assert.equal(JSON.parse(readFileSync(driverDir(r1.runDir, "post-repair-review.json"), "utf8")).status, "unread", "premise: the change is on record unreviewed");
    // Between the passes the record's first finding gains a search count in its own sentence, so the resume's delivery
    // check sends a fault of its own to the writer, and that repair alone could be reviewed narrowed.
    const SENTENCE = " The search ran 14 queries across the register.";
    const { accepted } = synthesisCallPaths(r1.runDir);
    const acc = JSON.parse(readFileSync(accepted, "utf8"));
    acc.params.findings.findings[0].net = `${acc.params.findings.findings[0].net}${SENTENCE}`;
    writeFileSync(accepted, JSON.stringify(acc, null, 2) + "\n");
    const fj = JSON.parse(readFileSync(join(r1.runDir, "findings.json"), "utf8"));
    fj.findings[0].net = `${fj.findings[0].net}${SENTENCE}`;
    writeFileSync(join(r1.runDir, "findings.json"), JSON.stringify(fj, null, 2) + "\n");
    const { res: r2, events: all2 } = await runPipeline({ MOCK_VERDICT: "CLEAR" }, engine, { codename: codenameOf(r1.runDir) });
    const e2 = all2.slice(e1.length);
    assert.equal(stageEvents(e2, "synthesis", "lint-repair").length, 1, "premise: the resume repaired a fault of its own");
    assert.deepEqual(e2.filter((e) => e.event === "post-repair-review").map((e) => [e.read, e.whole ?? false]), [[true, true]],
      "the resume reviewed only its own change, and called the earlier change read");
    assert.equal(stageEvents(e2, "narrative-refutation", "post-repair-review").length, 0, "the resume sent the review of its own repair alone");
    const rec = JSON.parse(readFileSync(driverDir(r2.runDir, "post-repair-review.json"), "utf8"));
    assert.deepEqual([rec.status, rec.whole], ["read", true]);
    assert.equal(r2.ok, true, JSON.stringify(r2).slice(0, 300));
  });
}

test("a change to the findings record alone is owed a review unless it saves the same values, even when it cannot be narrowed", async () => {
  const { recordChangeOwesReview } = await import("../pipeline.mjs");
  const runDir = tempDir("post-repair-owed-");
  const record = (over = {}) => ({ narrative: { verdict: "V.", spine: "S." }, findings: { schema_version: 7, rated_under_framework: "house-default", findings: [{ ordinal: 1, mark: "NOVA" }], ...over } });
  const { dir, accepted } = synthesisCallPaths(runDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(repairBasePath(runDir), JSON.stringify({ params: record() }));
  writeFileSync(accepted, JSON.stringify({ params: record() }));
  assert.equal(recordChangeOwesReview(runDir), false, "the same values saved again");
  writeFileSync(accepted, JSON.stringify({ params: record({ findings: [{ ordinal: 1, mark: "NOVA", net: "A new sentence." }] }) }));
  assert.equal(recordChangeOwesReview(runDir), true, "a changed finding");
  writeFileSync(accepted, JSON.stringify({ params: record({ schema_version: 6 }) }));
  assert.equal(recordChangeOwesReview(runDir), true, "a change the scope cannot narrow went unqueued");
  rmSync(repairBasePath(runDir));
  assert.equal(recordChangeOwesReview(runDir), true, "a record that cannot be compared went unqueued");
});

// ── WHEN THE SCOPE IS NOT CERTAIN THE REVIEW STAYS WHOLE ────────────────────────────────────────────────
test("the scope decision: no base, another input moved or a re-synthesis keeps the review whole; the same values need none", async () => {
  const { postRepairScope } = await import("../pipeline.mjs");
  const runDir = tempDir("post-repair-scope-");
  const P = { narrative: join(runDir, "narrative.md"), findings: join(runDir, "findings.json") };
  const record = (verdict) => ({ narrative: { verdict, spine: "S." }, findings: { schema_version: 7, rated_under_framework: "house-default", findings: [{ ordinal: 1, mark: "NOVA" }] } });
  const { dir, accepted } = synthesisCallPaths(runDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(repairBasePath(runDir), JSON.stringify({ params: record("V.") }));
  writeFileSync(accepted, JSON.stringify({ params: record("A new verdict.") }));
  const s2 = (names) => ({ label: "narrative-refutation", changed: names.map((name) => ({ name })) });
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: false }).mode, "whole", "no base kept");
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md", "register-findings.md"]), { baseKept: true }).mode, "whole", "another input moved");
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true, staleRepaired: ["synthesis"] }).mode, "whole", "a whole re-synthesis ran");
  for (const upstream of ["placement-inquiry", "register-digest", "skeptic"])
    assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true, staleRepaired: [upstream] }).mode, "whole", `${upstream} re-ran ahead of the review`);
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true, staleRepaired: ["report-card:2", "report-overview"] }).mode, "narrowed",
    "a rebuilt card or overview is no upstream change");
  const narrowed = postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true });
  assert.equal(narrowed.mode, "narrowed");
  assert.deepEqual(narrowed.changed.sections.map((x) => x.title), ["Verdict"]);
  writeFileSync(accepted, JSON.stringify({ params: record(" V. ") }));
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true }).mode, "none", "the same values, re-spaced");
  writeFileSync(accepted, JSON.stringify({ params: { ...record("V."), findings: { ...record("V.").findings, schema_version: 6 } } }));
  assert.equal(postRepairScope(runDir, P, s2(["narrative.md"]), { baseKept: true }).mode, "whole", "a changed version");
});

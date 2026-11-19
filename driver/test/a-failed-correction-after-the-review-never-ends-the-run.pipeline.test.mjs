// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEW AFTER A DELIVERY-CHECK REPAIR, END TO END ON THE MOCK PIPELINE, ON BOTH ENGINES: WHEN THE ONE CORRECTION
// AFTER IT FAILS. Its setup is shared with the other two review-after-a-repair files in `review-after-repair-harness.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { synthesisCallPaths } from "../synthesis-record.mjs";
import { repairBasePath } from "../repair-scope.mjs";
import { ENGINES, runPipeline, stageEvents, CORRECTION_OPENS, codenameOf } from "./review-after-repair-harness.mjs";

// ── A FAILED CORRECTION AFTER THE REVIEW NEVER ENDS THE RUN (owner's ruling, 2026-10-19: a run is never held) ───────
// The state before the correction comes back whole, from the record as it stood or, where that cannot be read, from the
// save the review read, or the one kept from before the repair; with none of them, nothing the failed pass wrote is kept.
const FLAG_ON_1 = [{ kind: "fact", text: "An invented point the failed correction never applied.", on: [1] }];
const MARK = "MARKED-BY-THE-FAILED-CORRECTION";
const rollbackOf = (events) => events.find((e) => e.event === "corrective-rollback" && e.pass === "post-repair");
const text = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a correction after the review that saves and then fails is rolled back whole, and the run delivers without it`, async () => {
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_POST_REPAIR_FLAGS: JSON.stringify(FLAG_ON_1),
      MOCK_POST_REPAIR_VERDICT: "CLEAR", MOCK_CORRECTION_MARKS: MARK, MOCK_FAIL_AFTER_WRITES: CORRECTION_OPENS }, engine);
    assert.equal(stageEvents(events, "synthesis", "post-repair-corrective").length, 1, "premise: the correction ran");
    const calls = readdirSync(driverDir(res.runDir, "synthesis-calls")).filter((f) => /^call-\d+\.json$/.test(f))
      .map((f) => readFileSync(driverDir(res.runDir, "synthesis-calls", f), "utf8"));
    assert.ok(calls.some((c) => c.includes(MARK)), "premise: the failed correction's save reached the tool");
    const rb = rollbackOf(events);
    assert.ok(rb, `no rollback: ${JSON.stringify(events.map((e) => e.event).slice(-15))}`);
    assert.equal(rb.from, "record", JSON.stringify(rb));
    // THE RECORD, ITS NARRATIVE, THE NEXT PATCH'S BASE AND THE DELIVERED REPORT all hold the state before the correction.
    for (const f of [join(res.runDir, "findings.json"), join(res.runDir, "narrative.md"), synthesisCallPaths(res.runDir).accepted, join(res.runDir, "report.md")])
      assert.ok(!text(f).includes(MARK), `the failed correction's text survives in ${f}`);
    assert.ok(text(driverDir(res.runDir, "reviewer-open-questions.md")).includes(FLAG_ON_1[0].text), "the point the correction never applied is not on record");
    assert.ok(!text(join(res.runDir, "report.md")).includes(FLAG_ON_1[0].text), "the point reached the client's report");
    assert.equal(JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8")).verdict, res.verdict, "the label and the run's verdict disagree");
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });

  test(`${engine}: a correction after the review that fails with its findings record and the kept state unreadable is rolled back to the save the review read, and the run delivers`, async () => {
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_POST_REPAIR_FLAGS: JSON.stringify(FLAG_ON_1),
      MOCK_POST_REPAIR_VERDICT: "CLEAR", MOCK_POST_REPAIR_LOSES: "findings,retained", MOCK_FAIL_STAGE: CORRECTION_OPENS }, engine);
    assert.equal(stageEvents(events, "synthesis", "post-repair-corrective").length, 1, "premise: the correction ran");
    const rb = rollbackOf(events);
    assert.ok(rb, `no rollback: ${JSON.stringify(events.map((e) => e.event).slice(-15))}`);
    assert.equal(rb.from, "accepted-save", JSON.stringify(rb));
    // The record is rebuilt from that save, and the base the next patch builds on is that save.
    const acc = JSON.parse(readFileSync(synthesisCallPaths(res.runDir).accepted, "utf8")).params;
    const fj = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
    assert.ok(Array.isArray(fj.findings) && fj.findings.length, "no record was rebuilt");
    assert.equal(fj.findings[0].net, acc.findings.findings[0].net, "the rebuilt record is not the save the review read");
    assert.ok(text(driverDir(res.runDir, "reviewer-open-questions.md")).includes(FLAG_ON_1[0].text), "the point the correction never applied is not on record");
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });

  test(`${engine}: with the review's save and the kept state gone too, the rollback stands on the save kept from before the repair, and the run delivers`, async () => {
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_POST_REPAIR_FLAGS: JSON.stringify(FLAG_ON_1),
      MOCK_POST_REPAIR_VERDICT: "CLEAR", MOCK_POST_REPAIR_LOSES: "findings,accepted,retained", MOCK_FAIL_STAGE: CORRECTION_OPENS }, engine);
    const rb = rollbackOf(events);
    assert.ok(rb, `no rollback: ${JSON.stringify(events.map((e) => e.event).slice(-15))}`);
    assert.equal(rb.from, "save-before-the-repair", JSON.stringify(rb));
    assert.equal(text(synthesisCallPaths(res.runDir).accepted), text(repairBasePath(res.runDir)), "the next patch's base is not the save it was rebuilt from");
    assert.ok(JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8")).findings?.length, "no record was rebuilt");
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });

  test(`${engine}: a rate-limited correction after the review is not waited for: it is rolled back, and the run delivers`, async () => {
    const limit = engine === "codex"
      ? { MOCK_CODEX_RATELIMIT: "1", MOCK_CODEX_RATELIMIT_MATCH: CORRECTION_OPENS }
      : { MOCK_CLAUDE_RATELIMIT: String(Math.floor(Date.now() / 1000) + 3600), MOCK_CLAUDE_RATELIMIT_MATCH: CORRECTION_OPENS };
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_POST_REPAIR_FLAGS: JSON.stringify(FLAG_ON_1),
      MOCK_POST_REPAIR_VERDICT: "CLEAR", ...limit }, engine);
    const pass = stageEvents(events, "synthesis", "post-repair-corrective");
    assert.ok(pass.length === 1 && pass[0].ok === false, `premise: the correction was rate-limited: ${JSON.stringify(pass)}`);
    const rb = rollbackOf(events);
    assert.ok(rb && /rate_limited/.test(rb.reason), `no rollback for the rate limit: ${JSON.stringify(rb)}`);
    assert.ok(!events.some((e) => e.event === "postponed"), "the run waited for the reset");
    assert.ok(text(driverDir(res.runDir, "reviewer-open-questions.md")).includes(FLAG_ON_1[0].text), "the point the correction never applied is not on record");
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });

  test(`${engine}: with the record and both saves lost after the review, the state kept before the review comes back whole, and the run delivers its findings`, async () => {
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_POST_REPAIR_FLAGS: JSON.stringify(FLAG_ON_1),
      MOCK_POST_REPAIR_VERDICT: "CLEAR", MOCK_POST_REPAIR_LOSES: "findings,accepted,repair-base", MOCK_CORRECTION_MARKS: MARK,
      MOCK_FAIL_AFTER_WRITES: CORRECTION_OPENS }, engine);
    const rb = rollbackOf(events);
    assert.ok(rb, `no rollback: ${JSON.stringify(events.map((e) => e.event).slice(-15))}`);
    assert.equal(rb.from, "state-before-the-review", JSON.stringify(rb));
    const kept = JSON.parse(readFileSync(driverDir(res.runDir, "post-repair-state.json"), "utf8"));
    // WHAT THE CLIENT RECEIVES: the findings the review read, under a label that agrees with the run's verdict.
    const fj = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
    assert.ok(Array.isArray(fj.findings) && fj.findings.length, "the delivered record has no findings");
    assert.deepEqual(fj.findings.map((f) => f.net), JSON.parse(kept.findings).findings.map((f) => f.net), "the delivered record is not the state the review read");
    assert.equal(text(synthesisCallPaths(res.runDir).accepted), kept.accepted, "the next patch's base is not the kept one");
    for (const f of [join(res.runDir, "findings.json"), join(res.runDir, "narrative.md"), synthesisCallPaths(res.runDir).accepted, join(res.runDir, "report.md")])
      assert.ok(!text(f).includes(MARK), `the failed correction's text survives in ${f}`);
    assert.ok(text(join(res.runDir, "report.md")).includes("Mystery Owner"), "the delivered report carries no finding");
    assert.equal(JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8")).verdict, res.verdict, "the label and the run's verdict disagree");
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });

  test(`${engine}: a save the duty that grew since refuses is restored as accepted work, not reported as lost, and the run delivers it`, async () => {
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_POST_REPAIR_FLAGS: JSON.stringify(FLAG_ON_1),
      MOCK_POST_REPAIR_VERDICT: "CLEAR", MOCK_POST_REPAIR_LOSES: "findings,retained", MOCK_POST_REPAIR_OWES_MORE: "1",
      MOCK_FAIL_STAGE: CORRECTION_OPENS }, engine);
    const rb = rollbackOf(events);
    assert.ok(rb, `no rollback: ${JSON.stringify(events.map((e) => e.event).slice(-15))}`);
    assert.deepEqual([rb.from, rb.duty], ["accepted-save", "relaxed"], JSON.stringify(rb));
    assert.ok(!events.some((e) => e.event === "post-repair-correction-unrecoverable"), "a refused save was reported as lost storage");
    const acc = JSON.parse(readFileSync(synthesisCallPaths(res.runDir).accepted, "utf8")).params;
    const fj = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
    assert.equal(fj.findings[0].net, acc.findings.findings[0].net, "the delivered record is not the save the review read");
    // CLEAN RESTORATION: the obligation was the review's moment only; the run's list is built again before the correction
    // and no longer holds it, so the duty judged again after the correction finds nothing open, and nothing is stated.
    const { synthesisDutyForRun } = await import("../synthesis-record.mjs");
    assert.equal(synthesisDutyForRun(res.runDir).unaccounted.length, 0, "premise: no obligation stays open");
    const judged = events.filter((e) => e.event === "writer-duty-after-correction");
    assert.deepEqual(judged.map((e) => [e.rolledBack, e.unaccounted]), [[true, 0]], `the duty was not judged again after the correction: ${JSON.stringify(judged)}`);
    const label = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
    assert.deepEqual([label.verdict, label.clauses ?? []], ["CLEAR", []], "a clean restoration states a condition");
    assert.equal(label.verdict, res.verdict, "the label and the run's verdict disagree");
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });

  test(`${engine}: a restored save that leaves an obligation open is judged again after the correction, and the delivered report states the gap`, async () => {
    const { res, events } = await runPipeline({ MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_POST_REPAIR_FLAGS: JSON.stringify(FLAG_ON_1),
      MOCK_POST_REPAIR_VERDICT: "CLEAR", MOCK_POST_REPAIR_LOSES: "findings,retained", MOCK_POST_REPAIR_OWES_MORE: "persist",
      MOCK_FAIL_STAGE: CORRECTION_OPENS }, engine);
    const rb = rollbackOf(events);
    assert.ok(rb, `no rollback: ${JSON.stringify(events.map((e) => e.event).slice(-15))}`);
    assert.deepEqual([rb.from, rb.duty], ["accepted-save", "relaxed"], JSON.stringify(rb));
    // PREMISE: the obligation the save does not answer is still owed when the run is delivered.
    const { synthesisDutyForRun } = await import("../synthesis-record.mjs");
    const duty = synthesisDutyForRun(res.runDir);
    assert.equal(duty.unaccounted.length, 1, `premise: one obligation stays open: ${JSON.stringify(duty.unaccounted)}`);
    // JUDGED AGAIN after the correction, and stated in the approved sentence on every surface the label reaches.
    const judged = events.filter((e) => e.event === "writer-duty-after-correction");
    assert.deepEqual(judged.map((e) => [e.rolledBack, e.unaccounted, e.now]), [[true, 1, "CONDITIONAL"]], JSON.stringify(judged));
    const label = JSON.parse(readFileSync(driverDir(res.runDir, "verdict.json"), "utf8"));
    assert.equal(label.verdict, "CONDITIONAL", "the result was not clamped on the open obligation");
    assert.ok((label.clauses ?? []).some((c) => /register records this search surfaced are neither addressed as findings nor expressly set aside/.test(String(c))),
      `the approved sentence is not among the conditions: ${JSON.stringify(label.clauses)}`);
    // ONE RESULT, AND THE SAME CONDITIONS, WHEREVER THEY ARE READ: the label, the run's status, the published rating and
    // report, the report's own label and the workbook's verdict.
    const gapClause = (label.clauses ?? []).find((c) => /neither addressed as findings nor expressly set aside/.test(String(c)));
    const status = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    const published = join(process.env.CLEAROTRON_REPORTS_DIR, status.runId);
    const data = JSON.parse(readFileSync(join(published, "report-data.json"), "utf8"));
    assert.deepEqual([res.verdict, status.review?.signoff], ["CONDITIONAL", "CONDITIONAL"], "the delivered result differs between the surfaces it is read from");
    assert.ok((data.rating?.conditions ?? []).includes(gapClause), `the delivered rating does not list the gap: ${JSON.stringify(data.rating?.conditions)}`);
    assert.equal(data.rating?.statement, label.statement, "the delivered rating is not the verdict on record");
    assert.ok(!/clear to proceed/i.test(String(data.rating?.statement ?? "")), `the delivered rating still reads clear: ${data.rating?.statement}`);
    assert.ok(readFileSync(join(published, "report.html"), "utf8").includes(gapClause), "the report the client opens does not state the gap");
    assert.match(text(join(res.runDir, "report.md")), new RegExp(`^overall_label:\\s*${label.tier}\\s*$`, "m"), "the report's own label is not the verdict on record's");
    const book = readdirSync(process.env.CLEAROTRON_REPORTS_DIR, { recursive: true }).find((x) => String(x).endsWith("-audit.xlsx"));
    assert.ok(book, "the run published no workbook");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(process.env.CLEAROTRON_REPORTS_DIR, book));
    const summary = [];
    wb.getWorksheet("Summary")?.eachRow((row) => summary.push(row.values.slice(1).map((v) => (v == null ? "" : String(v)))));
    assert.equal(summary.find((r) => r[0] === "Verdict")?.[1], label.statement, "the workbook's verdict is not the verdict on record");
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  });

  // THE PRECISE LIMIT: the record, the state kept before the review and both saves all lost, a storage failure.
  // Delivering past it shipped a report with no findings under the verdict as it stood, so nothing the failed
  // correction wrote is kept, and the assessment is not completed: the resumed pass delivers what the run holds
  // without it, with no rating (parts-not-completed.mjs).
  test(`${engine}: with every trusted copy lost, nothing the failed correction wrote is kept, and the run delivers without the assessment`, async () => {
    const knobs = { MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_POST_REPAIR_FLAGS: JSON.stringify(FLAG_ON_1),
      MOCK_POST_REPAIR_VERDICT: "CLEAR", MOCK_POST_REPAIR_LOSES: "findings,accepted,repair-base,retained", MOCK_CORRECTION_MARKS: MARK,
      MOCK_FAIL_AFTER_WRITES: CORRECTION_OPENS };
    const { res, events } = await runPipeline(knobs, engine);
    const lost = events.find((e) => e.event === "post-repair-correction-unrecoverable");
    assert.ok(lost, `the case was not recorded: ${JSON.stringify(events.map((e) => e.event).slice(-15))}`);
    assert.equal(lost.findings, "set-aside", JSON.stringify(lost));
    assert.ok(!rollbackOf(events), "a rollback was claimed with nothing to roll back to");
    for (const f of [join(res.runDir, "findings.json"), synthesisCallPaths(res.runDir).accepted, join(res.runDir, "narrative.md")])
      assert.ok(!text(f).includes(MARK), `the failed correction's text was kept in ${f}`);
    assert.ok(text(driverDir(res.runDir, "findings-failed-correction.json")).includes(MARK), "the failed pass's record was not kept aside as evidence");
    assert.notEqual(res.ok, true, "a report went out with its record unreadable");
    assert.ok(events.some((e) => e.event === "part-not-completed" && e.part === "assessment"), "the assessment was not recorded as not completed");
    const { res: r2 } = await runPipeline(knobs, engine, { codename: codenameOf(res.runDir) });
    assert.equal(r2.ok, true, `the run did not deliver: ${JSON.stringify(r2).slice(0, 300)}`);
    const runId = JSON.parse(readFileSync(join(r2.runDir, "status.json"), "utf8")).runId;
    const meta = JSON.parse(readFileSync(join(process.env.CLEAROTRON_REPORTS_DIR, runId, "meta.json"), "utf8"));
    assert.deepEqual([meta.assessment, meta.overall], ["not-completed", undefined], "a rating was delivered over a record nobody could read");
  });
}

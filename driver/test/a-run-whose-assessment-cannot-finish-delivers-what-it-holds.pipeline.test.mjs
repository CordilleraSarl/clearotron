// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline whose synthesis cannot finish through its park and its resume, on both engines
//
// A RUN WHOSE OVERALL ASSESSMENT CANNOT FINISH DELIVERS WHAT IT HOLDS, WITH THE GAP STATED.
//
// Synthesis failed, its recovery was spent, and the run used to end with the stop notice and nothing delivered, though
// it held the register write-up, the web search, the coverage records and the plan. Now the run-level catch records the
// assessment as not completed and parks for an immediate resume, and the resumed pass delivers the same page, workbook
// and email built from what the run holds:
//   · no rating, band or verdict word on any surface, and none an earlier pass left behind;
//   · the report's conclusion is the one sentence for this state and the shipped action line;
//   · the workbook carries the shipped "Findings" row, with the shipped gap row's words;
//   · no failure notice and no `.failed`, because the run delivered;
//   · a republish gives the same page.
// A failure on the pass that delivers without the assessment is not routed again: the run ends with the stop notice.
// Every mark and owner is invented; the mock engine's own fixture words are not repeated here.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { ASSESSMENT_NOT_COMPLETED, CLIENT_ACTION, assessmentNotCompletedNote } from "../../shared/client-failure-note.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job-open-assessment", msgId: "<open-assessment@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8197", markName: "ORBANTIQ", classes: [9, 41], provider: "corsearch",
};
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY",
  "MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_FINDINGS_N"];
// The synthesis turn's own words, so only the overall assessment fails.
const SYNTHESIS_TURN = "Produce the joint synthesis narrative";
const OVERVIEW_TURN = "record_report_overview";

async function runPass(root, engine, knobs = {}, codename = null) {
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CONDITIONAL", MOCK_SKEPTIC: "no flags surfaced", ...knobs }))
    pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  return pipeline({ ...JOB }, codename ? { codename } : {});
}

const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const events = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const pageText = (html) => String(html).replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ");

async function workbookRows(path) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const out = {};
  for (const ws of wb.worksheets) {
    out[ws.name] = [];
    ws.eachRow((row) => out[ws.name].push(row.values.slice(1).map((v) => (v && typeof v === "object" ? (v.text ?? "") : String(v ?? "")))));
  }
  return out;
}

/** Every surface of a delivery made without the assessment carries no rating, and says why. */
async function assertDeliveredWithoutTheAssessment(root, res, label) {
  assert.equal(res.ok, true, `${label}: the run did not deliver: ${JSON.stringify(res)}`);
  assert.equal(res.verdict, null, `${label}: a delivery without the assessment returned a sign-off`);
  const rd = res.runDir;
  assert.ok(existsSync(join(rd, ".delivered")), `${label}: no .delivered`);
  assert.ok(!existsSync(join(rd, ".failed")), `${label}: a delivered run carries .failed`);
  assert.ok(!existsSync(driverDir(rd, "failure.json")), `${label}: a delivered run carries the failure notice`);
  const record = json(driverDir(rd, "not-completed", "assessment.json"));
  assert.equal(record.stage, "synthesis", `${label}: the record does not name the stage that failed`);

  const status = json(join(rd, "status.json"));
  assert.equal(status.state, "delivered");
  assert.equal(status.review?.signoff ?? null, null, `${label}: status carries a sign-off`);
  assert.equal(status.tier ?? null, null, `${label}: status carries a rating`);
  assert.equal(status.statement ?? null, null, `${label}: status carries a risk statement`);
  assert.equal(status.caption, assessmentNotCompletedNote(), `${label}: status's conclusion is not the report's`);

  const pool = join(root, "pool", status.runId);
  const meta = json(join(pool, "meta.json"));
  assert.equal(meta.assessment, "not-completed", `${label}: the pool does not state the assessment as not completed`);
  for (const k of ["overall", "badge", "statement", "review"]) assert.equal(meta[k], undefined, `${label}: meta.json carries ${k}`);
  assert.equal(meta.caption, assessmentNotCompletedNote(), `${label}: the run list's conclusion is not the report's`);

  const data = json(join(pool, "report-data.json"));
  assert.equal(data.assessment, "not-completed");
  assert.equal(data.rating, null, `${label}: report-data carries a rating`);
  assert.deepEqual(data.findings, [], `${label}: report-data carries findings`);

  const html = pageText(readFileSync(join(pool, "report.html"), "utf8"));
  for (const [what, needle] of [["the risk pill", 'class="tb-risk"'], ["the gauge", 'class="panel gauge"'], ["Where it stands", 'id="countries"'],
    ["Also considered", 'id="also-considered"'], ["a findings section", 'id="findings"'], ["What happens next", 'id="next"'],
    ["the fold that names a chart", "Show the chart and rights-holders"], ["a line pointing at a verdict", "carried in the verdict above"]])
    assert.ok(!html.includes(needle), `${label}: the page draws ${what}`);
  assert.ok(html.includes(`${ASSESSMENT_NOT_COMPLETED} ${CLIENT_ACTION}`), `${label}: the page does not lead with the sentence and the action`);
  assert.ok(html.includes('id="searched"'), `${label}: the page lost "What was searched"`);

  const packet = json(driverDir(rd, "delivery.json"));
  assert.equal(packet.verdict, null);
  const mail = String(packet.emailBodyHtml).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.ok(mail.includes(`${ASSESSMENT_NOT_COMPLETED} ${CLIENT_ACTION}`), `${label}: the email does not carry the sentence`);
  assert.ok(!/Overall risk/.test(mail), `${label}: the email states a rating`);

  const audit = readFileSync(join(pool, "audit.md"), "utf8");
  assert.ok(!/^# Findings\b/m.test(audit), `${label}: the delivered audit lists records the assessment would have rated`);
  assert.ok(/^# Negative Results\b/m.test(audit), `${label}: the delivered audit lost its search log`);

  // No coverage row reads clean, and none carries the write-up's words: an open row carries the shipped gap reason.
  const stated = json(driverDir(rd, "not-completed", "assessment-coverage.json")).rows;
  assert.ok(stated.length > 0, `${label}: guard: the delivery stated no coverage row, so this proves nothing`);
  assert.deepEqual(stated.filter((r) => r.state === "confirmed-clean"), [], `${label}: a coverage row reads clean with no assessment`);
  assert.deepEqual(stated.filter((r) => r.note && r.note !== plainDeferralReason("unfinished")), [], `${label}: a coverage row carries the write-up's words`);
  assert.ok(!html.includes("Searched — clean"), `${label}: the page calls a slice clean with no assessment`);
  const degraded = json(driverDir(rd, "degraded-parts.json"));
  assert.ok(degraded.parts.some((d) => d.part === "assessment" && d.name === "Findings"), `${label}: the part is not on the record`);
  const book = await workbookRows(join(pool, meta.auditFile));
  const field = (name) => book.Summary.find((r) => r[0].trim() === name);
  assert.equal(field("Verdict"), undefined, `${label}: the workbook's Summary prints a Verdict row`);
  assert.equal(field("Risk band"), undefined, `${label}: the workbook's Summary prints a band`);
  assert.equal(field("Findings rated"), undefined, `${label}: the workbook counts findings no assessment rated`);
  assert.match(field("⚠  One thing to check first")?.[1] ?? "", /^Findings — .*it could not be completed this run, so it is left open here rather than reported as clean$/,
    `${label}: the Summary does not lead with the part that was not completed`);
  assert.equal(book.Findings.length, 1, `${label}: the Findings tab lists rows`);
  assert.ok(book["Coverage & gaps"].some((r) => /Findings/.test(r[0]) && /it could not be completed this run, so it is left open here rather than reported as clean/.test(r[3])),
    `${label}: Coverage & gaps does not carry the shipped Findings row`);
  return { rd, pool, status };
}

test("the one new sentence is written once, and the report's conclusion is it followed by the shipped action", () => {
  assert.equal(ASSESSMENT_NOT_COMPLETED, "The overall assessment could not be completed this run, so it is left open here rather than reported as clean.");
  assert.equal(assessmentNotCompletedNote(), `${ASSESSMENT_NOT_COMPLETED} ${CLIENT_ACTION}`);
  // The sentence's second half is the shipped gap row's own wording.
  assert.ok(ASSESSMENT_NOT_COMPLETED.endsWith("it is left open here rather than reported as clean."));
  for (const f of ["pipeline.mjs", "publish/index.mjs", "publish/render.mjs", "publish/xlsx.mjs", "degraded-parts.mjs"])
    assert.ok(!readFileSync(join(HERE, "..", f), "utf8").includes("The overall assessment could not be completed"), `${f} spells the sentence out instead of importing it`);
});

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a synthesis that cannot finish parks once and delivers what the run holds, with no rating anywhere`, async () => {
    const root = tempDir("clearotron-open-assessment-");
    const p1 = await runPass(root, engine, { MOCK_FAIL_STAGE: SYNTHESIS_TURN });
    assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1)}`);
    assert.ok(existsSync(driverDir(p1.runDir, "not-completed", "assessment.json")), "the park recorded nothing");
    assert.ok(!existsSync(join(p1.runDir, ".failed")) && !existsSync(driverDir(p1.runDir, "failure.json")), "the park wrote a failure");
    const outbox = join(root, "clearance-outbox");
    assert.deepEqual(existsSync(outbox) ? readdirSync(outbox).filter((f) => f.endsWith(".failed.pending")) : [], [], "a failure notice was queued");
    assert.ok(events(p1.runDir).some((e) => e.event === "part-not-completed" && e.part === "assessment" && e.stage === "synthesis"));
    // The resume keeps the failing knob armed: delivering without the assessment never dispatches synthesis.
    const p2 = await runPass(root, engine, { MOCK_FAIL_STAGE: SYNTHESIS_TURN }, p1.codename);
    const { rd } = await assertDeliveredWithoutTheAssessment(root, p2, engine);
    const ev = events(rd);
    assert.ok(ev.some((e) => e.event === "assessment-not-completed-delivery"), "the delivery is not on the run's record");

    // A REPUBLISH GIVES THE SAME PAGE: the state is read from the run's record, not inferred.
    const { publishReport } = await import("../publish/index.mjs");
    const again = tempDir("clearotron-open-assessment-republish-");
    const runId = json(join(rd, "status.json")).runId;
    await publishReport({ runId, codename: p1.codename, reportMd: join(rd, "report.md"), auditMd: join(rd, "audit.md"),
      findingsJson: join(rd, "findings.json"), poolRoot: again, poolUrl: "https://trademark.test", customerKey: "generic", runDir: rd, skipRegen: true });
    const page = (dir) => readFileSync(join(dir, runId, "report.html"), "utf8").replace(/[Ii]ssued on \d{4}-\d\d-\d\d/g, "issued");
    assert.equal(page(again), page(join(root, "pool")), "a republish of the run gives a different page");
  });

  test(`${engine}: a synthesis that parks, resumes and fails again is delivered without the assessment on the next pass`, async () => {
    const root = tempDir("clearotron-open-assessment-again-");
    const p1 = await runPass(root, engine, { MOCK_FAIL_STAGE: SYNTHESIS_TURN, CLEAROTRON_RECOVERY_MAX: "1" });
    assert.equal(p1.postponed, true);
    assert.ok(!existsSync(driverDir(p1.runDir, "not-completed")), "the first failure, with recovery left, was recorded as not completed");
    const p2 = await runPass(root, engine, { MOCK_FAIL_STAGE: SYNTHESIS_TURN, CLEAROTRON_RECOVERY_MAX: "1" }, p1.codename);
    assert.equal(p2.postponed, true, `the repeat did not park for the delivery: ${JSON.stringify(p2)}`);
    assert.ok(existsSync(driverDir(p2.runDir, "not-completed", "assessment.json")), "the spent recovery recorded nothing");
    const p3 = await runPass(root, engine, { MOCK_FAIL_STAGE: SYNTHESIS_TURN, CLEAROTRON_RECOVERY_MAX: "1" }, p1.codename);
    await assertDeliveredWithoutTheAssessment(root, p3, engine);
  });

  test(`${engine}: a verdict an earlier pass wrote reaches no surface of a delivery without the assessment`, async () => {
    const root = tempDir("clearotron-open-assessment-earlier-");
    // Pass 1 reaches the verdict and parks at the report overview.
    const p1 = await runPass(root, engine, { MOCK_FAIL_STAGE: OVERVIEW_TURN, CLEAROTRON_RECOVERY_MAX: "1" });
    assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1)}`);
    assert.ok(existsSync(driverDir(p1.runDir, "verdict.json")), "guard: pass 1 wrote no verdict, so this arm proves nothing");
    assert.ok(json(join(p1.runDir, "status.json")).tier, "guard: pass 1's status carries no rating");
    // The assessment's own output is gone, so the resume runs synthesis again, and it fails.
    for (const f of ["narrative.md", "findings.json"]) rmSync(join(p1.runDir, f));
    const p2 = await runPass(root, engine, { MOCK_FAIL_STAGE: SYNTHESIS_TURN, CLEAROTRON_RECOVERY_MAX: "1" }, p1.codename);
    assert.equal(p2.postponed, true, `the resumed synthesis did not park for the delivery: ${JSON.stringify(p2)}`);
    const p3 = await runPass(root, engine, { MOCK_FAIL_STAGE: SYNTHESIS_TURN, CLEAROTRON_RECOVERY_MAX: "1" }, p1.codename);
    const { rd } = await assertDeliveredWithoutTheAssessment(root, p3, engine);
    const setAside = readdirSync(driverDir(rd, "not-completed", "set-aside"));
    for (const name of ["_driver__verdict.json", "_driver__report-identity.json"])
      assert.ok(setAside.includes(name), `${name} was not set aside: ${JSON.stringify(setAside)}`);
    assert.ok(!existsSync(driverDir(rd, "verdict.json")), "the earlier verdict is still where publishing reads it");
  });

  test(`${engine}: a failure while delivering without the assessment ends the run with the stop notice, once`, async () => {
    const root = tempDir("clearotron-open-assessment-oneshot-");
    const p1 = await runPass(root, engine, { MOCK_FAIL_STAGE: SYNTHESIS_TURN });
    assert.equal(p1.postponed, true);
    // The pool cannot be written, so the delivery's publish throws.
    const blocked = join(root, "pool-is-a-file");
    writeFileSync(blocked, "");
    const p2 = await runPass(root, engine, { MOCK_FAIL_STAGE: SYNTHESIS_TURN, CLEAROTRON_REPORTS_DIR: blocked }, p1.codename);
    assert.equal(p2.ok, false);
    assert.equal(p2.postponed, undefined, `the failed delivery was parked again: ${JSON.stringify(p2)}`);
    assert.ok(existsSync(join(p2.runDir, ".failed")), "the run did not end");
    assert.match(json(driverDir(p2.runDir, "failure.json")).text, /nothing was delivered/i, "the stop notice is not owed");
    assert.ok(!existsSync(driverDir(p2.runDir, "not-completed")), "a run that ended with the stop notice still records a part as not completed");
    assert.equal(events(p2.runDir).filter((e) => e.event === "part-not-completed").length, 1, "the part was routed twice");
  });
}

// ── WHAT A RUN WITHOUT THE RECORD DOES, AS IT DID BEFORE ─────────────────────────────────────────────────────────────
//
// The record is the only thing that removes the rating, and nothing else changed. Pinned as the code behaves: the
// strict parse, which the findings tool holds a synthesis to, refuses a record carrying nothing and accepts a clean
// matter's record with no finding and with coverage rows; the lenient parse the delivery's artifact gate runs accepts
// the empty one, as it did; and a report published with no findings file and no record still draws its rating.
test("without the record: the strict parse refuses an empty record, a clean matter parses, and an absent file renders as before", async () => {
  const { parseFindingsJson, parseFindingsJsonLenient } = await import("../findings-model.mjs");
  const empty = JSON.stringify({ schema_version: 4, rated_under_framework: "house-default", findings: [], coverage: [] });
  assert.throws(() => parseFindingsJson(empty), /findings_empty/, "the strict parse accepts a record carrying nothing");
  assert.equal(parseFindingsJsonLenient(empty).findings.length, 0, "the lenient parse no longer reads an empty record");
  const clean = parseFindingsJson(JSON.stringify({ schema_version: 4, rated_under_framework: "house-default", findings: [],
    coverage: [{ area: "register / worldwide", state: "confirmed-clean", note: "paged to completion" }] }));
  assert.deepEqual([clean.findings.length, clean.coverage.length], [0, 1], "a clean matter's record does not parse");

  const { publishReport } = await import("../publish/index.mjs");
  const runDir = tempDir("clearotron-no-record-");
  writeFileSync(join(runDir, "report.md"), ["---", "type: clearance-clearance", "matter: TMP8198", "title: ORBANTIQ", "overall_label: Low",
    "overall_caption: A short conclusion.", "---", ""].join("\n"));
  const pool = tempDir("clearotron-no-record-pool-");
  await publishReport({ runId: "no-record", codename: "x", reportMd: join(runDir, "report.md"), auditMd: join(runDir, "audit.md"),
    findingsJson: join(runDir, "findings.json"), poolRoot: pool, poolUrl: "https://trademark.test", customerKey: "generic", runDir, skipRegen: true });
  const html = readFileSync(join(pool, "no-record", "report.html"), "utf8");
  assert.ok(html.includes('class="tb-risk"') && html.includes('class="panel gauge"'), "a report with no record lost its rating");
  const meta = json(join(pool, "no-record", "meta.json"));
  assert.equal(meta.assessment, undefined, "a run with no record is stated as not completed");
  assert.equal(meta.overall, "Low", "a run with no record lost the rating its report states");
});

// ── THE CHANGED-MATERIAL CHECK GIVES ITS REPEAT ONE MORE ASSEMBLY ───────────────────────────────────────────────────
//
// Staleness at delivery comes from a repair inside the pass, which the pass then repairs once more; a first staleness the
// repair cannot clear parks, and its repeat used to end the run. The repeat is now named as the check's own part, so the
// run parks once more and the resumed pass assembles again from the current material; still stale then, it ends as
// before, and the check never delivers past staleness. A mock run cannot make a repair fail twice and then succeed, so
// the naming is read from the source, and the record's answer is driven: a pass that clears the check removes it.
test("the changed-material check's repeat is named as its own part, and a pass that clears the check answers its record", async () => {
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  assert.match(src, /throw Object\.assign\(new StageFailure\("delivery", `the report was assembled from material that has since changed[^\n]*\{ failClass: "stale" \}\), \{ notCompletedPart: "delivery" \}\);/,
    "the check's repeat is not named as its own part, so it ends the run");
  const root = tempDir("clearotron-open-delivery-");
  const p1 = await runPass(root, "claude", { MOCK_FAIL_STAGE: OVERVIEW_TURN, CLEAROTRON_RECOVERY_MAX: "1" });
  assert.equal(p1.postponed, true, `pass 1 did not park: ${JSON.stringify(p1)}`);
  const { writePartNotCompleted } = await import("../parts-not-completed.mjs");
  writePartNotCompleted(p1.runDir, "delivery", { stage: "delivery", reason: "the report was assembled from material that has since changed" });
  const p2 = await runPass(root, "claude", { CLEAROTRON_RECOVERY_MAX: "1" }, p1.codename);
  assert.equal(p2.ok, true, JSON.stringify(p2));
  assert.ok(!existsSync(driverDir(p2.runDir, "not-completed", "delivery.json")), "the check passed and its record still stands");
  assert.ok(events(p2.runDir).some((e) => e.event === "part-completed" && e.part === "delivery"), "the record's answer is not on the run's record");
  assert.equal(json(join(p2.runDir, "status.json")).review?.signoff, "CONDITIONAL", "a run whose check passed lost its rating");
});

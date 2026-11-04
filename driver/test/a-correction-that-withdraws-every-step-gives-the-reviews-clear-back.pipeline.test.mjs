// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CORRECTION THAT WITHDRAWS EVERY FORWARD LEGAL STEP THAT ALONE MADE THE RESULT CONDITIONAL GIVES THE REVIEW'S CLEAR BACK.
//
// The review said CLEAR, and the floor raised the result to CONDITIONAL only because the record named forward legal
// steps. A writer's repair in the delivery check then withdrew every one of them. The conditions followed the record, so
// the list emptied, and the result stayed CONDITIONAL with no condition named: a band word for a statement, and the
// email's general line about the report's open items. The owner's decision (2026-11-04): where the withdrawal is positive,
// the result is recomputed as a closed gap's is, from the assessment and the conditions still standing, and CLEAR comes
// back only when none is left. An unreadable register, a rejected correction or a review of the change that was not read
// gives nothing back. These drive the decision as a pure function, then the change end to end on the mock pipeline.
import { test, after } from "node:test";
import { pinEnvAll, pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { clientConditions, verdictWhenTheStepsAreWithdrawn } from "../terminal-clamp.mjs";
import { actionsRegisterListed } from "../pipeline.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

// ── the decision ────────────────────────────────────────────────────────────────────────────────────────────────
const T0 = "2026-11-04T08:00:00.000Z", T1 = "2026-11-04T08:00:01.000Z", T2 = "2026-11-04T08:00:02.000Z";
const WITHDRAWN = { verdict: "CONDITIONAL", assessed: "CLEAR", reasons: [], raisedBySteps: true, withdrawnAt: T1, reviewReadAt: T2 };
const decide = (over = {}) => verdictWhenTheStepsAreWithdrawn({ ...WITHDRAWN, ...over });

test("the last step withdrawn, the change's review read after it, and nothing else standing: CLEAR comes back", () => {
  assert.equal(decide(), "CLEAR");
  assert.equal(decide({ correctionRejectedAt: T0 }), "CLEAR", "a correction rejected before the withdrawal is not this withdrawal's");
});

test("a step or any other condition still standing keeps the result", () => {
  assert.equal(decide({ reasons: ["Obtain consent before filing in the EU."] }), "CONDITIONAL");
  assert.equal(decide({ reasons: ["the lawyer judged a material slice not fully cleared"] }), "CONDITIONAL");
});

test("an assessment that was CONDITIONAL or BLOCKING, or a result the steps never raised, is never lifted", () => {
  assert.equal(decide({ assessed: "CONDITIONAL" }), "CONDITIONAL");
  assert.equal(decide({ assessed: "BLOCKING" }), "CONDITIONAL");
  assert.equal(decide({ verdict: "BLOCKING", assessed: "BLOCKING" }), "BLOCKING");
  assert.equal(decide({ raisedBySteps: false }), "CONDITIONAL", "a CONDITIONAL the steps did not make is not theirs to give back");
  assert.equal(decide({ verdict: "CLEAR" }), "CLEAR");
});

test("an unreadable register withdraws nothing: no withdrawal on record, or a step ever dropped as unreadable", () => {
  assert.equal(decide({ withdrawnAt: null }), "CONDITIONAL");
  assert.equal(decide({ withdrawnAt: "not a time" }), "CONDITIONAL");
  assert.equal(decide({ stepsUnreadable: true }), "CONDITIONAL");
  assert.equal(actionsRegisterListed(JSON.stringify({ findings: [], actions: [] })), true, "an empty list is a register that holds no step");
  for (const raw of [JSON.stringify({ findings: [] }), JSON.stringify({ findings: [], actions: "none" }), JSON.stringify({ actions: null }), "{ not json", "", null])
    assert.equal(actionsRegisterListed(raw), false, `a register read as listed: ${raw}`);
});

test("a review of the change that was not read, or read before the change, gives nothing back", () => {
  assert.equal(decide({ reviewReadAt: null }), "CONDITIONAL", "no review of the change");
  assert.equal(decide({ reviewReadAt: T0 }), "CONDITIONAL", "a review read before the withdrawal did not read it");
  assert.equal(decide({ reviewReadAt: T1 }), "CONDITIONAL", "nor one stamped at the same moment");
  assert.equal(decide({ reviewUnread: true }), "CONDITIONAL", "a review since then went unread");
});

test("a recheck of the first correction that was owed and not accepted gives nothing back", () => {
  assert.equal(decide({ recheckUnaccepted: true }), "CONDITIONAL");
  assert.equal(decide({ recheckUnaccepted: false }), "CLEAR");
});

test("a correction rejected after the withdrawal gives nothing back", () => {
  assert.equal(decide({ correctionRejectedAt: T2 }), "CONDITIONAL");
  assert.equal(decide({ correctionRejectedAt: T1 }), "CONDITIONAL");
  assert.equal(decide({ correctionRejectedAt: "not a time" }), "CONDITIONAL", "a rejection whose time cannot be read counts against");
});

// ── end to end, on the mock pipeline ────────────────────────────────────────────────────────────────────────────
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
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8439", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_ACTIONS", "MOCK_NARRATIVE_OVER_CAP", "MOCK_LINT_REPAIR_ACTIONS", "MOCK_COVERAGE_INSUFFICIENT",
  "MOCK_POST_REPAIR_UNREAD", "MOCK_POST_REPAIR_FLAGS", "MOCK_POST_REPAIR_VERDICT", "MOCK_FAIL_AFTER_WRITES", "MOCK_CORRECTION_MARKS"];
const AS_STARTED = Object.fromEntries(["CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"].map((k) => [k, process.env[k]]));
const ENGINES = {
  claude: { ...AS_STARTED, CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};

async function runPipeline(env, engine = "claude", { codename = null } = {}) {
  const root = codename ? process.env.CLEAROTRON_WORK_DIR : tempDir("clearotron-steps-withdrawn-");
  for (const k of KNOBS) delete process.env[k];
  pinEnvAll(process.env, { ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_SKEPTIC: "no flags surfaced", ...env });
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, codename ? { codename } : {});
  const json = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
  const text = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const status = json(join(res.runDir, "status.json"));
  const pool = join(root, "pool", status.runId);
  const book = !existsSync(join(root, "pool")) ? null : readdirSync(join(root, "pool"), { recursive: true }).find((p) => String(p).startsWith(status.runId) && String(p).endsWith("-audit.xlsx"));
  let summary = null;
  if (book) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(root, "pool", book));
    summary = [];
    wb.getWorksheet("Summary")?.eachRow((row) => summary.push(row.values.slice(1).map((v) => (v == null ? "" : String(v)))));
  }
  return {
    res, events, status, summary, codename: status.codename,
    label: json(driverDir(res.runDir, "verdict.json")),
    settle: json(join(pool, "settle.json")),
    rating: json(join(pool, "report-data.json"))?.rating ?? null,
    email: text(join(res.runDir, "email-body.md")),
    md: text(join(res.runDir, "report.md")),
    pages: existsSync(pool) ? readdirSync(pool).filter((f) => f.endsWith(".html")).map((f) => readFileSync(join(pool, f), "utf8")) : [],
  };
}

// The step MOCK_ACTIONS=condition writes, and the repair that withdraws it.
const STEP = "Obtain consent from Mystery Owner LLC before filing in the US";
const WITHDRAW_THE_STEP = { MOCK_VERDICT: "CLEAR", MOCK_NARRATIVE_OVER_CAP: "1", MOCK_ACTIONS: "condition", MOCK_LINT_REPAIR_ACTIONS: "drop" };
const OPEN_ITEMS = "the open items set out in the report, before relying on a clean result";
const CORRECTION_OPENS = "After the delivery check, that record was repaired, and an independent review then read only what the repair changed and what rests on it.";
const stageEvents = (events, stage, trigger) => events.filter((e) => e.event === "stage" && e.stage === stage && e.trigger === trigger);
const recomputed = (events) => events.filter((e) => e.event === "verdict-recomputed-steps-withdrawn").map((e) => [e.from, e.to]);

/** The premise every arm stands on: the floor raised a CLEAR on the step, and the writer's repair withdrew it. */
function stepRaisedThenWithdrawn(events) {
  assert.deepEqual(events.filter((e) => e.event === "coverage-floor-clamp" && e.cause === "forward-actions").map((e) => [e.from, e.to]),
    [["CLEAR", "CONDITIONAL"]], "premise: the floor raised the review's CLEAR on the record's step");
  assert.equal(stageEvents(events, "synthesis", "lint-repair").length, 1, "premise: the writer repaired its record");
  assert.ok(events.some((e) => e.event === "verdict-conditions-followed" && e.withdrawn >= 1), "premise: the step left the list");
}

/** One result, one set of conditions, wherever they are read. */
function sameEverywhere({ res, status, settle, label, rating, md, summary }, result) {
  assert.equal(res.ok, true, JSON.stringify({ fail: res.fail, stage: res.failedStage }));
  assert.deepEqual([res.verdict, label.verdict, status.review.signoff, settle.signoff], Array(4).fill(result),
    "the delivered result differs between the surfaces it is read from");
  assert.equal(rating.statement, label.statement, "the delivered rating is not the verdict on record");
  assert.deepEqual(rating.conditions ?? [], clientConditions(label), "the delivered rating lists other conditions than the verdict on record");
  assert.match(md, new RegExp(`^overall_label:\\s*${label.tier}\\s*$`, "m"), "the report's own label is not the verdict on record's");
  assert.ok(summary, "the run published no workbook");
  assert.equal(summary.find((r) => r[0] === "Verdict")?.[1], label.statement, `the workbook's verdict is not the verdict on record: ${JSON.stringify(summary.slice(0, 8))}`);
}

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: a repair that withdraws the one step that made a CLEAR review conditional delivers CLEAR, the same everywhere`, async () => {
    const run = await runPipeline(WITHDRAW_THE_STEP, engine);
    stepRaisedThenWithdrawn(run.events);
    assert.equal(JSON.parse(readFileSync(driverDir(run.res.runDir, "post-repair-review.json"), "utf8")).status, "read", "premise: the change's review was read");
    assert.deepEqual(recomputed(run.events), [["CONDITIONAL", "CLEAR"]], "the result was not recomputed once, to CLEAR");
    sameEverywhere(run, "CLEAR");
    assert.equal(run.label.stance, "clear");
    assert.deepEqual([run.label.reasons ?? [], run.label.clauses ?? []], [[], []], "the verdict on record still carries a condition");
    assert.equal(run.label.band?.label, "High", "the risk band moved with the result");
    for (const [where, text] of [["the page", run.pages.join("\n")], ["the email", run.email], ["the page's data", JSON.stringify(run.rating)]])
      assert.ok(!text.includes(STEP), `${where} still states the withdrawn step`);
    assert.ok(!run.email.includes(OPEN_ITEMS) && !run.email.includes("Only you can close these"), "the email still points at open items that no longer exist");
  });
}

// A RESUME REBUILDS WHAT THE DECISION READS: pass 1 stops at the report overview, before the delivery check, with the
// floor's clamp on the step already made; the resumed pass repairs, reviews and gives the CLEAR back from its own reading.
const STOP_AT_OVERVIEW = "record_report_overview";
test("claude: a run stopped before its delivery check and resumed gives the review's CLEAR back, the same everywhere", async () => {
  const first = await runPipeline({ ...WITHDRAW_THE_STEP, MOCK_FAIL_STAGE: STOP_AT_OVERVIEW, CLEAROTRON_RECOVERY_MAX: "1" });
  assert.notEqual(first.res.ok, true, "premise: pass 1 stopped before delivery");
  assert.equal(first.status.failedStage, "report-overview", `premise: pass 1 stopped at the overview (stopped at ${first.status.failedStage})`);
  assert.equal(stageEvents(first.events, "synthesis", "lint-repair").length, 0, "premise: pass 1 never reached the delivery check's repair");
  const again = await runPipeline(WITHDRAW_THE_STEP, "claude", { codename: first.codename });
  const e2 = again.events.slice(first.events.length);   // the run log carries every pass: this one's rows only
  stepRaisedThenWithdrawn(e2);
  assert.deepEqual(recomputed(e2), [["CONDITIONAL", "CLEAR"]], "the resumed pass did not give the CLEAR back once");
  sameEverywhere(again, "CLEAR");
  assert.deepEqual(clientConditions(again.label), [], "the resume left a condition standing");
});

test("claude: one step still standing keeps the result CONDITIONAL on it", async () => {
  const run = await runPipeline({ ...WITHDRAW_THE_STEP, MOCK_ACTIONS: "two-conditions" });
  assert.deepEqual(recomputed(run.events), []);
  sameEverywhere(run, "CONDITIONAL");
  assert.deepEqual(clientConditions(run.label).map((c) => c.replace(/\.$/, "")), ["Obtain a letter of consent from Mystery Owner LLC before filing in the EU"]);
});

test("claude: a coverage judgment standing beside the withdrawn step keeps the result CONDITIONAL on that judgment alone", async () => {
  const run = await runPipeline({ ...WITHDRAW_THE_STEP, MOCK_COVERAGE_INSUFFICIENT: "1" });
  stepRaisedThenWithdrawn(run.events);
  assert.deepEqual(recomputed(run.events), []);
  sameEverywhere(run, "CONDITIONAL");
  const left = clientConditions(run.label);
  assert.equal(left.length, 1, `not one condition left: ${JSON.stringify(left)}`);
  assert.match(left[0], /^the lawyer judged a material slice not fully cleared/);
  assert.ok(!run.pages.join("\n").includes(STEP), "the page still states the withdrawn step");
});

test("claude: a review that said CONDITIONAL is never lifted when the repair withdraws the step", async () => {
  const run = await runPipeline({ ...WITHDRAW_THE_STEP, MOCK_VERDICT: "CONDITIONAL", MOCK_NARRATIVE_OVER_CAP: "until-lint-repair" });
  assert.equal(stageEvents(run.events, "synthesis", "lint-repair").length, 1, "premise: the writer repaired its record");
  assert.deepEqual(recomputed(run.events), []);
  assert.equal(run.label.verdict, "CONDITIONAL");
  assert.equal(run.res.ok, true, JSON.stringify(run.res).slice(0, 300));
});

test("claude: a review of the change that could not be read gives nothing back", async () => {
  const run = await runPipeline({ ...WITHDRAW_THE_STEP, MOCK_POST_REPAIR_UNREAD: "both" });
  stepRaisedThenWithdrawn(run.events);
  assert.equal(JSON.parse(readFileSync(driverDir(run.res.runDir, "post-repair-review.json"), "utf8")).status, "unread", "premise: the change went unreviewed");
  assert.deepEqual(recomputed(run.events), []);
  assert.equal(run.label.verdict, "CONDITIONAL");
  assert.equal(run.res.ok, true, JSON.stringify(run.res).slice(0, 300));
});

test("claude: a correction of the review's points that is rejected and rolled back gives nothing back", async () => {
  const flags = [{ kind: "fact", text: "An invented point the rejected correction never applied.", on: [1] }];
  const run = await runPipeline({ ...WITHDRAW_THE_STEP, MOCK_POST_REPAIR_FLAGS: JSON.stringify(flags), MOCK_POST_REPAIR_VERDICT: "CLEAR",
    MOCK_CORRECTION_MARKS: "MARKED-BY-THE-REJECTED-CORRECTION", MOCK_FAIL_AFTER_WRITES: CORRECTION_OPENS });
  stepRaisedThenWithdrawn(run.events);
  assert.ok(run.events.some((e) => e.event === "corrective-rollback" && e.pass === "post-repair"), "premise: the correction was rejected and rolled back");
  assert.deepEqual(recomputed(run.events), []);
  assert.equal(run.label.verdict, "CONDITIONAL");
  assert.equal(run.res.ok, true, JSON.stringify(run.res).slice(0, 300));
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline through a park and a resumed pass that repeats placement and delivers, on both engines
//
// A FLOOR THE REPEATED PLACEMENT PASS ANSWERS IS WITHDRAWN, AND THE RESULT IS RECOMPUTED FROM THE ASSESSMENT.
//
// The delivery checks find a floor open and make a clear result conditional, naming it. The delivery check then repeats
// placement over a band that moved, and the repeat's account answers every floor. That gap is closed, so its clause goes,
// and the result is recomputed from the assessment the review reached and the conditions that still stand (ruled
// 2026-10-19). Where the floor was the only condition, the run delivers CLEAR. Where the lawyer judged a slice not fully
// cleared, a condition the floor's clamp had kept from being recorded, the run delivers CONDITIONAL on that condition
// alone. Either way the verdict on record, the sign-off, the published rating, the report the client opens, its own label
// and the audit workbook say the same thing. An account that cannot be read closes nothing; that case is driven at the
// decision, in a-gap-a-guard-finds-closed-gives-back-only-the-result-it-moved.test.mjs.
//
// THE OPEN FLOOR IS PLANTED. No mock setting leaves a floor open at the delivery checks and lets a later repeat of
// placement answer it: an open floor at the park makes the resume run placement again rather than inherit it, and that
// pass is then never repeated. So the executor, at the recheck that moves the band, writes the floor account placement
// left with one more floor unanswered, an invented record. The repeat's own account replaces it. Own file = own process +
// own workspace root; the workspace and the call ledger are pinned before any driver module loads, so driver modules are
// imported dynamically. Every mark and owner is invented.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "clearotron-closedfloor-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = {
  id: "test-job-closedfloor", msgId: "<closedfloor@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8923", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const ON_CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" };

// Pass 1 parks on the reading step's turn, so placement has run and the resume inherits it.
const PARK_AT_DIGEST = "You are register DIGEST mode";
// A write-up failure whose recovery is spent is delivered without the assessment, so pass 1 takes a recovery park
// instead, and the stage it stopped at is the one its status records.
const parkedAt = (res) => JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8")).failedStage;
// The skeptic flags the code-side axis, so the resume re-runs its dictated entries and the band placement read moves.
const ESCALATE_SATPROBE = "- saturation-probe counts look thin\n\n## Escalation decisions\nESCALATE: saturation-probe — re-verify the crowd counts";
// The floor the plant leaves open: invented, live, in class, the mark itself.
const OPEN = { record_id: "/mark/us/90000099", mark: "NOVAPULSE", disposition: "unanswered" };

// The floor account placement left, with one more floor unanswered. Written once, at the recheck.
function plantOpenFloor(runDir) {
  const p = driverDir(runDir, "floor-duty.json");
  const a = JSON.parse(readFileSync(p, "utf8"));
  const t = a.totals ?? {};
  writeFileSync(p, JSON.stringify({ ...a, undischarged_by_seat: 1, rows: [...(a.rows ?? []), OPEN],
    totals: { ...t, floors: (t.floors ?? 0) + 1, unanswered: (t.unanswered ?? 0) + 1 } }, null, 2) + "\n");
}

// The executor plays the real tool: it writes the axis band itself and moves the counts on every call, so the recheck
// always changes the band. Once the run is named for planting, its next call, the recheck, plants the open floor.
const executor = (calls, plant) => async ({ planPath, axis, outputPath }) => {
  calls.push(axis);
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  writeFileSync(outputPath, JSON.stringify(plan.entries.filter((e) => e.axis === axis).map((e) => ({
    state: "incomplete", qid: e.qid, query: `${e.term} (count probe)`, total_hits: 1000 + 111 * calls.length, fetched: 0, sample: [],
    reason: "count-only crowd descriptor (plan-dictated)",
  })), null, 2) + "\n");
  if (plant.runDir && !plant.done) { plantOpenFloor(plant.runDir); plant.done = true; }
  return { ok: true, executed: 1, states: {} };
};

async function runMockPipeline(root, env, opts = {}, codename = null) {
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_COVERAGE_INSUFFICIENT",
    "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { ...(codename ? { codename } : {}), ...opts });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

// Pass 1 parks after placement, every floor answered. Pass 2 resumes with the skeptic's flag; the recheck moves the band
// and plants the open floor, the delivery checks clamp on it, and the delivery check repeats placement over the moved band.
async function plantedAndRepeated(env) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-closedfloor-"));
  const plant = {};
  const planExecutor = executor([], plant);
  const p1 = await runMockPipeline(root, { ...env, MOCK_FAIL_STAGE: PARK_AT_DIGEST, CLEAROTRON_RECOVERY_MAX: "1" }, { planExecutor });
  assert.equal(parkedAt(p1.res), "register-digest", `guard: pass 1 parks at the reading step (parked at ${parkedAt(p1.res)})`);
  const first = JSON.parse(readFileSync(driverDir(p1.res.runDir, "floor-duty.json"), "utf8"));
  assert.ok(first.totals.floors > 0 && first.totals.accounted === first.totals.floors, `guard: pass 1 answered every floor: ${JSON.stringify(first.totals)}`);
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  plant.runDir = p1.res.runDir;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline(root, { ...env, MOCK_SKEPTIC: ESCALATE_SATPROBE, ...(env.pass2 ?? {}) }, { planExecutor }, codename);
  const ev2 = p2.events.slice(n1);   // run.jsonl is append-only across passes
  assert.ok(plant.done, "guard: the recheck never ran, so nothing was planted");
  // the planted account is the one the delivery checks judged: nothing derived the floor again between the two
  const recheck = ev2.findIndex((e) => e.event === "escalation-recheck");
  const clamp = ev2.findIndex((e) => e.event === "terminal-guard-clamp");
  assert.ok(recheck >= 0 && clamp > recheck, `guard: the recheck and the floor's clamp, in that order (${recheck}, ${clamp})`);
  assert.deepEqual(ev2.slice(recheck, clamp).filter((e) => e.event === "floor-duty"), [], "guard: the floor was derived again before the delivery checks read it");
  assert.deepEqual(ev2.filter((e) => e.event === "terminal-guard-clamp").map((e) => [e.defect, e.from, e.to]),
    [["floor_duty_undischarged:1", "CLEAR", "CONDITIONAL"]], "guard: the delivery checks did not clamp on the open floor");
  assert.ok(ev2.some((e) => e.event === "stage" && e.stage === "placement-inquiry" && e.trigger === "stale-repair"),
    "guard: the delivery check did not repeat placement");
  const rd = p2.res.runDir;
  const json = (f) => JSON.parse(readFileSync(f, "utf8"));
  const status = json(join(rd, "status.json"));
  const published = join(root, "pool", status.runId);
  const book = readdirSync(join(root, "pool"), { recursive: true }).find((p) => String(p).endsWith("-audit.xlsx"));
  assert.ok(book, "the run published no workbook");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(root, "pool", book));
  const summary = [];
  wb.getWorksheet("Summary")?.eachRow((row) => summary.push(row.values.slice(1).map((v) => (v == null ? "" : String(v)))));
  const { clauseForDefect } = await import("../terminal-clamp.mjs");
  return { p2, ev2, rd, status, summary, floorDuty: json(driverDir(rd, "floor-duty.json")), verdict: json(driverDir(rd, "verdict.json")),
    data: json(join(published, "report-data.json")), settle: json(join(published, "settle.json")),
    html: readFileSync(join(published, "report.html"), "utf8"), md: readFileSync(join(rd, "report.md"), "utf8"),
    floorClause: clauseForDefect("floor_duty_undischarged", 1, first.totals.floors + 1) };
}

// One result, one set of conditions, wherever they are read.
function sameEverywhere({ p2, status, settle, verdict, data, html, md, summary }, result) {
  assert.equal(p2.res.ok, true, JSON.stringify({ fail: p2.res.fail, stage: p2.res.failedStage }));
  assert.deepEqual([p2.res.verdict, verdict.verdict, status.review.signoff, settle.signoff], Array(4).fill(result),
    "the delivered result differs between the surfaces it is read from");
  assert.equal(data.rating.statement, verdict.statement, "the delivered rating is not the verdict on record");
  assert.match(md, new RegExp(`^overall_label:\\s*${verdict.tier}\\s*$`, "m"), "the report's own label is not the verdict on record's");
  assert.deepEqual(summary.find((r) => r[0] === "Verdict")?.[1], verdict.statement, `the workbook's verdict is not the verdict on record: ${JSON.stringify(summary.slice(0, 8))}`);
}

for (const [engine, env] of [["claude", {}], ["codex", ON_CODEX]]) {
  test(`${engine}: a floor that was the only condition, answered by the repeat, is withdrawn and the run delivers CLEAR`, async () => {
    const run = await plantedAndRepeated(env);
    const { ev2, floorDuty, verdict, data, html, floorClause } = run;
    assert.equal(floorDuty.trigger, "stale-repair", "the floor on record is not the repeat's");
    assert.equal(floorDuty.totals.accounted, floorDuty.totals.floors, `the repeat left a floor open: ${JSON.stringify(floorDuty.totals)}`);
    assert.deepEqual(ev2.filter((e) => e.event === "guard-gap-closed").map((e) => [e.token, e.withdrawn]), [["floor_duty_undischarged", 1]],
      "the floor's clause was not withdrawn once");
    assert.deepEqual(ev2.filter((e) => e.event === "verdict-recomputed-gap-closed").map((e) => [e.from, e.to]), [["CONDITIONAL", "CLEAR"]]);
    assert.deepEqual(ev2.filter((e) => e.event === "floor-duty-after-repair").map((e) => [e.was, e.now]), [["CONDITIONAL", "CLEAR"]]);
    sameEverywhere(run, "CLEAR");
    assert.deepEqual(verdict.clauses, [], `the verdict on record still carries a condition: ${JSON.stringify(verdict.clauses)}`);
    assert.deepEqual(verdict.reasons ?? [], [], "the run record's reasons still name the floor");
    assert.deepEqual(data.rating.conditions, [], `the delivered rating still lists a condition: ${JSON.stringify(data.rating.conditions)}`);
    assert.ok(!html.includes(floorClause), "the report the client opens still names the floor");
  });

  test(`${engine}: a floor answered by the repeat beside a coverage judgment it had masked leaves CONDITIONAL on that judgment alone`, async () => {
    const run = await plantedAndRepeated({ ...env, pass2: { MOCK_COVERAGE_INSUFFICIENT: "1" } });
    const { ev2, verdict, data, html, floorClause } = run;
    // the floor's clamp came first, so the coverage judgment was never recorded while the floor stood
    assert.deepEqual(ev2.filter((e) => e.event === "coverage-floor-clamp").map((e) => e.cause), ["coverage"],
      "the coverage judgment was not met exactly once, after the floor's clause went");
    const closed = ev2.findIndex((e) => e.event === "guard-gap-closed");
    assert.ok(closed >= 0 && ev2.findIndex((e) => e.event === "coverage-floor-clamp") > closed,
      "the coverage judgment was not recorded after the floor's gap closed");
    sameEverywhere(run, "CONDITIONAL");
    const coverage = verdict.clauses.filter((c) => /^the lawyer judged a material slice not fully cleared/.test(c));
    assert.equal(coverage.length, 1, `the verdict on record does not carry the coverage judgment once: ${JSON.stringify(verdict.clauses)}`);
    assert.ok(!verdict.clauses.includes(floorClause), "the verdict on record still carries the floor's clause");
    assert.deepEqual(data.rating.conditions, verdict.clauses, "the delivered rating lists other conditions than the verdict on record");
    assert.ok(html.includes(coverage[0]) && !html.includes(floorClause), "the report the client opens does not state the one condition that stands");
  });
}

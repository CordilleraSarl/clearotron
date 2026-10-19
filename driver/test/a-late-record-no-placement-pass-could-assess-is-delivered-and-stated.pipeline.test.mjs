// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline through a park and a resumed pass whose placement passes all fail, on both engines
//
// A LATE RECORD NO PLACEMENT PASS COULD ASSESS IS DELIVERED, AND STATED.
//
// A run parks after placement and resumes. The code-side recheck brings two records into the band that placement never
// read: a live identical registration in class, which is a floor, and a live registration of another mark, which is
// neither a floor nor one the recall gate weighs. Placement's pass for them fails, and so does the delivery check's repeat
// of placement. The run is not held (ruled 2026-10-19). It delivers the report the last accepted passes built, and states
// what is open: the floor in the floor's approved sentence. The other record the reading step's next pass set aside in its
// own account, so the report addresses it and no sentence counts it. Both records stay identifiable in the run record,
// with the two attempts that failed.
// The verdict on record, the sign-off, the published rating, the report the client opens, its label and the audit
// workbook state one result and the same conditions. Own file = own process + own workspace root; the workspace and the
// call ledger are pinned before any driver module loads, so driver modules are imported dynamically. Every mark and owner
// is invented.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "clearotron-unassessed-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, sep } from "node:path";
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
  id: "test-job-unassessed", msgId: "<unassessed@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8925", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const ON_CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" };

// Pass 1 parks on the reading step's turn, so placement has run and the resume inherits it.
const PARK_AT_DIGEST = "You are register DIGEST mode";
// The skeptic flags the code-side axis, so the resume re-runs its dictated entries through the executor.
const ESCALATE_SATPROBE = "- saturation-probe counts look thin\n\n## Escalation decisions\nESCALATE: saturation-probe — re-verify the crowd counts";
// Placement's turn: failing it fails the late pass and the delivery check's repeat alike.
const PLACEMENT_TURN = `placement-inquiry${sep}SKILL`;
// The two records the recheck brings in. A live identical registration in class is a floor. The other is live and in
// class, but neither identical nor carrying the mark's dominant element, so neither the floor nor the recall gate
// weighs it, and the reading step's account does not end it.
const NEW_FLOOR = { record_id: "/mark/us/90000077", mark_text: "NOVAPULSE", classes: [9], status: "Registered",
  owner_name: "Second Owner GmbH", owner_country: "US", screen_verdict: "surface:in-scope-live" };
const NEW_OTHER = { record_id: "/mark/us/90000078", mark_text: "QUILLBERRY", classes: [9], status: "Registered",
  owner_name: "Third Owner Ltd", owner_country: "US", screen_verdict: "surface:in-scope-live" };

// The executor plays the real tool: it writes the axis band itself, and every call after the first pass's, the
// recheck's, adds the two records and moves the counts.
const executor = (calls) => async ({ planPath, axis, outputPath }) => {
  calls.push(axis);
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const blocks = plan.entries.filter((e) => e.axis === axis).map((e) => ({
    state: "incomplete", qid: e.qid, query: `${e.term} (count probe)`, total_hits: 1000 + 111 * calls.length, fetched: 0, sample: [],
    reason: "count-only crowd descriptor (plan-dictated)",
  }));
  if (calls.length > 1) blocks.push({ state: "enumerated", qid: `supp:${axis}:mock:exact-live:00000077`,
    query: `${axis} / exact-in-class-live`, total_hits: 2, records: [NEW_FLOOR, NEW_OTHER] });
  writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
  return { ok: true, executed: blocks.length, states: {} };
};

async function runMockPipeline(root, env, opts = {}, codename = null) {
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"]) delete process.env[k];
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

for (const [engine, env] of [["claude", {}], ["codex", ON_CODEX]]) {
  test(`${engine}: late records no placement pass could assess are delivered, with what stays open stated and the attempts on record`, async () => {
    const root = mkdtempSync(join(tmpdir(), "clearotron-unassessed-"));
    const planExecutor = executor([]);
    const p1 = await runMockPipeline(root, { ...env, MOCK_FAIL_STAGE: PARK_AT_DIGEST }, { planExecutor });
    assert.equal(p1.res.failedStage, "register-digest", `guard: pass 1 parks at the reading step (parked at ${p1.res.failedStage})`);
    const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
    const n1 = p1.events.length;
    const p2 = await runMockPipeline(root, { ...env, MOCK_SKEPTIC: ESCALATE_SATPROBE, MOCK_FAIL_STAGE: PLACEMENT_TURN }, { planExecutor }, codename);
    const ev2 = p2.events.slice(n1);   // run.jsonl is append-only across passes
    const rd = p2.res.runDir;
    const json = (f) => JSON.parse(readFileSync(f, "utf8"));
    const band = json(join(rd, "register-named-band.json")).enumerated.map((r) => r.record_id);
    assert.ok([NEW_FLOOR, NEW_OTHER].every((r) => band.includes(r.record_id)), "guard: the recheck's records reached the band placement reads");

    // both attempts to assess them failed, and the run was not held
    assert.deepEqual(ev2.filter((e) => e.event === "late-evidence-failed").map((e) => e.records), [2], "the late pass's failure is not on record");
    assert.ok(ev2.some((e) => e.event === "stage" && e.stage === "placement-inquiry" && e.trigger === "stale-repair" && e.ok === false)
      || ev2.some((e) => e.event === "delivery-stale-repair" && e.stages.includes("placement-inquiry")), "guard: the delivery check did not try placement again");
    assert.equal(p2.res.ok, true, JSON.stringify({ fail: p2.res.fail, stage: p2.res.failedStage }));
    assert.deepEqual(ev2.filter((e) => e.event === "delivery-stale-blocked"), [], "the run was held on a placement pass that could not complete");
    assert.ok(existsSync(join(rd, ".delivered")), "the run did not deliver");
    const unassessed = ev2.filter((e) => e.event === "late-evidence-unassessed-delivered");
    assert.equal(unassessed.length, 1, "the delivery does not record the late records it could not have assessed");
    assert.deepEqual([...unassessed[0].ids].sort(), [NEW_FLOOR.record_id, NEW_OTHER.record_id], "the late records are not identifiable in the run record");
    assert.equal(unassessed[0].latePass?.records, 2, "the late pass's attempt is not in the delivery record");
    assert.ok(unassessed[0].repeat, "the delivery check's failed repeat is not in the delivery record");

    // what is open is stated, each record once, in its approved sentence
    const { clauseForDefect } = await import("../terminal-clamp.mjs");
    const duty = json(driverDir(rd, "floor-duty.json"));
    assert.deepEqual(duty.rows.filter((r) => r.disposition === "unanswered").map((r) => r.record_id), [NEW_FLOOR.record_id],
      `the floor on record does not hold the late floor open: ${JSON.stringify(duty.totals)}`);
    const floorClause = clauseForDefect("floor_duty_undischarged", 1, duty.totals.floors);
    // The other record is outside the floor and outside what the recall gate weighs. The reading step's pass after the
    // late pass read it and set it aside in its own account, so the report addresses it there, and the sentence for
    // records neither addressed nor set aside does not hold for it (that predicate is driven where it holds, in
    // a-late-record-the-report-does-not-address-is-counted.test.mjs).
    const negative = readFileSync(join(rd, "register-findings.md"), "utf8").split(/^#{1,6}\s+Negative results.*$/m)[1] ?? "";
    assert.ok(negative.includes(NEW_OTHER.record_id), "guard: the reading step's account does not set the other late record aside");
    assert.deepEqual(ev2.filter((e) => e.event === "recall-reconciliation-unended-delivered"), [], "a record the report addresses was counted as unaddressed");

    // one result, and the same conditions, wherever they are read
    const verdict = json(driverDir(rd, "verdict.json"));
    const status = json(join(rd, "status.json"));
    const published = join(root, "pool", status.runId);
    const settle = json(join(published, "settle.json"));
    const data = json(join(published, "report-data.json"));
    const html = readFileSync(join(published, "report.html"), "utf8");
    assert.deepEqual([p2.res.verdict, verdict.verdict, status.review.signoff, settle.signoff], Array(4).fill("CONDITIONAL"),
      "the delivered result differs between the surfaces it is read from");
    assert.deepEqual(verdict.clauses, [floorClause], `the verdict on record does not state the late floor alone: ${JSON.stringify(verdict.clauses)}`);
    assert.deepEqual(data.rating.conditions, [floorClause], `the delivered rating does not list the late floor alone: ${JSON.stringify(data.rating.conditions)}`);
    assert.ok(html.includes(floorClause), "the report the client opens does not state the late floor");
    assert.equal(data.rating.statement, verdict.statement, "the delivered rating is not the verdict on record");
    assert.match(readFileSync(join(rd, "report.md"), "utf8"), new RegExp(`^overall_label:\\s*${verdict.tier}\\s*$`, "m"),
      "the report's own label is not the verdict on record's");
    const book = readdirSync(join(root, "pool"), { recursive: true }).find((p) => String(p).endsWith("-audit.xlsx"));
    assert.ok(book, "the run published no workbook");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(root, "pool", book));
    const summary = [];
    wb.getWorksheet("Summary")?.eachRow((row) => summary.push(row.values.slice(1).map((v) => (v == null ? "" : String(v)))));
    assert.equal(summary.find((r) => r[0] === "Verdict")?.[1], verdict.statement, "the workbook's verdict is not the verdict on record");
    // the other late record is set aside where the client reads it: the delivered audit trail and the workbook's search log
    assert.ok(readFileSync(join(published, "audit.md"), "utf8").includes(NEW_OTHER.record_id), "the delivered audit trail does not carry the other late record");
    const searched = [];
    wb.getWorksheet("What was searched")?.eachRow((row) => searched.push(row.values.slice(1).map((v) => (v == null ? "" : String(v))).join(" | ")));
    assert.ok(searched.some((r) => r.includes(NEW_OTHER.record_id) && /screened out/.test(r)), "the workbook's search log does not set the other late record aside");
    assert.ok(readFileSync(join(rd, "audit.md"), "utf8").split("\n").some((l) => l.includes(NEW_FLOOR.record_id) && l.includes("unanswered at delivery")),
      "the audit trail does not list the late floor as open at delivery");
  });
}

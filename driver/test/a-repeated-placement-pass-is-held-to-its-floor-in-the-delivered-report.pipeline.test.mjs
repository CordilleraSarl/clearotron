// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline run, parks it after placement, and resumes it into a repeated placement pass
//
// A REPEATED PLACEMENT PASS IS HELD TO ITS OWN FLOOR, AND THE DELIVERED REPORT, ITS VERDICT AND THE RUN RECORD AGREE.
//
// On a resumed run the delivery gate repeats a placement pass whose inputs moved after it was inherited, and the
// report is rebuilt from the repeat. The floor was judged on the earlier pass. Now the same floor is applied to the
// repeat's account, through the same clamp, so the verdict the client reads, the floor it was held to and the
// verdict on record describe the one pass the report was built from. The record-carry trace and the Audit Trail,
// written before the repair, are written again after it, and the earlier pair is kept under _history. A repeat that
// answers every floor changes nothing. Own file = own process + own workspace root; the workspace and the call ledger
// are pinned before any driver module loads, so driver modules are imported dynamically. Every mark and owner is
// invented.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "clearotron-repeatfloor-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = {
  id: "test-job-repeatfloor", msgId: "<repeatfloor@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8913", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

// Pass 1 parks on the reading step's turn, so placement has run and the resume inherits it.
const PARK_AT_DIGEST = "You are register DIGEST mode";
// The skeptic flags the code-side axis, so the resume re-runs its dictated entries through the executor.
const ESCALATE_SATPROBE = "- saturation-probe counts look thin\n\n## Escalation decisions\nESCALATE: saturation-probe — re-verify the crowd counts";
// The record the recheck brings in: live, in class, the mark itself, held by an owner the band did not carry before.
const NEW_FLOOR = { record_id: "/mark/us/90000077", mark_text: "NOVAPULSE", classes: [9], status: "Registered",
  owner_name: "Second Owner GmbH", owner_country: "US", screen_verdict: "surface:in-scope-live" };

// The executor plays the real tool: it writes the axis band itself, one block per dictated entry. `withFloor` adds the
// record above on every call after the first pass's, which is the recheck's; each call also moves the counts, so the
// recheck always changes the band.
const executor = (calls, { withFloor }) => async ({ planPath, axis, outputPath }, { sessionKey }) => {
  calls.push({ axis, sessionKey });
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const blocks = plan.entries.filter((e) => e.axis === axis).map((e) => ({
    state: "incomplete", qid: e.qid, query: `${e.term} (count probe)`, total_hits: 1000 + 111 * calls.length, fetched: 0, sample: [],
    reason: "count-only crowd descriptor (plan-dictated)",
  }));
  if (withFloor && calls.length > 1) blocks.push({ state: "enumerated", qid: `supp:${axis}:mock:exact-live:00000077`,
    query: `${axis} / exact-in-class-live`, total_hits: 1, records: [NEW_FLOOR] });
  writeFileSync(outputPath, JSON.stringify(blocks, null, 2) + "\n");
  return { ok: true, executed: blocks.length, states: {} };
};

async function runMockPipeline(env, opts = {}, reuse = null) {
  const root = reuse?.root ?? mkdtempSync(join(tmpdir(), "clearotron-repeatfloor-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_PLACEMENT_NO_SIBLING"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { ...(reuse?.codename ? { codename: reuse.codename } : {}), ...opts });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events, root };
}

// Pass 1 parks after placement; pass 2 resumes with the skeptic's flag. On the resume the repeated placement hands back
// nothing new, so the earlier pass's rows stand and a record the band gained since is a floor nobody answered.
async function parkAndResume({ withFloor }) {
  const calls = [];
  const planExecutor = executor(calls, { withFloor });
  const p1 = await runMockPipeline({ MOCK_FAIL_STAGE: PARK_AT_DIGEST }, { planExecutor });
  assert.equal(p1.res.ok, false, "pass 1 parks");
  assert.equal(p1.res.failedStage, "register-digest", `pass 1 parks at the reading step (parked at ${p1.res.failedStage})`);
  assert.ok(p1.events.some((e) => e.event === "stage" && e.stage === "placement-inquiry"), "placement ran in pass 1");
  const duty1 = JSON.parse(readFileSync(driverDir(p1.res.runDir, "floor-duty.json"), "utf8"));
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  const p2 = await runMockPipeline({ MOCK_SKEPTIC: ESCALATE_SATPROBE, MOCK_PLACEMENT_NO_SIBLING: "1" }, { planExecutor }, { root: p1.root, codename });
  const ev2 = p2.events.slice(n1);   // run.jsonl is append-only across passes
  // the window really opened: placement was inherited, and the recheck moved the band after it
  assert.ok(ev2.some((e) => e.event === "skip" && e.stage === "placement-inquiry"), "the resume inherited placement");
  assert.ok(ev2.some((e) => e.event === "escalation-recheck" && e.axis === "saturation-probe" && e.bandChanged === true),
    "the recheck re-ran the axis and changed its band");
  const rd = p2.res.runDir;
  const json = (f) => JSON.parse(readFileSync(f, "utf8"));
  const status = json(join(rd, "status.json"));
  const published = join(p2.root, "pool", status.runId);
  const kept = readdirSync(join(rd, "_history")).filter((d) => d.endsWith("audit-and-trace-stale-repair"));
  return { p2, duty1, ev2, rd, json, status, published, kept,
    duty2: json(driverDir(rd, "floor-duty.json")), verdict: json(driverDir(rd, "verdict.json")),
    html: readFileSync(join(published, "report.html"), "utf8"), data: json(join(published, "report-data.json")), settle: json(join(published, "settle.json")) };
}

test("a record the band gains after placement is assessed by placement before the writer, and the floor it leaves unanswered clamps the report alike everywhere", async () => {
  const { clauseForDefect } = await import("../terminal-clamp.mjs");
  const { p2, duty1, ev2, rd, json, status, duty2, verdict, html, data, settle, kept } = await parkAndResume({ withFloor: true });
  // the earlier pass answered every floor it was given
  assert.ok(duty1.totals.floors > 0, "guard: the earlier pass had floors to answer");
  assert.equal(duty1.totals.accounted, duty1.totals.floors, `the earlier pass answered every floor: ${JSON.stringify(duty1.totals)}`);

  // the late record was assessed in the run, before the writer: placement ran again over the grown band, once
  assert.ok(json(join(rd, "register-named-band.json")).enumerated.some((r) => r.record_id === NEW_FLOOR.record_id),
    "the record the recheck brought in reached the band placement reads");
  assert.deepEqual(ev2.filter((e) => e.event === "late-evidence").map((e) => e.records), [1], "the late record was not assessed");
  const placementRuns = ev2.filter((e) => e.event === "stage" && e.stage === "placement-inquiry").map((e) => e.trigger);
  assert.deepEqual(placementRuns, ["late-evidence"], `placement ran other than once to assess the late record: ${JSON.stringify(placementRuns)}`);
  const at = (pred) => ev2.findIndex(pred);
  assert.ok(at((e) => e.event === "stage" && e.stage === "placement-inquiry") < at((e) => e.event === "stage" && e.stage === "synthesis"),
    "placement assessed the late record after the writer had read the band");
  assert.equal(duty2.trigger, "late-evidence", "the floor on record is not the assessing pass's");
  assert.equal(duty2.totals.floors, duty1.totals.floors + 1);
  assert.deepEqual(duty2.rows.filter((r) => r.disposition === "unanswered").map((r) => r.record_id), [NEW_FLOOR.record_id]);

  // the floor's clamp, once, at the delivery checks: no repeat at delivery and nothing to rebuild there
  assert.deepEqual(ev2.filter((e) => e.event === "terminal-guard-clamp").map((e) => [e.defect, e.from, e.to]),
    [["floor_duty_undischarged:1", "CLEAR", "CONDITIONAL"]]);
  assert.deepEqual(ev2.filter((e) => e.event === "floor-duty-after-repair" || e.event === "audit-rebuilt"), [], "the delivery check repeated placement anyway");
  assert.deepEqual(kept, [], "guard: nothing was rebuilt at delivery");

  // one state, wherever it is read: the run's answer, the verdict on record, the sign-off and the report the client opens
  const clause = clauseForDefect("floor_duty_undischarged", 1, duty2.totals.floors);
  assert.equal(p2.res.ok, true, JSON.stringify({ fail: p2.res.fail, stage: p2.res.failedStage }));
  assert.ok(existsSync(join(rd, ".delivered")), "the run delivered");
  assert.equal(p2.res.verdict, "CONDITIONAL");
  assert.equal(verdict.verdict, "CONDITIONAL");
  assert.ok(verdict.clauses.includes(clause), `the verdict on record carries the floor's clause: ${JSON.stringify(verdict.clauses)}`);
  assert.equal(status.review.signoff, "CONDITIONAL");
  assert.equal(settle.signoff, "CONDITIONAL");
  assert.equal(data.rating.statement, verdict.statement, "the report's rating carries the verdict on record");
  assert.ok(data.rating.conditions.includes(clause), `the report's rating lists the floor's clause: ${JSON.stringify(data.rating.conditions)}`);
  assert.ok(html.includes(clause), "the report the client opens names the unanswered floor");
  assert.ok(readFileSync(join(rd, "audit.md"), "utf8").split("\n").some((l) => l.includes(NEW_FLOOR.record_id) && l.includes("unanswered at delivery")),
    "the audit trail lists the record as open at delivery");

  // the trace and the audit are built after the assessing pass, so they say what it did: placement saw the record and
  // placed nothing for it. No doubt says nobody recorded a verdict on it.
  const row = json(driverDir(rd, "record-carry.json")).rows.find((r) => r.uri === NEW_FLOOR.record_id);
  assert.deepEqual([row?.reach, row?.stopped_at, row?.reason], ["screened", "placement", "placement:not-selected"],
    `the trace does not describe the assessing pass: ${JSON.stringify(row)}`);
  assert.deepEqual(readFileSync(join(rd, "audit.md"), "utf8").split("\n").filter((l) => l.includes("[record-carry]") && l.includes(NEW_FLOOR.record_id)), [],
    "the delivered audit says nobody recorded a verdict on a record placement assessed");
});

test("a repeated placement pass that answers every floor changes nothing: the verdict stands and no clause is added", async () => {
  const { duty1, ev2, duty2, verdict, html, data, status, settle, p2, rd, json, kept } = await parkAndResume({ withFloor: false });
  // only the counts moved: no record placement had not seen, so nothing is assessed late, and the delivery check
  // repeats the inherited placement over the moved band
  assert.deepEqual(ev2.filter((e) => e.event === "late-evidence"), [], "a band whose counts alone moved was assessed as late evidence");
  assert.ok(ev2.some((e) => e.event === "stage" && e.stage === "placement-inquiry" && e.trigger === "stale-repair"),
    "the delivery gate did not repeat placement over the moved band");
  assert.equal(duty2.trigger, "stale-repair", "the control reached the same repeat");
  assert.equal(duty2.totals.floors, duty1.totals.floors);
  assert.equal(duty2.totals.accounted, duty2.totals.floors, `every floor is still answered: ${JSON.stringify(duty2.totals)}`);
  assert.deepEqual(ev2.filter((e) => e.event === "floor-duty-after-repair").map((e) => [e.was, e.now]), [["CLEAR", "CLEAR"]]);
  assert.deepEqual(ev2.filter((e) => e.event === "terminal-guard-clamp"), [], "nothing was clamped");
  assert.equal(p2.res.ok, true);
  assert.equal(p2.res.verdict, "CLEAR");
  assert.equal(verdict.verdict, "CLEAR");
  assert.equal(status.review.signoff, "CLEAR");
  assert.equal(settle.signoff, "CLEAR");
  const floorClause = /identical or near-identical to the mark are not individually addressed/;
  assert.ok(!verdict.clauses.some((c) => floorClause.test(c)) && !data.rating.conditions.some((c) => floorClause.test(c)), "no floor clause on record");
  assert.ok(!floorClause.test(html), "the report carries no floor clause");
  // the trace and the audit are written again after the repair, the pair and the doubt ledger before it are kept, and
  // with nothing changed the trace says what it said before and no doubt is minted or dropped
  assert.equal(kept.length, 1, "guard: the repair kept the earlier trace");
  const [earlier, now] = [json(join(rd, "_history", kept[0], "record-carry.json")), json(driverDir(rd, "record-carry.json"))];
  assert.equal(now.trigger, "stale-repair", "the trace was not written again after the repair");
  assert.deepEqual(now.totals, earlier.totals, "a repair that changed nothing changed the trace's counts");
  assert.deepEqual(ev2.filter((e) => e.event === "audit-rebuilt").map((e) => e.trigger), ["stale-repair"], "the audit was not written again after the repair");
  for (const f of ["audit.md", "doubts.json"])
    assert.ok(existsSync(join(rd, "_history", kept[0], f)), `the ${f} written before the repair was not kept`);
  assert.deepEqual(ev2.filter((e) => e.event === "record-carry-doubts-again"), [], "a repair that changed nothing minted or dropped a doubt");
});

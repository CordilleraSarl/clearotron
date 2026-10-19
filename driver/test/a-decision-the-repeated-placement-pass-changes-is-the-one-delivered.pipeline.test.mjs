// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline through a park and a resumed pass that repeats placement and delivers, on both engines
//
// A DECISION THE REPEATED PLACEMENT PASS CHANGES IS THE ONE DELIVERED, IN THE REPORT'S RECORD AND ITS AUDIT TRAIL ALIKE.
//
// On a resumed run the delivery check repeats a placement pass whose inputs moved after it was inherited. Here the
// repeat changes the ground of the set-aside the first pass made. The reading step, the writer and the review all read
// that decision, so the check runs the three again in the same pass, in that order, and the reviewer is given the whole
// review. The run is not held. What it delivers states the new ground everywhere it is recorded: the decisions the
// stages are told, the record-carry trace, the Audit Trail delivered with the report, the floor and the verdict. The
// earlier audit, with the ground it then stated, is kept under _history. Own file = own process + own workspace root;
// the workspace and the call ledger are pinned before any driver module loads, so driver modules are imported
// dynamically. Every mark and owner is invented.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "clearotron-repeatground-ledger-")), "corsearch-calls.jsonl");
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
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = {
  id: "test-job-repeatground", msgId: "<repeatground@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8917", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const ON_CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" };

// Pass 1 parks on the reading step's turn, so placement has run and the resume inherits it.
const PARK_AT_DIGEST = "You are register DIGEST mode";
// The skeptic flags the code-side axis, so the resume re-runs its dictated entries and the band placement read moves.
const ESCALATE_SATPROBE = "- saturation-probe counts look thin\n\n## Escalation decisions\nESCALATE: saturation-probe — re-verify the crowd counts";
const G1 = "the registration lapsed before the client's first use";
const G2 = "the registration lapsed, and the owner let its renewal pass";

// The executor plays the real tool: it writes the axis band itself, one block per dictated entry, and moves the counts
// on every call, so the recheck always changes the band.
const executor = (calls) => async ({ planPath, axis, outputPath }) => {
  calls.push(axis);
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  writeFileSync(outputPath, JSON.stringify(plan.entries.filter((e) => e.axis === axis).map((e) => ({
    state: "incomplete", qid: e.qid, query: `${e.term} (count probe)`, total_hits: 1000 + 111 * calls.length, fetched: 0, sample: [],
    reason: "count-only crowd descriptor (plan-dictated)",
  })), null, 2) + "\n");
  return { ok: true, executed: 1, states: {} };
};

async function runMockPipeline(root, env, opts = {}, codename = null) {
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_PLACEMENT_SET_ASIDE", "MOCK_CLAUDE_CALL_LOG", "MOCK_CODEX_CALL_LOG",
    "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_CLAUDE_CALL_LOG: join(root, "engine-calls.jsonl"), MOCK_CODEX_CALL_LOG: join(root, "engine-calls.jsonl"), ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { ...(codename ? { codename } : {}), ...opts });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}
const promptsOf = (root) => (existsSync(join(root, "engine-calls.jsonl"))
  ? readFileSync(join(root, "engine-calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).prompt ?? "") : []);

for (const [engine, env] of [["claude", {}], ["codex", ON_CODEX]]) {
  test(`${engine}: the ground a repeated placement pass changes is read again in the same pass, and what it delivers states it everywhere`, async () => {
    const root = mkdtempSync(join(tmpdir(), "clearotron-repeatground-"));
    const planExecutor = executor([]);
    // ── pass 1: placement sets the line aside on its status with G1, and the run parks at the reading step ──
    const p1 = await runMockPipeline(root, { ...env, MOCK_FAIL_STAGE: PARK_AT_DIGEST, MOCK_PLACEMENT_SET_ASIDE: G1 }, { planExecutor });
    assert.equal(p1.res.failedStage, "register-digest", `guard: pass 1 parks at the reading step (parked at ${p1.res.failedStage})`);
    const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;

    // ── pass 2: the recheck moves the band, the delivery check repeats placement, the repeat states G2, and the three
    //    stages that read the decision run again in the same pass ──
    const n1 = p1.events.length, before = promptsOf(root).length;
    const p2 = await runMockPipeline(root, { ...env, MOCK_SKEPTIC: ESCALATE_SATPROBE, MOCK_PLACEMENT_SET_ASIDE: G2 }, { planExecutor }, codename);
    const ev2 = p2.events.slice(n1);   // run.jsonl is append-only across passes
    assert.ok(ev2.some((e) => e.event === "skip" && e.stage === "placement-inquiry"), "guard: the resume inherited placement");
    const repeat = ev2.findIndex((e) => e.event === "stage" && e.stage === "placement-inquiry" && e.trigger === "stale-repair");
    assert.ok(repeat >= 0, "guard: the delivery check repeated placement");
    assert.equal(p2.res.ok, true, JSON.stringify({ fail: p2.res.fail, stage: p2.res.failedStage }));
    assert.deepEqual(ev2.filter((e) => e.event === "delivery-stale-blocked"), [], "the run was held on the stages that read the decision");
    const queued = ev2.filter((e) => e.event === "delivery-stale-requeued" && e.after === "placement-inquiry").flatMap((e) => e.stages);
    assert.deepEqual([...queued].sort(), ["narrative-refutation", "register-digest", "synthesis"],
      `the three stages that read the decision were not queued after the repeat: ${JSON.stringify(queued)}`);
    const ranAt = ["register-digest", "synthesis", "narrative-refutation"]
      .map((stage) => ev2.findIndex((e, i) => i > repeat && e.event === "stage" && e.stage === stage && e.trigger === "stale-repair"));
    assert.ok(ranAt.every((i) => i > repeat) && ranAt[0] < ranAt[1] && ranAt[1] < ranAt[2],
      `the reading step, the writer and the review did not run again after the repeat, in that order: ${JSON.stringify(ranAt)}`);
    assert.ok(ev2.some((e, i) => i > ranAt[2] && e.event === "post-repair-review" && e.whole === true && e.read === true),
      "the reviewer the changed decision queued was not given the whole review");
    assert.deepEqual(ev2.filter((e) => e.event === "writer-duty-after-repair").map((e) => [e.was, e.now]), [["CLEAR", "CLEAR"]],
      "the writer was not judged again against its duty and the recall gate");
    const rd = p2.res.runDir;
    const sent = promptsOf(root).slice(before);
    for (const [who, marker] of [["the reading step", "You are register DIGEST mode"], ["the writer", "Produce the joint synthesis narrative"]]) {
      const p = sent.filter((x) => x.includes(marker)).at(-1) ?? "";
      assert.ok(p.includes(`: set aside on its status: ${G2}`), `${who} was not told the repeat's ground`);
      assert.ok(!p.includes(G1), `${who} was still told the earlier ground`);
    }

    // one decision, wherever it is recorded
    const json = (f) => JSON.parse(readFileSync(f, "utf8"));
    const status = json(join(rd, "status.json"));
    const published = join(root, "pool", status.runId);
    assert.deepEqual(json(driverDir(rd, "placement-decisions.json")).decisions.map((d) => d.ground), [G2]);
    for (const [where, file] of [["the run's audit", join(rd, "audit.md")], ["the published audit", join(published, "audit.md")]]) {
      const audit = readFileSync(file, "utf8");
      assert.ok(audit.includes(`- rationale: ${G2}`), `${where} does not state the ground that stands`);
      assert.ok(!audit.includes(G1), `${where} still states the earlier ground`);
    }
    const carry = JSON.stringify(json(driverDir(rd, "record-carry.json")).rows);
    assert.ok(carry.includes(G2) && !carry.includes(G1), "the record-carry trace does not state the ground that stands");
    const duty = json(driverDir(rd, "floor-duty.json"));
    assert.equal(duty.totals.accounted, duty.totals.floors, `the floor on record is not answered: ${JSON.stringify(duty.totals)}`);
    assert.equal(p2.res.verdict, "CLEAR");
    assert.equal(json(driverDir(rd, "verdict.json")).verdict, "CLEAR");
    assert.equal(status.review.signoff, "CLEAR");

    // the earlier state is history: an audit written before the repair, stating G1, is kept
    const keptAudits = readdirSync(join(rd, "_history")).filter((d) => d.includes("-audit-and-trace-"))
      .map((d) => join(rd, "_history", d, "audit.md")).filter((f) => existsSync(f));
    assert.ok(keptAudits.some((f) => readFileSync(f, "utf8").includes(`- rationale: ${G1}`)), "the audit that stated the earlier ground was not kept");
  });
}

test("claude: a writer that cannot re-run for the changed decision does not hold the run — it delivers, and the run record names what went unread", async () => {
  const root = mkdtempSync(join(tmpdir(), "clearotron-repeatground-unread-"));
  const planExecutor = executor([]);
  const p1 = await runMockPipeline(root, { MOCK_FAIL_STAGE: PARK_AT_DIGEST, MOCK_PLACEMENT_SET_ASIDE: G1 }, { planExecutor });
  assert.equal(p1.res.failedStage, "register-digest", `guard: pass 1 parks at the reading step (parked at ${p1.res.failedStage})`);
  const codename = JSON.parse(readFileSync(join(p1.res.runDir, "status.json"), "utf8")).codename;
  const n1 = p1.events.length;
  // The writer's re-run is the one dispatch told the repeat's ground, so failing that fails it alone.
  const p2 = await runMockPipeline(root, { MOCK_SKEPTIC: ESCALATE_SATPROBE, MOCK_PLACEMENT_SET_ASIDE: G2,
    MOCK_FAIL_STAGE: `Produce the joint synthesis narrative&&: set aside on its status: ${G2}` }, { planExecutor }, codename);
  const ev2 = p2.events.slice(n1);
  assert.ok(ev2.some((e) => e.event === "delivery-stale-requeued" && e.after === "placement-inquiry" && e.stages.includes("synthesis")),
    "guard: the changed decision queued the writer");
  assert.equal(p2.res.ok, true, JSON.stringify({ fail: p2.res.fail, stage: p2.res.failedStage }));
  assert.deepEqual(ev2.filter((e) => e.event === "delivery-stale-blocked"), [], "the run was held on a writer that could not re-run");
  const unread = ev2.filter((e) => e.event === "changed-decision-unread-delivered");
  assert.equal(unread.length, 1, "the run record does not say a changed decision went unread");
  assert.deepEqual(unread[0].stages.map((x) => x.label), ["synthesis"]);
  assert.ok(unread[0].stages[0].changed.some((c) => /placement/.test(c)), `the record does not name what the writer did not read: ${JSON.stringify(unread[0])}`);
  // The report gives the ranking the writer last read, and says so in the owner's words, singular for one record.
  const { clauseForDefect } = await import("../terminal-clamp.mjs");
  const clause = clauseForDefect("ranking_changed_unread", 1, 1);
  assert.equal(clause, "1 register record was re-ranked after this report was written; the audit trail gives its final ranking");
  assert.equal(clauseForDefect("ranking_changed_unread", 3, 40), "3 register records were re-ranked after this report was written; the audit trail gives their final ranking");
  assert.deepEqual(ev2.filter((e) => e.event === "ranking-changed-unread-delivered").map((e) => e.records), [1],
    "the record the repeat re-ranked was not counted once");
  assert.deepEqual(ev2.filter((e) => e.event === "terminal-guard-clamp" && /^ranking_changed_unread:/.test(e.defect)).map((e) => [e.from, e.to]),
    [["CLEAR", "CONDITIONAL"]], "a clear result was not made conditional");
  // one result, and one sentence, wherever they are read
  const rd = p2.res.runDir;
  const json = (f) => JSON.parse(readFileSync(f, "utf8"));
  const status = json(join(rd, "status.json"));
  const published = join(root, "pool", status.runId);
  const verdict = json(driverDir(rd, "verdict.json"));
  const settle = json(join(published, "settle.json"));
  assert.deepEqual([p2.res.verdict, verdict.verdict, status.review.signoff, settle.signoff], Array(4).fill("CONDITIONAL"),
    "the delivered result differs between the surfaces it is read from");
  assert.ok(verdict.clauses.includes(clause), `the verdict on record does not carry the sentence: ${JSON.stringify(verdict.clauses)}`);
  const data = json(join(published, "report-data.json"));
  assert.ok(data.rating.conditions.includes(clause), `the delivered rating does not list the sentence: ${JSON.stringify(data.rating.conditions)}`);
  assert.equal(data.rating.statement, verdict.statement, "the delivered rating is not the verdict on record");
  assert.ok(readFileSync(join(published, "report.html"), "utf8").includes(clause), "the report the client opens does not carry the sentence");
  assert.match(readFileSync(join(rd, "report.md"), "utf8"), new RegExp(`^overall_label:\\s*${verdict.tier}\\s*$`, "m"),
    "the report's own label is not the verdict on record's");
});

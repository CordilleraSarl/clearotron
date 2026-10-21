// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives a mock pipeline whose safety net on follow-up searches is full, on both engines
//
// A RUN WHOSE SAFETY NET ON FOLLOW-UP SEARCHES IS FULL STILL DELIVERS, WITH THE QUESTIONS IT DID NOT ASK STATED.
//
// The run's follow-up searches share one net in code, every worker and pass together, which no model reads. When it
// is full, the run calls it: no further follow-up is sent, the run keeps what it has, records what it did not ask,
// and carries on to placement and delivery with the gap stated. It is never killed, held or discarded. Here the
// run's follow-ups have filled the net and one follow-up still owns no answer. The plan join sends it back to be
// run, the real plan executor holds it back without asking the register, and the run delivers: the question is on
// the receipt as not asked, the class line says it could not be searched, and its question stays open. Own file = own process + own workspace
// root; the workspace and the call ledger are pinned before any driver module loads, so driver modules are imported
// dynamically. Every mark is invented.
import { mkdtempSync as __mkdtemp, writeFileSync as __write } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "clearotron-testroot-")));
const LEDGER = __join(__mkdtemp(__join(__tmpdir(), "clearotron-allowance-ledger-")), "register-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
__write(LEDGER, "");
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, chmodSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
  id: "test-job-allowance", msgId: "<allowance@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8931", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const ON_CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" };
const FOLLOW_UP_TERM = "QUILLWAVE";
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });

// The register's stand-in and the real plan executor. The code-side count unit, which runs while the register units
// gather, finds the run's follow-ups have spent the allowance and leaves one follow-up on file with no answer. Every
// later dispatch, the plan join's repair among them, goes through the real executor, its allowance and the shared
// call ledger.
async function executor(asked) {
  const { makeExecutePlan } = await import("../../providers/_shared/execute-plan.mjs");
  const { makeLedger } = await import("../../providers/_shared/ledger.mjs");
  const { SEARCHES_FILE, FOLLOW_UP_SEARCH_LIMIT } = await import("../../providers/_shared/follow-up-searches.mjs");
  const { logCall } = makeLedger("stand-in");
  const answer = (p, t) => { asked.push(p.name ?? (p.names ?? []).join("+")); logCall(t, { http_status: 200, ok: true, cache_hit: false }); };
  const kernel = makeExecutePlan({
    search: async (_a, p, t) => { answer(p, t); return ok({ total_hits: 0, results: [], has_more: false }); },
    enumerate: async (_a, p, t) => { answer(p, t); return ok({ state: "enumerated", total_hits: 0, count: 0, records: [] }); },
    capabilities: { id: "a-register-that-needs-no-office" },
  });
  let qid = null;
  const run = async ({ planPath, axis, outputPath, qids }, c) => {
    if (!qid) {
      const plan = JSON.parse(readFileSync(planPath, "utf8"));
      const target = plan.entries.map((e) => e.axis).find((a) => a !== axis);
      const units = join(dirname(dirname(planPath)), "register-units");
      mkdirSync(units, { recursive: true });
      qid = `supp:${target}:exact:quillwave:0000a11c`;
      writeFileSync(join(units, `${target}-supplemental-plan.json`), JSON.stringify({ schema: "register-plan/1", plan_version: 1,
        derived_from: { job_key: `supplemental:${target}`, variants_fingerprint: "supplemental" }, regions: [], rejected: [], entries: [
          { qid, axis: target, predicate: "exact", term: FOLLOW_UP_TERM, nice_classes: ["9"], regions: [], expected_kind: "enumerate", origin: "supplemental" },
        ] }, null, 2));
      writeFileSync(join(dirname(planPath), SEARCHES_FILE), Array.from({ length: FOLLOW_UP_SEARCH_LIMIT }, (_, i) => JSON.stringify({ qid: `earlier-${i}` })).join("\n") + "\n");
    }
    const r = await kernel("auth", { plan_path: planPath, axis, output_path: outputPath, ...(qids?.length ? { qids } : {}) }, c);
    const text = String(r?.text ?? "");
    return text.startsWith("ERROR") ? { ok: false, cause: text } : { ok: true, ...JSON.parse(text) };
  };
  return { run, qid: () => qid };
}

async function runMockPipeline(root, env, opts = {}) {
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY", "CLEAROTRON_CODEX_PATH"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, opts);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

for (const [engine, env] of [["claude", {}], ["codex", ON_CODEX]]) {
  test(`${engine}: with the follow-up net full, the run delivers and states the question it did not ask`, async () => {
    const root = mkdtempSync(join(tmpdir(), "clearotron-allowance-"));
    const asked = [];
    const ex = await executor(asked);
    const { res, events } = await runMockPipeline(root, env, { planExecutor: ex.run });
    const rd = res.runDir;
    const json = (f) => JSON.parse(readFileSync(f, "utf8"));
    const qid = ex.qid();
    assert.ok(qid, "guard: the code-side unit never ran, so the net was never filled");

    // the join sent the follow-up back to be run, and the executor refused it without asking the register
    assert.ok(events.some((e) => e.event === "plan-qids-missing" && e.action === "plan-direct-execute" && e.qids.includes(qid)),
      "guard: the follow-up never reached the plan join's repair");
    assert.ok(!asked.includes(FOLLOW_UP_TERM), "the register was asked a follow-up with the net full");
    const { readOutstanding, FOLLOW_UP_SEARCH_LIMIT } = await import("../../providers/_shared/follow-up-searches.mjs");
    assert.deepEqual(readOutstanding(driverDir(rd)).map((r) => [r.qid, r.reason]), [[qid, "follow-up-not-sent"]]);

    // the run delivered, and was never held on the question it did not ask
    assert.equal(res.ok, true, JSON.stringify({ fail: res.fail, stage: res.failedStage }));
    assert.ok(existsSync(join(rd, ".delivered")), "the run did not deliver");
    assert.deepEqual(events.filter((e) => e.event === "stage-failure" || e.event === "plan-unexecuted"), [], "the run failed on a question the net held back");

    // the receipt, the run record, the class line and the question all state it
    const receipt = json(driverDir(rd, "plan-execution.json"));
    assert.ok(!receipt.missing.includes(qid), "a question not asked was left as one gone missing");
    assert.deepEqual(receipt.outstanding?.map((x) => x.qid), [qid]);
    assert.equal(/follow_up|allowance|limit|paid|\bcap\b/i.test(JSON.stringify(receipt)), false, "the receipt a model may read names the net");
    assert.ok(events.some((e) => e.event === "register-follow-up-searches" && e.reached === true && e.not_sent === 1 && e.limit === FOLLOW_UP_SEARCH_LIMIT),
      "the run log does not state the net");
    const facts = json(driverDir(rd, "scope-facts.json"));
    assert.equal(facts.per_class["9"]?.outstanding, 1, `the class does not count the question not asked: ${JSON.stringify(facts.per_class["9"])}`);
    assert.match(facts.coverage_line, /Class 9: [^·]*could not be searched/, facts.coverage_line);
    const ask = json(driverDir(rd, "asks.json")).asks?.find((a) => a.ask_id === `ask:supplemental:${qid}`);
    assert.ok(ask, "the question not asked has no ask");
    // it reaches the closure step open, as every unanswered question does; what that step decides is its own
    assert.notEqual(ask.ending?.kind, "executed", `the question not asked was recorded as answered: ${JSON.stringify(ask.ending)}`);
    assert.notEqual(ask.ending?.by, "plan-execution-join", `the plan join ended a question it never asked: ${JSON.stringify(ask.ending)}`);
  });
}

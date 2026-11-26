// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline on a Knockout: a first pass that fails at the rating, then its resume
//
// A FAILED KNOCKOUT PASS KEEPS WHAT ITS STAGES READ, SO ITS RESUME DOES NOT RUN THEM AGAIN.
//
// Every pass exit reconciles the stage records against the artifacts as they finally stand (stage-freshness.mjs). The
// reconcile reads each stage's inputs from the clearance's table, which names no Knockout stage, so it used to write an
// empty record over every Knockout stage's own. The next pass then read "no record of the inputs it was produced from"
// and ran the intake again as a fresh session, and every stage after it. Here the first pass answers the intake and
// fails at the rating, as a pass cut off there does; its intake's record must still list what it read, and the resume
// must not run the intake again.
//
// Nothing dials a register or the web: the Knockout's executors are injected, and the engine is the mock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
const ROOT = mkdtempSync(join(tmpdir(), "failed-knockout-keeps-its-reads-"));
const PROFILES = join(ROOT, "profiles");
cpSync(join(HERE, "..", "profiles"), PROFILES, { recursive: true });
for (const [k, v] of Object.entries({
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: join(ROOT, "ws"),
  CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_REPORTS_URL: "https://trademark.test", CLEAROTRON_CUSTOMERS_DIR: PROFILES,
  CLEAROTRON_REGISTER_CALL_LOG: join(ROOT, "register-calls.jsonl"), CLEAROTRON_DATABASE: "signa",
  CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_DEFAULT_AGENT: "intake-agent",
  MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
})) pinEnv(process.env, k, v);
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_KNOCKOUT_MODEL", undefined);

const { answeredGrid } = await import("./knockout-grid-fixture.mjs");
const EXECUTORS = {
  recordLister: async () => ({ ok: true, total: null, records: [] }),
  countExecutor: async () => ({ ok: true, total: 0 }),
  gridExecutor: async (spec) => answeredGrid(spec, []),
  sweepExecutor: async () => ({ ok: true, text: "Nothing found." }),
};
const ORDER = { id: "ko-keeps-reads", msgId: "<ko-keeps-reads@x>", forwarder: "jordan", forwarderDomain: "example.com", product: "knockout-search",
  classes: [4], jurisdictions: ["EU"], markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }] };
/** Phrases only the framing turn and the rating turn carry (stages-knockout.mjs). */
const FRAMING = "You are framing a KNOCKOUT SEARCH order";
const RATING = "You are rating one name for a Knockout screen.";

const pipelineOf = async () => (await import(`../pipeline.mjs?bust=${Math.random()}`)).pipeline;
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const codenameOf = (runDir) => runDir.split(/[\\/]/).pop().split("-").slice(3).join("-");
function runKeeping(id) {
  const hit = readdirSync(join(ROOT, "ws"), { recursive: true }).map(String).filter((p) => p.endsWith("accepted-order.json"))
    .map((p) => join(ROOT, "ws", p)).find((p) => readJson(p).order?.id === id);
  assert.ok(hit, `no run kept order ${id}`);
  return dirname(dirname(hit));
}
async function pass(order, env, opts = {}) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) pinEnv(process.env, k, v);
  try { return await (await pipelineOf())(structuredClone(order), { ...EXECUTORS, ...opts }); }
  catch (e) { return { ok: false, threw: String(e?.message ?? e) }; }
  finally { for (const [k, v] of Object.entries(saved)) pinEnv(process.env, k, v); }
}

test("a Knockout pass that fails at the rating keeps its intake's record, and its resume does not run the intake again", async () => {
  const first = await pass(ORDER, { MOCK_FAIL_STAGE: RATING });
  assert.notEqual(first.ok, true, "premise: the first pass failed");
  const runDir = runKeeping(ORDER.id);
  const stamp = driverDir(runDir, "stage-inputs", "knockout-frame.json");
  assert.ok(existsSync(stamp), "premise: the intake answered and wrote its record");
  const rec = readJson(stamp);
  assert.ok(Array.isArray(rec.inputs) && rec.inputs.length > 0, `the failed pass emptied the intake's record: ${JSON.stringify(rec.inputs)}`);
  assert.equal(rec.reconciledAt, undefined, "the reconcile rewrote the intake's record");

  const calls = join(ROOT, "resume-calls.jsonl");
  const resumed = await pass(ORDER, { MOCK_FAIL_STAGE: undefined, MOCK_CLAUDE_CALL_LOG: calls }, { codename: codenameOf(runDir) });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const prompts = readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l).prompt ?? "");
  assert.ok(prompts.some((p) => p.includes(RATING)), "premise: the resume ran the rating it owed");
  assert.equal(prompts.filter((p) => p.includes(FRAMING)).length, 0, "the resume ran the intake again");
});

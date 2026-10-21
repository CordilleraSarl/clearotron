// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline through the screen gate twice: once with a goods drop on a record the run
// cannot fetch, once with none.
//
// THE SCREEN GATE RECORDS WHAT EACH GOODS DROP IT POLICES RESTS ON. The gate's rule and its outcome are unchanged:
// the drop it cannot ground is still fetched, re-decided, and disclosed when the fetch fails. Beside them the run
// now records, for every drop the gate polices, whether the record was held before the gate fetched anything, what
// the reading step opened or was shown, what the gate fetched, and the gate's own register calls counted as
// requests sent, answers from memory, credits and characters. The mocked drop is named by its fixture record id.
//
// Own file = own process + own workspace root (the repo convention for mock-pipeline scenarios). SAFETY GUARD: the
// workspace root and the call ledger are pinned BEFORE any driver module loads, so driver modules load dynamically.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || mkdtempSync(join(tmpdir(), "clearotron-testroot-")));
const LEDGER = join(mkdtempSync(join(tmpdir(), "clearotron-sge-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
writeFileSync(LEDGER, "");

import { test } from "node:test";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
// The same stages on the Codex engine, mocked: its turns read the same stage fixtures, the screen drop among them.
const ON_CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" };
process.env.CLEAROTRON_AI ||= "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job-sge", msgId: "<sge@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8302", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const DROP = "/mark/cn/88001-42";

async function runMockPipeline(env, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-sge-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_SCREEN_DROP", "MOCK_FRAME_DIFF",
    "CLEAROTRON_SCREEN_GATE_UNNAMED"]) delete process.env[k];
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

test("a drop the gate must fetch, and cannot: recorded as not held before the gate, fetched by it, and still unheld; the gate's outcome is unchanged", async () => {
  const recordFetcher = async () => ({ ok: false, cause: "record 404 (mock — unretrievable)" });
  const { res, events } = await runMockPipeline({ MOCK_SCREEN_DROP: "persist" }, { recordFetcher });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  assert.equal(res.verdict, "CONDITIONAL", "guard: the gate still discloses the drop it cannot ground and the verdict is still clamped");
  const p = driverDir(res.runDir, "screen-gate-evidence.json");
  assert.ok(existsSync(p), "no record of what the gate's drops rest on");
  const ev = JSON.parse(readFileSync(p, "utf8"));
  const drop = ev.drops.find((d) => d.uri === DROP);
  assert.ok(drop, "the policed drop is on the record");
  assert.deepEqual([drop.held_before_gate, drop.gate_fetch, drop.held_after_gate], [false, "failed", false]);
  assert.match(drop.cause, /404/);
  assert.deepEqual([drop.goods_before_gate, drop.goods_after_gate], ["not-held", "unavailable"],
    "the goods the drop rested on when the gate judged it, and what the gate's failed fetch left, are kept apart");
  assert.equal(ev.schema_version, 2);
  assert.match(ev.reading_note, /best-effort/);
  assert.ok(ev.fetches.added >= 1, "the gate's fetch is counted as added");
  assert.equal(ev.fetches.avoided, ev.counts.held_before_gate);
  const e = events.find((x) => x.event === "screen-gate-evidence");
  assert.ok(e, "no screen-gate-evidence event");
  assert.deepEqual(Object.keys(e.gate_calls).sort(), ["answered_from_memory", "credits", "failed", "requests_sent", "response_characters"],
    "the gate's register calls are counted four ways");
});

test("no policed drop: the record is still written, and says the gate fetched nothing", async () => {
  const { res, events } = await runMockPipeline({}, {});
  assert.equal(res.ok, true, JSON.stringify(res));
  const ev = JSON.parse(readFileSync(driverDir(res.runDir, "screen-gate-evidence.json"), "utf8"));
  assert.equal(ev.fetches.added, 0);
  assert.equal(ev.counts.gate_fetched, 0);
  assert.ok(events.some((x) => x.event === "screen-gate-evidence"));
});

test("on the Codex engine too: the same drop, the same record", async () => {
  const recordFetcher = async () => ({ ok: false, cause: "record 404 (mock — unretrievable)" });
  const { res } = await runMockPipeline({ MOCK_SCREEN_DROP: "persist", ...ON_CODEX }, { recordFetcher });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  const ev = JSON.parse(readFileSync(driverDir(res.runDir, "screen-gate-evidence.json"), "utf8"));
  const drop = ev.drops.find((d) => d.uri === DROP);
  assert.deepEqual([drop?.held_before_gate, drop?.gate_fetch, drop?.held_after_gate], [false, "failed", false]);
  assert.ok(existsSync(driverDir(res.runDir, "goods-evidence.json")), "the band shape's derivation recorded what the goods rest on on this engine too");
});

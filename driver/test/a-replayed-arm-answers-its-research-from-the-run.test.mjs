// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REPLAYED ARM ANSWERS ITS RESEARCH FROM THE RUN, AND ASKS NOTHING NEW.
//
// A stage replayed offline in the experiment sandbox sent its research questions out again: a cost, and answers that
// were not the ones the run got, so an offline check of the writer could not hold its research still. With
// `--research replay` the sandbox carries the run's saved research answers, and the research server answers a question
// the run already asked from the answer the run got, refuses one it did not ask, and sends nothing out. Without the
// flag nothing changes. Every owner and mark below is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "engine", "mcp", "perplexity-server.mjs");
const ask = (owner) => `Does ${owner} use the mark QZORVEL for toys in France, and has it opposed a similar mark?`;
const saved = (dir, rows) => {
  mkdirSync(driverDir(dir), { recursive: true });
  for (const r of rows) appendFileSync(driverDir(dir, "research-answers.jsonl"), JSON.stringify(r) + "\n");
};

/** One call to the real research server over stdio, with NO research key: a live question can only fail. */
async function callResearch(runDir, args) {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "perplexity_research", arguments: args } },
  ];
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PERPLEXITY_API_KEY: "", CLEAROTRON_BAND_RUN_DIR: runDir, CLEAROTRON_GATHER_SESSION_KEY: "clearance-exp-arm" } });
    let buf = "", text = null;
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(text ?? ""); };
    const timer = setTimeout(done, 15000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id === 2) text = m.result?.content?.[0]?.text ?? ""; } catch { /* not a reply */ }
      }
      if (text !== null) { clearTimeout(timer); done(); }
    });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}
const replayRun = (t, { marker = true } = {}) => {
  const d = mkdtempSync(join(tmpdir(), "research-replay-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  saved(d, [
    { ts: "2026-01-01T10:00:00.000Z", session: "clearance-acme-run-amber-fox-synthesis", task: ask("Example Holdings"), text: "an earlier answer" },
    { ts: "2026-01-01T10:05:00.000Z", session: "clearance-acme-run-amber-fox-synthesis-rerun1", task: ask("Example Holdings"), text: "Yes, in use: https://example.com/qzorvel" },
    { ts: "2026-01-01T10:06:00.000Z", session: "clearance-acme-run-amber-fox-synthesis", task: ask("Broken Answer Co"), text: "ERROR: Research failed — 429" },
  ]);
  if (marker) writeFileSync(driverDir(d, "research-replay.json"), JSON.stringify({ replayOf: "the run's saved research answers", answers: 1 }) + "\n");
  return d;
};
const readingLog = (d) => readFileSync(driverDir(d, "reading-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("a replayed question gets the run's latest answer to it, with no research key and nothing sent out", async (t) => {
  const d = replayRun(t);
  assert.equal(await callResearch(d, { task: `  ${ask("Example Holdings")} ` }), "Yes, in use: https://example.com/qzorvel");
  const [row] = readingLog(d);
  assert.equal(row.args.replay, true, "the reading log does not mark the answer as replayed");
  assert.equal(row.ok, true);
});

test("a question the run did not ask, one it asked and got no answer to, and a grid are refused under replay", async (t) => {
  const d = replayRun(t);
  for (const args of [{ task: ask("Sample Trading") }, { task: ask("Broken Answer Co") }, { task: "grid", grid_spec_path: join(d, "spec.json") }]) {
    const reply = await callResearch(d, args);
    assert.match(reply, /^ERROR: replay — .*nothing was sent to the research service\.$/, `not refused as a replay: ${reply}`);
  }
  assert.deepEqual(readingLog(d).map((r) => [r.args.replay, r.ok]), [[true, false], [true, false], [true, false]]);
});

test("THE CONTROL: without the replay marker the same question goes the live way, which needs the key", async (t) => {
  const d = replayRun(t, { marker: false });
  assert.match(await callResearch(d, { task: ask("Example Holdings") }), /PERPLEXITY_API_KEY not set/);
});

test("the sandbox of every stage that holds the research tool carries the run's saved answers", async () => {
  const SC = await import("../stage-context.mjs");
  const ST = await import("../stages.mjs");
  const P = ST.paths("/run");
  const paths = SC.sandboxManifest("synthesis", P).map((e) => e.path);
  assert.ok(paths.includes(driverDir("/run", "research-answers.jsonl")), "the synthesis sandbox does not carry the run's research answers");
});

// ── THE ARM ITSELF, on a real mock run parked at synthesis ─────────────────────────────────────────────
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

test("--research replay writes the marker into the arm's sandbox and says so on its record; a run with no answers is refused by name", async (t) => {
  const ROOT = mkdtempSync(join(tmpdir(), "clearotron-research-replay-"));
  t.after(() => rmSync(ROOT, { recursive: true, force: true }));
  const vars = { CORSEARCH_SESSION_KEY: "test-offline", CLEAROTRON_BAND_TRUTH_GATE: "0", CLEAROTRON_AI: "anthropic-agent",
    CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: ROOT, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_MAX_RETRIES: "0",
    CLEAROTRON_RECOVERY_MAX: "1", CLEAROTRON_SATPROBE_CODESIDE: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_FAIL_STAGE: "joint synthesis narrative" };
  const saved0 = {};
  for (const [k, v] of Object.entries(vars)) { saved0[k] = process.env[k]; pinEnv(process.env, k, v); }
  t.after(() => { for (const [k, v] of Object.entries(saved0)) { if (v === undefined) delete process.env[k]; else pinEnv(process.env, k, v); } });

  const PL = await import("../pipeline.mjs");
  const job = { id: "job-TMPREPLAY1", msgId: "<TMPREPLAY1@x>", forwarder: "jordan", forwarderDomain: "example.com",
    ref: "TMPREPLAY1", markName: "MARK TMPREPLAY1", classes: [9, 41], provider: "corsearch" };
  const res = await PL.pipeline(job);
  assert.equal(res.postponed, true, "guard: the mock run parks at synthesis so its run dir stays live");
  delete process.env.MOCK_FAIL_STAGE;
  const codename = basename(res.runDir).replace(/^\d{4}-\d\d-\d\d-/, "");

  await assert.rejects(() => PL.runExperiment(job, { codename, experiment: "synthesis", research: "replay", label: "none kept" }),
    /--research replay: this run kept no research answers/, "a replay with nothing to replay was dispatched");
  await assert.rejects(() => PL.runExperiment(job, { codename, experiment: "synthesis", research: "replayed" }), /--research: unknown value "replayed"/);

  saved(res.runDir, [{ ts: "2026-01-01T10:00:00.000Z", session: "s", task: ask("Example Holdings"), text: "Yes, in use: https://example.com/qzorvel" }]);
  const ex = await PL.runExperiment(job, { codename, experiment: "synthesis", research: "replay", label: "replay" });
  assert.ok(existsSync(driverDir(ex.shadowDir, "research-replay.json")), "the arm's sandbox carries no replay marker");
  assert.ok(existsSync(driverDir(ex.shadowDir, "research-answers.jsonl")), "the arm's sandbox does not carry the run's answers");
  assert.equal(existsSync(driverDir(res.runDir, "research-replay.json")), false, "the canonical run was marked as a replay");
  const receipt = JSON.parse(readFileSync(driverDir(ex.shadowDir, "experiment-context.json"), "utf8"));
  assert.deepEqual(receipt.research, { mode: "replay", answers: 1 });

  const live = await PL.runExperiment(job, { codename, experiment: "synthesis", label: "live" });
  assert.equal(existsSync(driverDir(live.shadowDir, "research-replay.json")), false, "an arm run without the flag replays");
  assert.deepEqual(JSON.parse(readFileSync(driverDir(live.shadowDir, "experiment-context.json"), "utf8")).research, { mode: "live" });
});

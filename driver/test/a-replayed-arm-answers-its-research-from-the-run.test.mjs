// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REPLAYED ARM ANSWERS ITS RESEARCH FROM THE RUN, AND ASKS NOTHING NEW.
//
// A stage replayed offline in the experiment sandbox sent its research questions out again: a cost, and answers that
// were not the ones the run got, so an offline check of the writer could not hold its research still. With
// `--research replay` the research server answers a question the run already asked from the answer the run got, refuses
// one it did not ask, and sends nothing out. Without the flag nothing changes.
//
// THE ANSWERS ARE KEPT BESIDE THE ARM, NEVER IN IT. They were copied into the arm's `_driver/`, which a stage's own
// commands may read, and on a test replay, 2026-10-28, a Codex writer read them there and asked the saved run's later
// questions word for word. Now the arm's folder holds none of them, the server reads the copy its marker names, and an
// arm under Codex's sandbox bypass, where nothing fences a command, is refused. Every owner and mark below is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "engine", "mcp", "perplexity-server.mjs");
const ask = (owner) => `Does ${owner} use the mark QZORVEL for toys in France, and has it opposed a similar mark?`;
const savedTo = (file, rows) => {
  mkdirSync(dirname(file), { recursive: true });
  for (const r of rows) appendFileSync(file, JSON.stringify(r) + "\n");
};
const saved = (dir, rows) => savedTo(driverDir(dir, "research-answers.jsonl"), rows);
const ANSWER = "Yes, in use: https://example.com/qzorvel";

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
// An arm folder `d`, and the run's answers kept OUTSIDE it, at the file its marker names (`names: false` names none).
const replayRun = (t, { marker = true, names = true } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "research-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const d = join(root, "arm"), from = join(root, "_replay", "arm", "research-answers.jsonl");
  mkdirSync(driverDir(d), { recursive: true });
  savedTo(from, [
    { ts: "2026-01-01T10:00:00.000Z", session: "clearance-acme-run-amber-fox-synthesis", task: ask("Example Holdings"), text: "an earlier answer" },
    { ts: "2026-01-01T10:05:00.000Z", session: "clearance-acme-run-amber-fox-synthesis-rerun1", task: ask("Example Holdings"), text: ANSWER },
    { ts: "2026-01-01T10:06:00.000Z", session: "clearance-acme-run-amber-fox-synthesis", task: ask("Broken Answer Co"), text: "ERROR: Research failed — 429" },
  ]);
  if (marker) writeFileSync(driverDir(d, "research-replay.json"),
    JSON.stringify({ replayOf: "the run's saved research answers", answers: 1, ...(names ? { answersFrom: from } : {}) }) + "\n");
  return d;
};
const readingLog = (d) => readFileSync(driverDir(d, "reading-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("a replayed question gets the run's latest answer to it, with no research key and nothing sent out", async (t) => {
  const d = replayRun(t);
  assert.equal(await callResearch(d, { task: `  ${ask("Example Holdings")} ` }), ANSWER);
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

test("the replay never answers from the arm's own folder: a marker that names no answers file answers nothing", async (t) => {
  const d = replayRun(t, { names: false });
  saved(d, [{ ts: "2026-01-01T10:05:00.000Z", session: "clearance-acme-run-amber-fox-synthesis", task: ask("Example Holdings"), text: ANSWER }]);
  assert.match(await callResearch(d, { task: ask("Example Holdings") }), /^ERROR: replay — .*nothing was sent to the research service\.$/,
    "the replay answered from the arm's own folder, which the stage's commands can read");
  assert.equal(readingLog(d)[0].error, "replay: the marker names no answers file");
});

test("THE CONTROL: without the replay marker the same question goes the live way, which needs the key", async (t) => {
  const d = replayRun(t, { marker: false });
  assert.match(await callResearch(d, { task: ask("Example Holdings") }), /PERPLEXITY_API_KEY not set/);
});

test("a first attempt's sandbox carries none of the run's answers; one reproducing a later attempt carries them for its hand-off", async () => {
  const SC = await import("../stage-context.mjs");
  const ST = await import("../stages.mjs");
  const P = ST.paths("/run");
  const answers = driverDir("/run", "research-answers.jsonl");
  for (const stage of ["synthesis", "common-law", "narrative-refutation"])
    assert.ok(!SC.sandboxManifest(stage, P).map((e) => e.path).includes(answers), `a first attempt's ${stage} sandbox carries the run's research answers`);
  assert.ok(SC.sandboxManifest("synthesis", P, { researchHandOff: true }).map((e) => e.path).includes(answers),
    "a synthesis arm reproducing a later attempt does not carry the answers that attempt is handed");
});

// Every file under `dir`, read as text.
const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile())
  .map((e) => ({ path: join(e.parentPath ?? e.path, e.name), text: readFileSync(join(e.parentPath ?? e.path, e.name), "utf8") }));

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

  // Saved under the writer's OWN session key, as a run's writer saves them: what a retry is handed, and a first attempt is not.
  const start = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .find((e) => e?.event === "start");
  const writerKey = PL.stageSessionKey({ run: { slug: start.job.slug, codename: start.job.codename } }, "synthesis");
  saved(res.runDir, [{ ts: "2026-01-01T10:00:00.000Z", session: writerKey, task: ask("Example Holdings"), text: ANSWER }]);
  // UNDER CODEX'S SANDBOX BYPASS nothing keeps a command out of the answers, so the replay is refused before any arm is built.
  const engine0 = process.env.CLEAROTRON_AI;
  pinEnv(process.env, "CLEAROTRON_AI", "openai-agent"); process.env.CLEAROTRON_CODEX_SANDBOX_BYPASS = "1";
  try {
    await assert.rejects(() => PL.runExperiment(job, { codename, experiment: "synthesis", research: "replay", label: "bypassed" }),
      /--research replay: Codex's sandbox is bypassed/, "a replay was built where nothing fences the writer's commands");
  } finally { pinEnv(process.env, "CLEAROTRON_AI", engine0); delete process.env.CLEAROTRON_CODEX_SANDBOX_BYPASS; }

  const ex = await PL.runExperiment(job, { codename, experiment: "synthesis", research: "replay", label: "replay" });
  assert.ok(existsSync(driverDir(ex.shadowDir, "research-replay.json")), "the arm's sandbox carries no replay marker");
  // THE ANSWERS ARE BESIDE THE ARM, NOT IN IT: nothing under the arm's folder holds one, and the marker names the copy.
  const from = JSON.parse(readFileSync(driverDir(ex.shadowDir, "research-replay.json"), "utf8")).answersFrom;
  assert.equal(from, join(dirname(ex.shadowDir), "_replay", basename(ex.shadowDir), "research-answers.jsonl"));
  assert.ok(readFileSync(from, "utf8").includes(ANSWER), "the copy the replay answers from does not hold the run's answer");
  const holding = filesUnder(ex.shadowDir).filter((f) => f.text.includes(ANSWER)).map((f) => f.path.slice(ex.shadowDir.length + 1));
  assert.deepEqual(holding, [], "a file in the arm's own folder holds a saved answer the stage's commands could read");
  assert.equal(existsSync(driverDir(res.runDir, "research-replay.json")), false, "the canonical run was marked as a replay");
  const receipt = JSON.parse(readFileSync(driverDir(ex.shadowDir, "experiment-context.json"), "utf8"));
  assert.deepEqual(receipt.research, { mode: "replay", answers: 1 });
  // A FRESH ARM IS A FIRST ATTEMPT: the copied answers feed the replay, and its message hands on none of them.
  assert.equal(receipt.researchHandOff, false);
  assert.equal(existsSync(join(ex.shadowDir, "research-answers.md")), false, "a fresh arm was handed the run's research as a retry is");

  const live = await PL.runExperiment(job, { codename, experiment: "synthesis", label: "live" });
  assert.equal(existsSync(driverDir(live.shadowDir, "research-replay.json")), false, "an arm run without the flag replays");
  assert.deepEqual(JSON.parse(readFileSync(driverDir(live.shadowDir, "experiment-context.json"), "utf8")).research, { mode: "live" });
});

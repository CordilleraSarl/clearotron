// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the engine-turn probe AT THE RUN DOOR. built the probe and wired it to `npm run setup`;
// this is the wiring to the door, and the two properties that wiring has to have.
//
//   1. A CONFIGURATION fault refuses BEFORE A RUN DIRECTORY EXISTS. That is the whole point of the door:
//      an engine that worked at setup and has since signed out is caught at second three, not at stage
//      one ninety minutes later, wearing the shape of a model fault and leaving a resumable-looking husk.
//      Asserted from the FILESYSTEM — no run dir, not merely a different message.
//
//   2. WEATHER FAILS OPEN, and leaves a record. An upstream overload or a spent quota is not a fault this
//      box can fix, and the run handles it better than the door can: the rate-limit park carries the
//      provider's own resetsAt and resumes itself. A door that refused there would replace a park that
//      recovers with a terminal failure and a human — measured, not argued: the naive refusal turned
//      `park lanes: an UPSTREAM OVERLOAD park charges weather` red.
//
// Both stubs are LOCAL SHELL SCRIPTS, not the mock engine: the door's input is what the binary does at
// startup, and a two-line stub is the honest fixture for "the CLI printed this and exited". Nothing here
// resolves a real `claude` — CLEAROTRON_CLAUDE_PATH is an absolute path to a file this test wrote.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE_MOCK = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE_MOCK, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const JOB = {
  id: "test-job-door", msgId: "<test-door@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8439", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

/** A run's workspace root plus the env every lane here shares. Returns { root, run } — `run` imports fresh. */
function harness(env = {}) {
  const root = mkdtempSync(join(tmpdir(), "prelim-door-"));
  for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_CLAUDE_OVERLOADED"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent",
    CLEAROTRON_CLAUDE_PATH: CLAUDE_MOCK,
    CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  return {
    root,
    run: async () => {
      const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
      return pipeline({ ...JOB });
    },
  };
}

/** A binary that runs, says <stderr> and exits 1 — every filesystem preflight passes it. */
function stubEngine(root, name, stderr) {
  const p = join(root, name);
  writeFileSync(p, `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' ${JSON.stringify(stderr)} >&2\nexit 1\n`, { mode: 0o755 });
  chmodSync(p, 0o755);
  return p;
}

const runEvents = (runDir) => readFileSync(driverDir(runDir, "run.jsonl"), "utf8")
  .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("#819 a SIGNED-OUT engine is refused at the door — before a run directory exists", async () => {
  const bootstrap = mkdtempSync(join(tmpdir(), "prelim-door-bin-"));
  const { root, run } = harness({
    // The Claude CLI's own signed-out line on a `-p` run. It exits 1 having spent nothing, and every
    // filesystem check preflightEngineBinary makes passes — which is the entire reason the probe exists.
    CLEAROTRON_CLAUDE_PATH: stubEngine(bootstrap, "claude-signed-out", "Invalid API key · Please run /login"),
  });
  await assert.rejects(run, (e) => {
    assert.match(e.message, /^\[preflight\] /, "the same prefix as its refusing siblings at the same door");
    assert.match(e.message, /is not signed in/, "it names the MODE, never a shrugging 'cannot run'");
    assert.match(e.message, /run `claude` once/, "…and the next thing the reader does");
    return true;
  });
  // The property, asserted from disk rather than from the message: nothing was built in order to fail.
  //
  // The WHOLE ROOT is listed rather than one guessed path checked absent. A run dir does not live at
  // <root>/studio/prelim-search — it lives two levels down, under the executing agent's own workspace —
  // so `existsSync(<root>/studio/prelim-search) === false` is a sentence that passes whatever the door
  // does, and would have shipped this file's headline assertion as decoration. The only entry is the run
  // slot, which `pipeline()` takes before `pipelineInner` is called at all and releases in its finally;
  // a run that got past the door would add `workspace-clawdi` beside it, as the test below shows.
  assert.deepEqual(readdirSync(root), ["prelim-run-locks"],
    "no agent workspace, no run directory, no frozen profile, no status sidecar — the refusal costs one cheap turn and nothing else");
});

test("#819 an UPSTREAM OVERLOAD does NOT refuse — the door fails open and says so on the run record", async () => {
  // MOCK_CLAUDE_OVERLOADED is the real Anthropic 529 shape, and it answers the probe turn as well as the
  // stage turns: a door that refused here would turn every provider wobble into a terminal refusal at the
  // production run door, and would strand the park lane that exists to absorb exactly this.
  const { root, run } = harness({ MOCK_CLAUDE_OVERLOADED: "1" });
  const res = await run();
  assert.equal(res.ok, false, "the run still fails — failing open is not pretending the engine worked");
  assert.ok(res.runDir && existsSync(res.runDir), "…but it got PAST the door and built its run dir");
  // THE CONTROL for the refusal test above: this run does not deliver, so its runDir is the LIVE path and
  // not the archive. It says where a run that gets past the door puts itself — which is what makes "the
  // workspace root is empty" up there an assertion about the door rather than about a path that never
  // existed. Keep these two together; separating them is how the absence stops being a finding.
  assert.ok(res.runDir.startsWith(join(root, "workspace-clawdi", "studio", "prelim-search")),
    `a run that passes the door populates the workspace root: ${res.runDir}`);

  const probeRow = runEvents(res.runDir).find((e) => e.event === "engine-turn-probe");
  assert.ok(probeRow, "the door's verdict is on the run record — a fail-open that leaves no trace is not a check");
  assert.equal(probeRow.ok, false, "and it records that the probe FAILED, not that it passed");
  assert.equal(probeRow.lane, "weather", "on the lane the recovery ladder already uses for an upstream fault");
  assert.equal(probeRow.engine, "anthropic-agent");
});

test("#819 a clean engine leaves a passing verdict on the record, so 'the door ran' is checkable", async () => {
  const { run } = harness();
  const res = await run();
  assert.equal(res.ok, true, JSON.stringify(res));
  const probeRow = runEvents(res.runDir).find((e) => e.event === "engine-turn-probe");
  assert.ok(probeRow, "every run that pays for the door gets the row — absence would mean the door was skipped");
  assert.equal(probeRow.ok, true);
  assert.equal(probeRow.basis, "completed-turn", "the pass is a COMPLETED TURN, never an inference from silence");
});

test("#819 the lanes that do not pay for the door do not get the row either", async () => {
  // The gate is `!recordFetcher && !koSelector` ('s ruling, mirroring preflightCredentials). An
  // injected fetcher is the test/alternate-fetcher lane; it skips the turn, and the ABSENCE of the row is
  // how a reader tells "skipped" from "passed" — which is why the row carries the verdict and not a bare
  // boolean. (That both exempt lanes still SPAWN the engine is recorded, not decided here.)
  harness();   // for the env; this lane drives pipeline() directly so it can inject the fetcher
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { recordFetcher: async () => ({ ok: false, cause: "mock no-op" }) });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(runEvents(res.runDir).some((e) => e.event === "engine-turn-probe"), false,
    "an injected recordFetcher pays for no engine turn, and the record says nothing rather than claiming a pass");
});

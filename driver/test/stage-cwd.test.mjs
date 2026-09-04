// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE SPAWN CWD IS A GRANTED WRITE ROOT, AND IT WAS A SHARED TMPDIR.
//
// A Depth 5 clearance run left four deliverable-shaped documents in the driver's working directory:
// a 39-platform x 12-variant results grid as a .csv, a supplementary search matrix, a methodology note
// and an executive summary. Not scratch — the grid is the largest single body of evidence that sweep
// produced and the material behind a negative finding. Because they were outside the run directory they
// were in no audit trail, in no report, in no archive, and no teardown could remove them.
//
// The mechanism is one line per engine. Every engine here confines the model's file tools to cwd plus the
// `--add-dir` roots, so cwd is a place the model MAY WRITE — and it resolved to `tmpdir()`, one directory
// shared by every stage of every run on the box, which nothing in the tree ever reads back.
//
// WHY THE TEST IS ABOUT WHERE A BYTE LANDS. An assertion that `cwd === runDir` reaching the engine passes
// under a stubbed engine that ignores it, and an assertion on the argv never sees cwd at all. The only
// property that distinguishes a granted write root from a neutral one is what happens when the model
// invents a relative filename — which is precisely what happened on the real run. So the mock is told to
// do that, and the test asks where the file went.
//
// PRODUCTION IS THE POINT. On prod that shape is client matter: a named mark and a full channel matrix
// accumulating unswept in a service account's home, outside the matter archive and outside every
// retention control that applies to a run directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolveSpawnCwd } from "../engine/common.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "stagecwd-locks-"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const { runStage } = await import("../gateway.mjs");

test("#524 resolveSpawnCwd prefers an explicit cwd, then the run dir, and only then a neutral tmpdir", () => {
  assert.equal(resolveSpawnCwd({ cwd: "/explicit", runDir: "/run" }), "/explicit");
  assert.equal(resolveSpawnCwd({ runDir: "/run" }), "/run",
    "a dispatch that has a run writes INTO that run — this is the whole fix");
  // The neutral fallback survives ONLY for a dispatch with no run at all: a probe, a test. There is no
  // run directory to confine it to, and cwd is still a CLAUDE.md-discovery surface the driver's own
  // checkout would pollute.
  assert.equal(resolveSpawnCwd({}), tmpdir());
  assert.equal(resolveSpawnCwd(), tmpdir());
});

test("#524 CLEAROTRON_ENGINE_CWD is deleted — an env var cannot relocate a model's write root", () => {
  // Not defaulted, not deprecated: a flag that can re-open the exact hole being closed is not a fix, and
  // the house rule is that the old mechanism goes in the same change that replaces it.
  const saved = process.env.CLEAROTRON_ENGINE_CWD;
  process.env.CLEAROTRON_ENGINE_CWD = "/tmp/somewhere-else-entirely";
  try {
    assert.equal(resolveSpawnCwd({ runDir: "/run" }), "/run", "the env var no longer participates");
    assert.equal(resolveSpawnCwd({}), tmpdir());
  } finally {
    if (saved === undefined) delete process.env.CLEAROTRON_ENGINE_CWD; else process.env.CLEAROTRON_ENGINE_CWD = saved;
  }
});

test("#524 a model that invents a relative filename writes INSIDE the run, not into a shared tmpdir", async () => {
  // The end-to-end property, and the arm that goes red if any engine stops resolving cwd to the run dir.
  const runDir = mkdtempSync(join(tmpdir(), "stagecwd-run-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  const strayName = "MARK_Search_Results.csv";          // the real one's shape: a channel grid, not scratch
  const before = new Set(readdirSync(tmpdir()));
  process.env.MOCK_CLAUDE_STRAY_RELATIVE = strayName;
  process.env.MOCK_CLAUDE_CALL_LOG = join(runDir, "calls.jsonl");
  try {
    await runStage("cwd-stage", {
      agent: "clawdi", message: "BASE TASK", sessionKey: "prelim-cwd-base",
      timeoutSec: 30, runDir, maxRetries: 0,
      validate: () => ({ ok: true }),
    });
    assert.ok(existsSync(join(runDir, strayName)),
      "the invented file must land in the run dir — where the archive keeps it, teardown removes it, and the stray detector can see it");
    assert.ok(!before.has(strayName) && !existsSync(join(tmpdir(), strayName)),
      "and it must NOT land in the shared tmpdir, which is outside every run, archive and retention control");
  } finally {
    delete process.env.MOCK_CLAUDE_STRAY_RELATIVE;
    rmSync(runDir, { recursive: true, force: true });
    rmSync(join(tmpdir(), strayName), { force: true });
  }
});

test("#524 a dispatch with NO run still spawns neutrally rather than in the driver's own checkout", async () => {
  // The fallback has to keep working, and it has to keep being neutral: inheriting the driver's cwd would
  // load the dev-assistant CLAUDE.md into every stage. This asserts the write goes SOMEWHERE outside the
  // repo — the property the original tmpdir choice existed for, which this change must not lose.
  const strayName = "no-run-dispatch-probe.md";
  process.env.MOCK_CLAUDE_STRAY_RELATIVE = strayName;
  try {
    await runStage("cwd-stage-norun", {
      agent: "clawdi", message: "BASE TASK", sessionKey: "prelim-cwd-norun",
      timeoutSec: 30, maxRetries: 0, validate: () => ({ ok: true }),
    });
    assert.ok(!existsSync(join(HERE, "..", strayName)), "never the driver's own tree");
    assert.ok(existsSync(join(tmpdir(), strayName)), "the neutral fallback still applies when there is no run");
  } finally {
    delete process.env.MOCK_CLAUDE_STRAY_RELATIVE;
    rmSync(join(tmpdir(), strayName), { force: true });
  }
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — TWO FIXES IN gateway.mjs THAT NOTHING PINNED AT THE CALL SITE.
//
// Measured before this file was written: delete BOTH fixes from `gateway.mjs` and the full driver suite
// reports **7390 tests, 0 failures**. Each fix has tests, and each of those tests exercises the helper
// rather than the call that uses it — so the helper stays correct while the caller stops calling it.
// That is the same shape as one subsystem over, and it is now the fourth instance this round.
//
//   1. `stderrTail: streamDigest(...)` — replacing the digest with raw stderr leaves the five arms of
//      `exit-cause-survives-the-digest.test.mjs` green at all three call sites.
//   2. `codexHome: stageCodexHome` — deleting it from both dispatch sites leaves all 37 arms of
//      `engine.openai.test.mjs` green, and silently restores the  failure: codex resolves
//      `resume <thread-id>` against `$CODEX_HOME/sessions`, so a home created and deleted per TURN means
//      every warm resume points at a directory that never heard of the thread. Measured on codex-cli
//      0.147.0: it does not start fresh, it errors — `no rollout found for thread id … (code -32600)`,
//      exit 1, under a second, zero tokens. That IS the sub-second exit-1 warm-patch death  asks
//      about; the cause was found and fixed in  and nothing stops it coming back.
//
// Both arms therefore assert the CALL, never the helper. A helper-level assertion here would reproduce
// the blind spot it exists to close.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
const ROOT = mkdtempSync(join(tmpdir(), "prelim-callsite-pin-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_AGENT = "clawdi";
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";

const GW = await import("../gateway.mjs");

const withEnv = async (vars, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v == null) delete process.env[k]; else pinEnv(process.env, k, String(v)); }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(prev)) { pinEnv(process.env, k, v); }
  }
};

const freshRun = (tag) => {
  const d = mkdtempSync(join(ROOT, `${tag}-`));
  mkdirSync(driverDir(d), { recursive: true });
  return d;
};

const rows = (runDir, stage) =>
  readFileSync(driverDir(runDir, `${stage}.jsonl`), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

// ── 1. THE DIGEST IS APPLIED WHERE THE RECORD IS WRITTEN ────────────────────────────────────────────

// Twelve distinct lines: more than 2×STREAM_DIGEST_KEEP, so a digest MUST elide and say so. Raw stderr
// cannot contain either signature — it has newlines, not the joiner, and no elision sentence.
const LOUD_STDERR = Array.from({ length: 12 }, (_, i) => `stderr line ${i + 1}`).join("\n");

test("the stderr digest is applied AT THE RECORD, not merely available as a helper", async () => {
  GW.registerEngine({ name: "loud-failing-engine",
    async runTurn() {
      return { code: 1, killed: false, wall: 0.2, stdout: "", stderr: LOUD_STDERR, laneWaitMs: 0,
        json: null, usage: null, sessionRef: null };
    } });
  const runDir = freshRun("loud");
  await withEnv({ CLEAROTRON_AI: "loud-failing-engine", CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0" }, () =>
    GW.runStage("loud-stage", { agent: "clawdi", message: "go", model: "haiku",
      sessionKey: "prelim-loud", timeoutSec: 30, runDir }));

  const tail = rows(runDir, "loud-stage").map((r) => r.stderrTail).filter(Boolean).pop();
  assert.ok(tail, "the failing turn recorded no stderrTail at all — nothing to digest and nothing to read");
  assert.match(String(tail), /line\(s\) elided/,
    "12 lines reached the record undigested: `streamDigest` is no longer applied at this call site, so a "
    + "startup cause is once again buried under whatever the process said last");
  assert.doesNotMatch(String(tail), /\n/,
    "a digest joins with the marker, never with newlines — a tail carrying newlines is raw stderr");
});

// ── 2. THE LADDER'S CODEX HOME IS PASSED, AND IS THE SAME ONE ACROSS ATTEMPTS ───────────────────────

// THE STUB IS REGISTERED UNDER THE REAL ENGINE'S NAME, and that is load-bearing rather than lazy.
// `runStage` creates the stage home only when `selectEngine().name === "openai-agent"` — anthropic
// resolves `--resume` against an ambient store nothing wipes and needs none of this. So a stub under any
// other name is handed `null` correctly, and an arm built on one would assert a property the code never
// claims. `registerEngine` keys by name and node:test gives each file its own process, so the
// substitution cannot reach another test.
const CODEX = "openai-agent";

test("#713 — every dispatch in one ladder receives the SAME codexHome, and it is not empty", async () => {
  // The property is not "a home was passed" but "one home per LADDER". A per-turn home is exactly what
  // removed, and a fresh directory on each attempt would satisfy a mere presence check while
  // failing every warm resume — the defect wearing the fix's clothes.
  const seen = [];
  GW.registerEngine({ name: CODEX,
    async runTurn(opts) {
      seen.push(opts?.codexHome ?? null);
      return { code: 1, killed: false, wall: 0.2, stdout: "", stderr: "boom", laneWaitMs: 0,
        json: null, usage: null, sessionRef: "thread-abc" };
    } });
  const runDir = freshRun("home");
  await withEnv({ CLEAROTRON_AI: CODEX, CLEAROTRON_MAX_RETRIES: "2", CLEAROTRON_RECOVERY_MAX: "0" }, () =>
    GW.runStage("home-stage", { agent: "clawdi", message: "go", model: "haiku",
      sessionKey: "prelim-home", timeoutSec: 30, runDir }));

  assert.ok(seen.length >= 2, `the ladder must dispatch more than once for this to mean anything — got ${seen.length}`);
  for (const [i, h] of seen.entries())
    assert.ok(h && typeof h === "string",
      `dispatch ${i + 1} received no codexHome. On the codex arm the engine then builds its own per-turn `
      + `home and deletes it, so the next warm resume finds no rollout and dies exit 1 under a second (#713)`);
  assert.equal(new Set(seen).size, 1,
    `the ladder handed out ${new Set(seen).size} different homes across ${seen.length} dispatches — one home `
    + `per LADDER is the invariant; a per-turn home passes a presence check and fails every warm resume`);
});

test("the recording engine's homes are real, distinct paths per ladder — the arm above is not vacuous", async () => {
  // A guard against the arm passing because every value is the same falsy thing, and against a single
  // global home shared across ladders (which explicitly rejected: concurrent stages would overwrite
  // one another's config.toml).
  const homes = [];
  GW.registerEngine({ name: CODEX,
    async runTurn(opts) {
      homes.push(opts?.codexHome ?? null);
      return { code: 1, killed: false, wall: 0.1, stdout: "", stderr: "boom", laneWaitMs: 0,
        json: null, usage: null, sessionRef: null };
    } });
  for (const tag of ["ladderA", "ladderB"]) {
    const runDir = freshRun(tag);
    await withEnv({ CLEAROTRON_AI: CODEX, CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0" }, () =>
      GW.runStage(`${tag}-stage`, { agent: "clawdi", message: "go", model: "haiku",
        sessionKey: `prelim-${tag}`, timeoutSec: 30, runDir }));
  }
  assert.equal(homes.length, 2, "two ladders, two dispatches");
  assert.equal(new Set(homes).size, 2,
    "two separate ladders must NOT share one home — concurrent stages render their own config.toml into "
    + "it, and a shared home is how one stage gets served another stage's tools (#713)");
});


// ── 3. THE REPAIR DISPATCH — the two sites the first pass could not see ─────────────────────────────
//
// VERIFIED BY PLANT AND FOUND WANTING. gateway.mjs has FOUR sites carrying these two fixes, not two:
// the main dispatch (:901) and record (:1511), and the FORM-REPAIR dispatch (:1056) and record (:1125).
// Removing either repair-path fix left every arm above green — the arms could not see them, and not
// because the assertions were weak: the fixtures ran with recovery off and a validator that never
// rejects, so the population could not produce the defect at all.
//
// IT IS THE PATH THAT MATTERS MOST. :1056's own comment reads "a relative path there would silently
// strip the write root off the one turn that needs it most" — the warm repair turn, which is the exact
// path and are about. A codexHome regression there is the original defect, and the suite
// stayed green through it.
//
// REACHING IT needs a form-class failure, which needs three things the arms above have none of: a
// declared `expectFile`, a `validate` that rejects it with a FORM_CLASS_RE reason, and
// `CLEAROTRON_FORM_REPAIR` on. The repair then happens INSIDE the dispatch — "the retry ladder is not
// charged" — which is why no amount of retry/recovery tuning could have reached it.

const FORM_FAIL = "framediff_severity_invalid";   // matches FORM_CLASS_RE; anything outside it never enters the loop

async function runWithFormRepair(tag, onTurn) {
  const runDir = freshRun(tag);
  const out = join(runDir, "frame-diff.md");
  const seen = { homes: [], turns: 0 };
  GW.registerEngine({ name: CODEX,
    async runTurn(opts) {
      seen.turns++; seen.homes.push(opts?.codexHome ?? null);
      writeFileSync(out, `attempt ${seen.turns}\n`);
      return onTurn ? onTurn(seen) : { code: 0, killed: false, wall: 0.2, stdout: "", stderr: LOUD_STDERR,
        laneWaitMs: 0, json: { status: "ok" }, usage: { input_tokens: 1, output_tokens: 1 }, sessionRef: "thread-abc" };
    } });
  let judged = 0;
  await withEnv({ CLEAROTRON_AI: CODEX, CLEAROTRON_MAX_RETRIES: "1", CLEAROTRON_RECOVERY_MAX: "0",
    CLEAROTRON_FORM_REPAIR: "1", CLEAROTRON_DISPATCH_RECORD: "1" }, () =>
    GW.runStage("frame-diff", { agent: "clawdi", message: "go", model: "haiku",
      sessionKey: `prelim-${tag}`, timeoutSec: 30, runDir, expectFile: [out],
      validate: () => { judged++; return judged <= 2 ? { ok: false, reason: FORM_FAIL } : { ok: true }; } }));
  return { runDir, seen, rows: rows(runDir, "frame-diff") };
}

test("#789 the FORM-REPAIR dispatch receives the ladder's codexHome too", async () => {
  const { seen, rows: r } = await runWithFormRepair("repairhome");

  // The premise first: without it the assertion below is about a path that never ran, which is exactly
  // how the repair sites went unpinned.
  const repairRows = r.filter((x) => Number(x.repair) > 0);
  assert.ok(repairRows.length >= 1,
    `the form-repair path never ran — this arm would assert nothing (turns ${seen.turns}, repair rows ${repairRows.length})`);
  assert.ok(seen.turns > repairRows.length,
    "there must be main dispatches as well as repair ones, or 'the SAME home' compares a set of one");

  for (const [i, h] of seen.homes.entries())
    assert.ok(h && typeof h === "string",
      `dispatch ${i + 1} received no codexHome. On the repair turn that strips the write root off the one `
      + `turn that needs it most — the warm patch resumes a thread whose rollout the home never saw (#713)`);
  assert.equal(new Set(seen.homes).size, 1,
    `the repair dispatch was handed a different home from the ladder's (${new Set(seen.homes).size} across `
    + `${seen.homes.length} dispatches). One home per LADDER is the invariant, and the repair turn is inside it`);
});

test("#789 the FORM-REPAIR record digests its stderr too", async () => {
  const { rows: r } = await runWithFormRepair("repairtail");
  const repairRows = r.filter((x) => Number(x.repair) > 0);
  assert.ok(repairRows.length >= 1, "the form-repair path never ran — nothing to assert about its record");

  for (const row of repairRows) {
    const tail = String(row.stderrTail ?? "");
    assert.ok(tail, `a form-repair record carried no stderrTail (repair ${row.repair})`);
    assert.match(tail, /line\(s\) elided/,
      "the repair record took raw stderr: `streamDigest` is no longer applied at THIS call site, so the "
      + "cause of a repair turn's death is buried under whatever the process said last");
    assert.doesNotMatch(tail, /\n/, "a digest joins with the marker, never with newlines");
  }
});

process.on("exit", () => { try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ } });

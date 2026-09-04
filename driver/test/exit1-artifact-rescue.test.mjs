// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Charter P1 §1+§2 (2026-07-30) — runStage-level truth tests, driven through a registered fake engine:
//
//   §2 exit-1 adapter rescue: the claude CLI reports a final-message HTTP 500 as subtype:"success" +
//   is_error:true; the adapter rightly converts that to exit 1 — but the turn's Write already landed the
//   artifact, and the driver re-ran finished work (~35 min on the R-round evidence run). runStage now
//   judges the ARTIFACT (present + fresh + valid — the same check the skip path runs) before accepting a
//   nonzero exit as failure. A stale (pre-existing, untouched) or invalid artifact must NEVER rescue.
//
//   §1 stall honesty: a STALL kill (signals.stalled — byte-silent or no-progress) retries ONCE at the
//   SAME budget — never the 1.5× "needed more time" extension (the R-round stall burned 1500s; its retry
//   did the identical work in 369s). A hard-wall kill (a genuine over-budget grind) keeps the extension.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, utimesSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { runStage, registerEngine } from "../gateway.mjs";
import { validators as validatorsForEra } from "../verify.mjs";

// Run `fn` with a registered fake engine selected via CLEAROTRON_AI, retry backoff disabled (the D3
// inter-attempt backoff would add 20s per retry otherwise), and full env restore.
async function withEngine(name, runTurn, fn) {
  registerEngine({ name, runTurn });
  const saved = { CLEAROTRON_AI: process.env.CLEAROTRON_AI, CLEAROTRON_RETRY_BACKOFF_MS: process.env.CLEAROTRON_RETRY_BACKOFF_MS };
  process.env.CLEAROTRON_AI = name;
  process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
  try { return await fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// The final-message-500 tuple: the artifact work is DONE, then the last assistant message 500s — claude
// reports subtype:"success" + is_error:true and the adapter converts it to exit 1 (envelope status error).
const turn500 = () => ({
  code: 1, killed: false, wall: 8, stdout: "API Error: 500 (final assistant message)", stderr: "",
  laneWaitMs: 0, json: { status: "error", result: { meta: { agentMeta: {} }, payloads: [{ text: "" }] }, summary: "success" },
  usage: { input: 12, output: 900, cacheRead: 40000, cacheWrite: 0, total: 40912 }, sessionRef: "s-500",
});

test("exit-1 rescue: a nonzero exit whose artifact is present, FRESH and valid is accepted as stage truth (attempt 1, no re-run)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescue-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  let calls = 0;
  try {
    const r = await withEngine("fake-500-after-write", async () => { calls++; writeFileSync(out, "# finished work\n"); return turn500(); },
      () => runStage("teststage", {
        agent: "clawdi", sessionKey: "prelim-test-rescue", message: "do it",
        model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
        validate: (f, text) => ({ ok: /finished work/.test(text) }), runDir: dir, maxRetries: 2,
      }));
    assert.equal(r.ok, true, "the artifact is the truth — a final-message 500 must not fail finished work");
    assert.equal(r.attempts, 1, "no re-run of finished work");
    assert.equal(calls, 1);
    // the journal row records WHAT was rescued — a rescued 500 must never read as a clean turn
    const rows = readFileSync(driverDir(dir, "teststage.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(rows.at(-1).rescued, "nonzero_exit_1");
    assert.equal(rows.at(-1).fail, null, "the row's fail is cleared by the rescue");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("exit-1 rescue refuses a STALE artifact: a pre-existing file the turn never rewrote rescues nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescue-stale-"));
  const out = join(dir, "out.md");
  writeFileSync(out, "# inherited artifact\n");                    // present BEFORE the stage runs
  utimesSync(out, new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));   // and old
  try {
    const r = await withEngine("fake-500-no-write", async () => turn500(),   // fails without touching the file
      () => runStage("teststage", {
        agent: "clawdi", sessionKey: "prelim-test-stale", message: "do it",
        model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
        validate: () => ({ ok: true }), runDir: dir, maxRetries: 1,
      }));
    assert.equal(r.ok, false, "an inherited file is the skip path's business, never a failed turn's alibi");
    assert.equal(r.fail, "nonzero_exit_1");
    assert.equal(r.attempts, 2, "the ladder ran (retry) — nothing was rescued");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("exit-1 rescue refuses an INVALID artifact: fresh but failing its validator keeps the failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescue-invalid-"));
  const out = join(dir, "out.md");
  try {
    const r = await withEngine("fake-500-bad-write", async () => { writeFileSync(out, "truncated garb"); return turn500(); },
      () => runStage("teststage", {
        agent: "clawdi", sessionKey: "prelim-test-invalid", message: "do it",
        model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
        validate: (f, text) => (/COMPLETE/.test(text) ? { ok: true } : { ok: false, reason: "incomplete" }),
        runDir: dir, maxRetries: 1,
      }));
    assert.equal(r.ok, false, "a fresh-but-invalid artifact is not finished work");
    assert.equal(r.fail, "nonzero_exit_1");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── §1: stall retries at the SAME budget; hard-wall keeps the extension ───────────────────────────

const stallTurn = (timeoutSec) => ({
  code: 137, killed: true, wall: timeoutSec + 60, stdout: "",
  stderr: "request timed out (anthropic-agent no-progress watchdog: no token movement / agent-loop step / artifact write for 900s — a STALL, not a slow turn)",
  laneWaitMs: 0, json: { status: "timeout", result: { meta: { agentMeta: {} }, payloads: [{ text: "" }] } },
  usage: { input: 10, output: 2, cacheRead: 2950000, cacheWrite: 0, total: 2950012 },   // tokens MOVED — not a lane wedge
  sessionRef: null, signals: { stalled: true, noProgress: true, usageStreamed: true },
});
const hardWallTurn = (timeoutSec) => ({
  code: 137, killed: true, wall: timeoutSec + 60, stdout: "", stderr: "",
  laneWaitMs: 0, json: { status: "timeout", result: { meta: { agentMeta: {} }, payloads: [{ text: "" }] } },
  usage: null, sessionRef: null, signals: { hardWall: true },
});

test("a STALL kill retries once at the SAME budget — never the 1.5× 'needed more time' extension", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stall-budget-"));
  const out = join(dir, "out.md");
  const budgets = [];
  try {
    const r = await withEngine("fake-stall-then-ok", async ({ timeoutSec }) => {
      budgets.push(timeoutSec);
      if (budgets.length === 1) return stallTurn(timeoutSec);
      writeFileSync(out, "done on the clean retry\n");
      return { code: 0, killed: false, wall: 369, stdout: "ok", stderr: "", laneWaitMs: 0,
        json: { status: "ok", result: { meta: { agentMeta: {} }, payloads: [{ text: "ok" }] } },
        usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 0, total: 115 }, sessionRef: "s-ok" };
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-stall-budget", message: "do it",
      model: "opus", thinking: "high", timeoutSec: 2500, expectFile: out,
      validate: () => ({ ok: true }), runDir: dir, maxRetries: 2,
    }));
    assert.equal(r.ok, true);
    assert.deepEqual(budgets, [2500, 2500], "the stall retry runs at the SAME budget — a stall is not a slow turn");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a HARD-WALL kill (genuine over-budget grind) keeps the single 1.5× extended retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wall-budget-"));
  const out = join(dir, "out.md");
  const budgets = [];
  try {
    const r = await withEngine("fake-wall-then-ok", async ({ timeoutSec }) => {
      budgets.push(timeoutSec);
      if (budgets.length === 1) return hardWallTurn(timeoutSec);
      writeFileSync(out, "done with the extra headroom\n");
      return { code: 0, killed: false, wall: 700, stdout: "ok", stderr: "", laneWaitMs: 0,
        json: { status: "ok", result: { meta: { agentMeta: {} }, payloads: [{ text: "ok" }] } },
        usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 0, total: 115 }, sessionRef: "s-ok" };
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-wall-budget", message: "do it",
      model: "opus", thinking: "high", timeoutSec: 600, expectFile: out,
      validate: () => ({ ok: true }), runDir: dir, maxRetries: 2,
    }));
    assert.equal(r.ok, true);
    assert.deepEqual(budgets, [600, 900], "a hard-wall kill still gets its one extended shot");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The raised synthesis wall is load-bearing only WITH the stall machinery above — pin both numbers so a
// future budget edit cannot silently detach them (charter P1 §1: the ceiling raise must not extend stall burn).
test("synthesis budget: timeoutSec 2500 with the 900s stall/no-progress ceiling (charter P1 §1)", async () => {
  const { STAGES } = await import("../stages.mjs");
  assert.equal(STAGES.synthesis.timeoutSec, 2500, "1500 → 2500 (honest long syntheses get headroom)");
  assert.equal(STAGES.synthesis.stallSec, 900, "the stall/no-progress ceiling stays WELL below the wall");
});

// — same discipline for placement-inquiry, and the number has a derivation rather than a feel.
// 2026-08-09 R1: attempt 1 walled at 1860s against 1800 and attempt 2 finished in 1844s against the
// 2700 the ladder's own 1.5x extension had granted it. The first budget is now the one the retry would
// get, so the run stops paying 31 minutes to discover it. stallSec is deliberately NOT raised with it.
test("#526 placement budget: timeoutSec 2700 with the 600s stall ceiling left where it was", async () => {
  const { STAGES } = await import("../stages.mjs");
  const p = STAGES["placement-inquiry"];
  assert.equal(p.timeoutSec, 2700, "1800 → 2700 — the value runStage's hard-wall retry already grants");
  assert.equal(p.stallSec, 600, "a silent wedge must still die in ten minutes; only the WORKING budget moved");
  assert.ok(p.stallSec * 4 <= p.timeoutSec,
    "the stall ceiling must stay well below the wall, or a raised wall just extends a wedge's burn");
});

// ── §2b: the CROSS-ATTEMPT rescue hole (post-merge audit 2, 2026-07-31) ──────────────────────────
//
// The audit repro: attempt 1 is a kill that landed a PARTIAL — possibly torn mid-write — artifact;
// attempt 2 is a nonzero exit. The rescue snapshotted the artifact ONCE before the whole ladder and
// exempted only the CURRENT attempt's `killed`, so attempt 2 measured freshness against a snapshot
// that predated attempt 1's write: the kill-partial read as "fresh, valid" and shipped as stage truth
// with a journaled `rescued` marker — violating the rescue's own design rule ("never applies to a
// kill … a cut-down turn's artifact may be mid-write"). Register stages have register-taint.mjs as a
// backstop; synthesis / narrative / cards / digest have NONE.
//
// The kill fixture is `hardWallTurn` above — the shape the archived 2026-07-29 evidence run really
// recorded on its SYNTHESIS stage (`_driver/synthesis.jsonl`, attempt 1 of the 23:21Z invocation:
// code 137, killed:true, status "timeout", signals {hardWall:true}, usage null, wall 1560.578 against
// timeoutSec 1500 — and its attempt 2 then shipped). Synthesis is exactly the no-backstop lane.
//
// The benign class register-taint's 70-run corpus audit cleared — a kill followed by a redo that
// EXITS CLEAN — is pinned by "a HARD-WALL kill … keeps the single 1.5× extended retry" above: that
// ladder still succeeds. This section refuses only the case where the follow-on turn ALSO failed.

// A kill whose turn left bytes behind before the wall took it down.
const killPartialTurn = (out, text, timeoutSec) => { writeFileSync(out, text); return hardWallTurn(timeoutSec); };

// Both journals: the per-stage detail file AND run.jsonl (AD-4's per-attempt spine — the store a
// reader or metric would consult). Asserted non-vacuously: the rows must be there to be checked.
const assertNoRescueJournaled = (dir, stage, attempts) => {
  const stageRows = readFileSync(driverDir(dir, `${stage}.jsonl`), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(stageRows.length, attempts, `${stage}.jsonl carries one row per attempt`);
  assert.ok(stageRows.every((row) => !row.rescued), "no rescued marker in the per-stage journal");
  const runRows = readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").map(JSON.parse)
    .filter((row) => row.event === "attempt" && row.stage === stage);
  assert.equal(runRows.length, attempts, "run.jsonl carries one attempt row per attempt");
  assert.ok(runRows.every((row) => !row.rescued), "no rescued marker on run.jsonl either");
};

test("a kill-partial from attempt 1 never rescues attempt 2's no-write nonzero exit — the failure stays honest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescue-killpartial-"));
  const out = join(dir, "out.md");
  let calls = 0;
  try {
    const r = await withEngine("fake-kill-then-exit1", async ({ timeoutSec }) => {
      calls++;
      if (calls === 1) return killPartialTurn(out, "# synthesis — torn mid-wr", timeoutSec);
      return turn500();                       // a startup/transport death: touches nothing
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-killpartial", message: "do it",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
      validate: () => ({ ok: true }),   // the torn partial CLEARS the stage validator — shape is not completeness
      runDir: dir, maxRetries: 1,
    }));
    assert.equal(calls, 2, "the ladder ran both attempts");
    assert.equal(r.ok, false, "an earlier attempt's bytes are never this attempt's alibi");
    assert.equal(r.fail, "nonzero_exit_1");
    assert.equal(r.wrote, false, "AD-4 agrees: attempt 2 emitted nothing (same snapshot the rescue reads)");
    assertNoRescueJournaled(dir, "teststage", 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("after a kill in the ladder the rescue stays CLOSED — even for a later attempt's own fresh, valid write", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescue-killclosed-"));
  const out = join(dir, "out.md");
  let calls = 0;
  try {
    const r = await withEngine("fake-kill-then-write-exit1", async ({ timeoutSec }) => {
      calls++;
      if (calls === 1) return killPartialTurn(out, "# synthesis — torn mid-wr", timeoutSec);
      writeFileSync(out, "# COMPLETE finished work\n");   // attempt 2's own write — fresh AND valid — then a 500
      return turn500();
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-killclosed", message: "do it",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
      validate: (f, text) => ({ ok: /COMPLETE/.test(text) }), runDir: dir, maxRetries: 1,
    }));
    assert.equal(r.ok, false, "a kill tore the file underneath this write: 'stat differs' is a mutation, not a proven rewrite, and a validator cannot prove completeness");
    assert.equal(r.fail, "nonzero_exit_1");
    assert.equal(r.wrote, true, "the write is REAL and recorded — it is the rescue that refuses it, not the telemetry");
    assertNoRescueJournaled(dir, "teststage", 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("with NO kill in the ladder a LATER attempt still rescues its own fresh, valid write (the per-attempt snapshot did not over-fix)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rescue-lateattempt-"));
  const out = join(dir, "out.md");
  let calls = 0;
  try {
    const r = await withEngine("fake-nofile-then-500-after-write", async () => {
      calls++;
      if (calls === 1) return { code: 0, killed: false, wall: 20, stdout: "ok", stderr: "", laneWaitMs: 0,
        json: { status: "ok", result: { meta: { agentMeta: {} }, payloads: [{ text: "ok" }] } },
        usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 0, total: 115 }, sessionRef: "s-nofile" };
      writeFileSync(out, "# COMPLETE finished work\n");   // attempt 2 does the work, then the final message 500s
      return turn500();
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-lateattempt", message: "do it",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
      validate: (f, text) => ({ ok: /COMPLETE/.test(text) }), runDir: dir, maxRetries: 1,
    }));
    assert.equal(calls, 2);
    assert.equal(r.ok, true, "a clean-exit attempt-1 content failure is not a kill — finished work on attempt 2 is still stage truth");
    const rows = readFileSync(driverDir(dir, "teststage.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(rows.at(-1).rescued, "nonzero_exit_1", "the rescue fires on attempt 2 and says so");
    assert.equal(rows.at(-1).wrote, true, "and AD-4 records the emit that justified it");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── — THE WALL RESCUE ────────────────────────────────────────────────────────────────────────
// A stage SIGKILLed at its hard wall AFTER writing a complete, valid artifact is a stage that SUCCEEDED.
// On the R1 run of 2026-08-04 the run instead walled twice, parked, and the resume two minutes later
// SKIPPED the stage because the artifact was there and passed its validator — 77 minutes of dispatch and
// one park out of three spent after the deliverable was finished.
//
// The discriminator against the audit-2 torn draft below is QUIESCENCE, and only quiescence: the artifact
// had been untouched for 974 seconds when that kill landed, and a torn write is untouched for none.
const quiesce = (path, seconds) => { const t = Date.now() / 1000 - seconds; utimesSync(path, t, t); };

test("#394: a hard-wall kill whose artifact was written by this attempt, validates, and had gone QUIET is accepted as stage truth", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wall-rescue-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  let calls = 0;
  try {
    const r = await withEngine("fake-wall-after-quiet-write", async ({ timeoutSec }) => {
      calls++;
      writeFileSync(out, "# COMPLETE placement recommendations\n");
      quiesce(out, 974);            // the measured margin on the incident: written, then 16 minutes of other work
      return hardWallTurn(timeoutSec);
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-wallrescue", message: "do it",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
      validate: (f, text) => ({ ok: /COMPLETE/.test(text) }), runDir: dir, maxRetries: 1,
    }));
    assert.equal(r.ok, true, "the stage finished — the wall is a fact about the dispatch, not a failure of the stage");
    assert.equal(r.attempts, 1, "and the second wall is never paid for");
    assert.equal(calls, 1);
    const rows = readFileSync(driverDir(dir, "teststage.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(rows.at(-1).rescued, "timeout", "the row names WHAT was rescued — a rescued wall never reads as a clean turn");
    assert.equal(rows.at(-1).fail, null);
    assert.equal(rows.at(-1).killed, true, "the kill is still on the record: succeeded-at-the-wall stays distinguishable from succeeded normally");
    assert.ok(rows.at(-1).quiescentMs >= 900_000, "and the evidence that justified it is a number on the row");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#394: a hard-wall kill whose artifact was still being written is REFUSED — and the refusal is recorded, not silent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wall-torn-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    const r = await withEngine("fake-wall-mid-write", async ({ timeoutSec }) => {
      writeFileSync(out, "# COMPLETE-looking but torn mid-wr");   // clears the validator; shape is not completeness
      return hardWallTurn(timeoutSec);                            // killed the same instant ⇒ zero quiescence
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-walltorn", message: "do it",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
      validate: (f, text) => ({ ok: /COMPLETE/.test(text) }), runDir: dir, maxRetries: 0,
    }));
    assert.equal(r.ok, false, "post-merge audit 2 stands: a validator is a shape check, not a completeness proof");
    assert.equal(r.fail, "timeout", "and it fails as what it was");
    const rows = readFileSync(driverDir(dir, "teststage.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(!rows.at(-1).rescued, "nothing was rescued");
    // The load-bearing half: "the rescue considered this and refused" must not be the same silence as
    // "the rescue never looked". This repo has read an absence as a diagnosis before.
    assert.ok(Number.isFinite(rows.at(-1).quiescentMs), "the refusal is on the record with the number behind it");
    assert.ok(rows.at(-1).quiescentMs < 60_000);
    // — and with the CAUSE, not just the number. quiescentMs alone cannot separate the three
    // refusals: this one is under the bar, but a refusal for a failed validator carries a large
    // quiescentMs and looked identical on the row.
    assert.equal(rows.at(-1).rescueRefused, "under-quiescence");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// — THE R1 SHAPE, AND THE ONE THE RECORD COULD NOT NAME.
//
// 2026-08-09 R1: placement-inquiry was killed at its hard wall having written a complete, valid
// placement-recommendations.md and lain quiescent for 371 s against a 60 s bar. The rescue still refused
// — validators.placement fails `placementmodel_missing` while the structured sibling placements.json is
// absent, and the seat writes the prose first. 31 minutes of finished work were discarded and re-run
// cold, and `grep -c rescue run.jsonl` on that delivered run returns 0: the reason lived in a note() and
// never reached the journal. Reconstructing it took an mtime comparison against a preserved run dir.
//
// On the row, this case and the one above were both `rescued: null`. They are now distinguishable.
test("#526: a quiescent, WRITTEN artifact refused by its VALIDATOR names that cause — the R1 discard", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wall-invalid-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    const r = await withEngine("fake-wall-quiet-but-invalid", async ({ timeoutSec }) => {
      writeFileSync(out, "# placement recommendations — prose written, structured sibling never emitted\n");
      quiesce(out, 371);                    // the measured R1 margin, far past the 60s bar
      return hardWallTurn(timeoutSec);
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-wallinvalid", message: "do it",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
      // stands in for validators.placement's structured-sibling floor: the prose is there, the JSON is not
      validate: () => ({ ok: false, reason: "placementmodel_missing" }), runDir: dir, maxRetries: 0,
    }));
    assert.equal(r.ok, false);
    const row = readFileSync(driverDir(dir, "teststage.jsonl"), "utf8").trim().split("\n").map(JSON.parse).at(-1);
    assert.ok(!row.rescued, "nothing was rescued — that part is correct and is not what changed");
    assert.ok(row.quiescentMs >= 300_000, "the artifact was long finished when the turn was killed");
    assert.equal(row.rescueRefused, "not-written-by-this-attempt-or-invalid",
      "and the record now says WHICH of the three causes refused — the fact R1's journal could not supply");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#394: a stage with NO validator is untouched by the wall rescue — there is nothing to judge the artifact with", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wall-noval-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    const r = await withEngine("fake-wall-no-validator", async ({ timeoutSec }) => {
      writeFileSync(out, "# whatever\n");
      quiesce(out, 974);
      return hardWallTurn(timeoutSec);
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-wallnoval", message: "do it",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
      runDir: dir, maxRetries: 0,
    }));
    assert.equal(r.ok, false, "quiescence proves the write finished, never that the answer is right — without a validator there is no evidence to rescue on");
    assert.equal(r.fail, "timeout");
    const rows = readFileSync(driverDir(dir, "teststage.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(!rows.at(-1).rescued);
    assert.equal(rows.at(-1).quiescentMs, undefined, "the arm did not apply, so it records no number");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#394: CLEAROTRON_WALL_RESCUE=0 disarms it — the stage fails as timeout exactly as before", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wall-disarm-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  const saved = process.env.CLEAROTRON_WALL_RESCUE;
  process.env.CLEAROTRON_WALL_RESCUE = "0";
  try {
    const r = await withEngine("fake-wall-disarmed", async ({ timeoutSec }) => {
      writeFileSync(out, "# COMPLETE\n");
      quiesce(out, 974);
      return hardWallTurn(timeoutSec);
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-walldisarm", message: "do it",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
      validate: () => ({ ok: true }), runDir: dir, maxRetries: 0,
    }));
    assert.equal(r.ok, false);
    assert.equal(r.fail, "timeout");
  } finally {
    if (saved === undefined) delete process.env.CLEAROTRON_WALL_RESCUE; else process.env.CLEAROTRON_WALL_RESCUE = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── — the dispatch record, through runStage ──────────────────────────────────────────────────
test("#380: every attempt leaves the verbatim message it was dispatched with, and the row points at it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-gw-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  let calls = 0;
  try {
    const r = await withEngine("fake-dispatch-record", async () => {
      calls++;
      if (calls === 1) return turn500();          // fail once so a SECOND, corrective dispatch happens
      writeFileSync(out, "# COMPLETE\n");
      return { code: 0, killed: false, wall: 5, stdout: "ok", stderr: "", laneWaitMs: 0,
        json: { status: "ok", result: { meta: { agentMeta: {} }, payloads: [{ text: "ok" }] } },
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 }, sessionRef: "s" };
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-dispatch",
      // the acceptance shape: a qid that rides the MESSAGE BODY and is not a declared input file
      message: "Dispatch one: deferred slice Q-SYNTH-1 — provider cannot express",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
      validate: (f, text) => ({ ok: /COMPLETE/.test(text) }), runDir: dir, maxRetries: 1,
    }));
    assert.equal(r.ok, true);
    assert.equal(calls, 2, "two dispatches, so there must be two records");

    const rows = readFileSync(driverDir(dir, "teststage.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(rows.length, 2);
    for (const [i, row] of rows.entries()) {
      assert.ok(row.dispatch?.present, `attempt ${i + 1} recorded its dispatch`);
      const text = readFileSync(join(dir, row.dispatch.file.replace(/^_driver\//, "_driver/")), "utf8");
      assert.ok(text.length > 0);
      if (i === 0) assert.match(text, /Q-SYNTH-1/, "the body-borne qid is answerable from the run");
    }
    // Each attempt is labelled by KIND, so two rows are distinguishable without opening either file.
    assert.equal(rows[0].dispatch.kind, "fresh");
    assert.ok(["corrective", "warm-patch"].includes(rows[1].dispatch.kind), rows[1].dispatch.kind);
    // …and here the two shas are EQUAL, which is the honest record of a real behaviour worth pinning:
    // attempt 1 died in TRANSPORT (a final-message 500), so there is no content defect to correct and
    // the retry re-sends the identical prompt. Before this record existed, "did the retry change what it
    // asked for?" could only be guessed at. Now it is one comparison, and the answer here is "no".
    assert.equal(rows[0].dispatch.sha, rows[1].dispatch.sha,
      "a transport failure has nothing to correct, so the corrective attempt re-sends the same message");

    // and the run.jsonl spine carries the pointer + sha, not the text
    const spine = readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").map(JSON.parse)
      .filter((x) => x.event === "attempt" && x.stage === "teststage");
    assert.equal(spine.length, 2);
    assert.ok(spine.every((x) => x.dispatch && x.dispatchSha));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#380: CLEAROTRON_DISPATCH_RECORD=0 disarms it — the row says null rather than claiming a record that is not there", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dispatch-off-"));
  const out = join(dir, "out.md");
  mkdirSync(driverDir(dir), { recursive: true });
  const saved = process.env.CLEAROTRON_DISPATCH_RECORD;
  process.env.CLEAROTRON_DISPATCH_RECORD = "0";
  try {
    await withEngine("fake-dispatch-off", async () => {
      writeFileSync(out, "# COMPLETE\n");
      return { code: 0, killed: false, wall: 5, stdout: "ok", stderr: "", laneWaitMs: 0,
        json: { status: "ok", result: { meta: { agentMeta: {} }, payloads: [{ text: "ok" }] } },
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 }, sessionRef: "s" };
    }, () => runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-dispatch-off", message: "do it",
      model: "opus", thinking: "medium", timeoutSec: 600, expectFile: out,
      validate: () => ({ ok: true }), runDir: dir, maxRetries: 0,
    }));
    const rows = readFileSync(driverDir(dir, "teststage.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(rows.at(-1).dispatch, null, "off is null — never a {present:true} that names no file");
    assert.deepEqual(readdirSync(driverDir(dir)).filter((f) => f.endsWith("dispatch.txt")), []);
  } finally {
    if (saved === undefined) delete process.env.CLEAROTRON_DISPATCH_RECORD; else process.env.CLEAROTRON_DISPATCH_RECORD = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── — THE R1 INCIDENT, END TO END, AS THE RESCUE NOW SEES IT ─────────────────────────────────────
//
// On R1 2026-08-09 the wall rescue looked at a complete, quiescent `placement-recommendations.md` and
// REFUSED, because `validators.placement` failed `placementmodel_missing` while `placements.json` was
// absent — and the seat writes the prose first (md at 09:08:58, json at 09:15:50, by attempt 2). 31
// minutes of finished tiers were discarded and re-derived from nothing.
//
// The premise is retired: under the form era the seat never writes placements.json at all — the driver
// renders it from the accumulator — so the validator does not ask for it, and a quiescent prose-only
// attempt is exactly the state the rescue exists to accept. This is the assertion that the CURE holds,
// as opposed to merely that the arm was deleted.
test("#562: the wall rescue ACCEPTS a quiescent prose-only placement attempt — the R1 discard cannot recur", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wall-placement-"));
  const out = join(dir, "placement-recommendations.md");
  mkdirSync(driverDir(dir), { recursive: true });
  // The era stamp, exactly as `recordStageContract` writes it at dispatch.
  writeFileSync(driverDir(dir, "stage-contracts.json"),
    JSON.stringify({ "placement-inquiry": { structuredPlacements: 1, placementForm: 1 } }));
  const { validators } = await import("../verify.mjs");
  try {
    const r = await withEngine("fake-wall-placement", async ({ timeoutSec }) => {
      writeFileSync(out, "# Placement recommendations\n\n## Tier 1 — headline candidates\n"
    + "- NOVAPULSE (Acme SA, US/EU/CH) — sheet 2. Identical word mark, same class, live family "
    + "across three territories; the owner trades in the same channel and the overlap is direct.\n\n"
    + "## Tier 2 — sheet 2\n- NOVAPULSAR (Beta KK, JP) — near mark, adjacent goods, no channel overlap "
    + "on the record read here.\n\n## Band reconciliation\nEvery floor record is placed or named.\n");
      quiesce(out, 371);            // the incident's own margin, against a 60-second bar
      return hardWallTurn(timeoutSec);
    }, () => runStage("placement-inquiry", {
      agent: "clawdi", sessionKey: "prelim-test-placement-wall", message: "place them",
      model: "opus", thinking: "high", timeoutSec: 600, expectFile: out,
      validate: validators.placement, runDir: dir, maxRetries: 1,
    }));
    assert.equal(r.ok, true, "the finished prose IS the stage's truth — no placements.json is owed by the seat");
    assert.equal(r.attempts, 1, "and the 1.5x cold re-derivation is never paid for");
    const rows = readFileSync(driverDir(dir, "placement-inquiry.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(rows.at(-1).rescued, "timeout");
    // put the refusal CAUSE on the row. Absent (or null) means the rescue was not refused at all,
    // which is the whole claim here: the R1 row read `rescued: null` with the artifact complete on disk.
    assert.ok(rows.at(-1).rescueRefused == null, "nothing refused it — the cause of the R1 refusal is gone");
    // …and the deliverable is ON DISK, rendered by the driver from the form, at the moment the seat's
    // work exists rather than once the turn is allowed to finish. That render happens inside
    // attemptWroteTruth — the rescue's own judgement — which is what closes the gap the kill landed in.
    assert.ok(existsSync(join(dir, "placements.json")),
      "the driver rendered the structured deliverable during the rescue's judgement, not after the turn");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#562: with the era stamped, an ABSENT placements.json is not the seat's defect", () => {
  // The validator arm in isolation, because in a live run the driver's render usually satisfies the old
  // floor anyway — which would let the deletion of this branch pass unnoticed. The case it governs is the
  // one that matters: the render did NOT land (a parse-then-land refusal, a full disk) and the seat's
  // prose is nonetheless complete. Blaming the seat there with `placementmodel_missing` would kill a run
  // over a driver failure and discard finished work, which is the R1 pathology exactly.
  const dir = mkdtempSync(join(tmpdir(), "placement-era-"));
  const out = join(dir, "placement-recommendations.md");
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "stage-contracts.json"),
    JSON.stringify({ "placement-inquiry": { structuredPlacements: 1, placementForm: 1 } }));
  try {
    writeFileSync(out, "# Placement recommendations\n\n## Tier 1 — headline candidates\n"
      + "- NOVAPULSE (Acme SA, US/EU/CH) — sheet 2. Identical word mark, same class, live family "
      + "across three territories; the owner trades in the same channel and the overlap is direct.\n\n"
      + "## Tier 2 — sheet 2\n- NOVAPULSAR (Beta KK, JP) — near mark, adjacent goods, no channel overlap "
      + "on the record read here.\n\n## Band reconciliation\nEvery floor record is placed or named.\n");
    assert.ok(!existsSync(join(dir, "placements.json")));
    const v = validatorsForEra.placement(out, readFileSync(out, "utf8"));
    assert.equal(v.ok, true, "the seat owes prose and a form; it does not owe placements.json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#562: an ARCHIVED run keeps the old floor — deleting the arm must not re-judge what already shipped", async () => {
  // The era stamp is the whole guard. A run minted before carries `structuredPlacements` alone, and
  // for it the absent sibling is still a defect: that run's seat WAS asked for the file. Replay verdicts
  // over the archive must not flip, which is the rule every contract marker in this driver is written to.
  const dir = mkdtempSync(join(tmpdir(), "wall-placement-legacy-"));
  const out = join(dir, "placement-recommendations.md");
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "stage-contracts.json"),
    JSON.stringify({ "placement-inquiry": { structuredPlacements: 1 } }));
  const { validators } = await import("../verify.mjs");
  try {
    writeFileSync(out, "# Placement recommendations\n\n## Tier 1 — headline candidates\n"
    + "- NOVAPULSE (Acme SA, US/EU/CH) — sheet 2. Identical word mark, same class, live family "
    + "across three territories; the owner trades in the same channel and the overlap is direct.\n\n"
    + "## Tier 2 — sheet 2\n- NOVAPULSAR (Beta KK, JP) — near mark, adjacent goods, no channel overlap "
    + "on the record read here.\n\n## Band reconciliation\nEvery floor record is placed or named.\n");
    const v = validators.placement(out, readFileSync(out, "utf8"));
    assert.equal(v.ok, false, "pre-#562 vintage: the seat owed placements.json and did not write it");
    assert.equal(v.reason, "placementmodel_missing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// tracker issue 1828 — A WAIT THIS PROCESS COULD NOT OBSERVE IS RECORDED AS ONE IT DID NOT HAVE.
//
// The tool-time gauge stamps `Date.now()` when it PARSES a line. Every line delivered in one stdout
// chunk is parsed in a single synchronous loop, so they all share one timestamp. Block this process's
// event loop across an ask and its result and the wait records 0 — while `toolCalls` stays correct, so
// nothing else in the row looks wrong.
//
// MEASURED, twice, on this repository's own suite: a turn that waited 260ms reported
// `{"register_execute_plan":380,"perplexity_ask":0}` and then `{...:271,"perplexity_ask":0}`. Blocking
// the loop for 320ms starting 200ms into the turn reproduces the first to within 5ms. Four candidate
// triggers were measured and refuted — CPU starvation (which only ever inflates), major GC (6.3ms
// against the ~300 needed), disk contention on the watchdog's stat (10.8ms), and cgroup throttling
// (no quota at all). The stall is real and its origin is not attributed.
//
// THIS FILE DOES NOT FIX THE GAUGE. Telling "waited zero" from "was not looking" changes what the kill
// clock consumes, and that is a design question the owner holds. What is built here is the flag: the
// row says it could not look, so the NEXT occurrence arrives as evidence instead of as a third
// specimen — which is the position tracker issue 1780 was in for days.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
// tracker issue 1673 — both of these answer to two spellings, and setting one loses to an
// explicitly-set other. pinEnv writes every spelling from the alias table.
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
pinEnv(process.env, "CLEAROTRON_AI", "anthropic-agent");
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "unmeas-locks-"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
const { runStage } = await import("../gateway.mjs");

const FIXTURE = [
  { name: "register_execute_plan", ms: 120 },
  { name: "register_execute_plan", ms: 80 },
  { name: "perplexity_ask", ms: 60 },
];

let dir;
beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "unmeas-"));
  mkdirSync(driverDir(dir), { recursive: true });
  process.env.MOCK_CLAUDE_CALL_LOG = join(dir, "calls.jsonl");
  process.env.MOCK_OUT_FILE = join(dir, "out.md");
  process.env.MOCK_COUNT_FILE = join(dir, "count");
  process.env.MOCK_CLAUDE_FILE = "a stub the validator accepts\n";
  process.env.MOCK_CLAUDE_TOOL_WAIT = JSON.stringify(FIXTURE);
});

// `stallMs` blocks THIS process's event loop, which is the whole mechanism: the child keeps writing,
// the bytes queue in the pipe, and one later read delivers an ask and its result together.
const runIt = async (key, { startMs = 0, stallMs = 0 } = {}) => {
  const p = runStage("unmeasurable-stage", {
    agent: "clawdi", message: `TASK\nOUTPUT_FILE: ${process.env.MOCK_OUT_FILE}`, sessionKey: key,
    timeoutSec: 30, expectFile: process.env.MOCK_OUT_FILE, maxRetries: 0, runDir: dir,
  }).catch(() => {});
  if (stallMs) setTimeout(() => { const until = Date.now() + stallMs; while (Date.now() < until) { /* block */ } }, startMs);
  await p;
  // ✕ THE LAST LINE, NOT THE FIRST, AND THE LADDER IS WHY. This read was written when runIt ran ONCE
  // per test, where [0] and "the row this call wrote" are the same line. The escalating ladder made it
  // call runIt up to six times against the SAME run dir, and the stage APPENDS a row per attempt — so
  // every rung after the first re-read rung 0's row and reported its numbers as its own.
  //
  // Measured with the ladder forced to exhaust: lines=1..9 as the rungs ran, `idx0-unmeas=0` throughout
  // while the LAST row carried 2 and then 3 unmeasurable entries. The condition was being built on rungs
  // 3, 5, 6, 7 and 8 and thrown away every time. That is why CI showed six stall widths across a 6x
  // range with byte-identical numbers: they were all one row. Widening the stall could never have worked,
  // and the ladder I added to make width win was the change that broke the read.
  const rows = readFileSync(driverDir(dir, "unmeasurable-stage.jsonl"), "utf8").trim().split("\n");
  return JSON.parse(rows[rows.length - 1]);
};

test("tracker issue 1828 an ordinary turn measures every wait and records an EMPTY list", async () => {
  // THE CONTROL, and it is not a formality: every arm below passes on an engine that flags every turn.
  // This is the only one that fails on it.
  const row = await runIt("unmeas-clean");
  assert.deepEqual(row.toolWaitUnmeasurable, [],
    `an unblocked turn reported ${JSON.stringify(row.toolWaitUnmeasurable)} — either the flag fires on `
    + "ordinary delivery, in which case it says nothing, or the field is not being recorded at all");
  // A LOOSE BOUND, DELIBERATELY. This arm asserts that a real wait was measured, so that the empty list
  // above means something; it does NOT assert the gauge is accurate — that claim belongs to
  // the-attempt-record-carries-tool-time, and it is the claim tracker issue 1828 is about. Measured at
  // 240 under concurrent suite load against a 260ms fixture, so a bound near the fixture's own total is
  // a second copy of the brittle threshold rather than a check on anything this file is for.
  assert.ok(row.toolWaitMs >= 150,
    `the fixture asks for ~260ms of waiting and the gauge recorded ${row.toolWaitMs} — with no real `
    + "measured wait here, an empty unmeasurable list is vacuous rather than informative");
});

// ── THE STALL IS ATTEMPTED AND COUNTED, NEVER ASSUMED ────────────────────────────────────────────
//
// This arm asserted the outcome of a single stalled run and took main red on 2026-08-25/26 under CI
// load, on content identical to a run that had passed minutes earlier. It was not flaky and re-running
// it would have been the wrong response: the condition is a RACE between this process's blocked loop
// and the child's writes, and on a busy box the child can fall outside the stall window entirely — so
// every period is measured, nothing is declared, and the arm reports the engine as broken when what
// failed was the setup.
//
// COUNTED RATHER THAN TUNED, because tuning is what cannot be verified here. On a quiet box:
//
//   start=200 stall=320   built the condition 8/8      <- the parameters that went red under load
//   start=100 stall=600   built the condition 8/8
//   start= 50 stall=800   built the condition 8/8
//   start=200 stall=  1   built the condition 0/8      <- the control: the fixture really does depend
//                                                         on the stall, so a hit is not incidental
//
// Every workable parameter set scores 8/8 on a quiet box and one of them still failed on a busy one.
// No number measurable here proves robustness against a condition that cannot be reproduced here. So
// the arm stops asserting that the fixture worked and starts REQUIRING it to work, with an escalating
// window and a loud failure when it never does.
//
// AND A MISS IS A FAILURE, NOT A PASS. An arm whose fixture could not build the state it exists to test
// has proved nothing; reporting that as green is the same defect one level up from the one this file
// is about — a could-not-look wearing a measurement's clothes.
const STALL_LADDER = [
  { startMs: 200, stallMs: 320 },    // the historical parameters, first
  { startMs: 150, stallMs: 500 },
  { startMs: 100, stallMs: 800 },
  { startMs: 50, stallMs: 1200 },
  { startMs: 50, stallMs: 1600 },
  { startMs: 50, stallMs: 2000 },    // strictly wider each time: if load is the cause, width wins
];

test("tracker issue 1828 a wait lost to a stalled loop is NAMED, not silently zeroed", async () => {
  let observed = null;
  const tried = [];
  for (const [i, rung] of STALL_LADDER.entries()) {
    if (observed) break;
    const row = await runIt(`unmeas-stalled-${i}`, rung);
    tried.push({ ...rung, unmeasurable: (row.toolWaitUnmeasurable ?? []).length,
      byTool: row.toolWaitByTool, toolWaitMs: row.toolWaitMs });
    if (Array.isArray(row.toolWaitUnmeasurable) && row.toolWaitUnmeasurable.length >= 1) observed = row;
  }

  // ── AND THE MESSAGE SEPARATES "NEVER BUILT" FROM "BUILT AND NOT READ" ──────────────────────────
  //
  // Those are opposite repairs and the first version of this failure could not tell them apart: it
  // reported six rungs with byte-identical numbers, which reads as "the stall never lands, widen it"
  // and was in fact "every rung re-read rung 0's row". The stage appends one row per attempt, so the
  // file itself holds the answer — if ANY row carries an unmeasurable entry, the condition WAS built
  // and the read is the defect, not the ladder.
  const everyRow = readFileSync(driverDir(dir, "unmeasurable-stage.jsonl"), "utf8").trim().split("\n")
    .map((l) => { try { return (JSON.parse(l).toolWaitUnmeasurable ?? []).length; } catch { return 0; } });
  const builtSomewhere = everyRow.filter((n) => n > 0).length;
  assert.ok(observed,
    (builtSomewhere
      ? `THE CONDITION WAS BUILT AND THE READ THREW IT AWAY: ${builtSomewhere} of ${everyRow.length} `
        + `recorded attempts carry an unmeasurable entry, and this arm still saw none. That is a defect in `
        + `HOW the rung's row is read, not in the stall — do not widen the ladder. Per-row counts: `
        + `${JSON.stringify(everyRow)}.\n  `
      : `${STALL_LADDER.length} attempts, each with a wider stall than the last, and the loop was never `
        + `blocked across an ask and its result. THE FIXTURE COULD NOT BUILD THE STATE THIS ARM TESTS — `
        + `that is a setup failure, not a finding about the engine, and it is reported as a failure `
        + `because an arm that proved nothing must not report green.\n  `)
    + JSON.stringify(tried));

  // Only NOW the assertions about the record, on a run where the condition demonstrably held.
  const entry = observed.toolWaitUnmeasurable[0];
  assert.ok(entry.tool, "an entry that does not name its tool cannot be acted on");
  assert.ok(Number.isInteger(entry.bytes) && entry.bytes > 0,
    "the chunk size is what turns the next occurrence into evidence — an entry without it is a bare flag");
  assert.ok(Number.isInteger(entry.sincePrevChunkMs),
    "the gap since the previous chunk says how long this process was away");
  assert.ok(entry.cause === "result-in-ask-chunk" || entry.cause === "ask-superseded-in-chunk",
    `the entry must say WHICH blindness it is — a result answering inside a stalled read, or an ask `
    + `superseded before its own period could be seen. Saw ${JSON.stringify(entry.cause)}`);
});

test("tracker issue 1828 the flag is RECORDING ONLY — the total and the split are untouched", async () => {
  // The per-tool parts sum to the total, and the kill clock reads that total. If this change moved
  // either, it would have reshaped what a kill decision consumes, which is the owner's call and not
  // this one's. Asserted on a stalled turn, where the numbers are at their most wrong.
  const row = await runIt("unmeas-identity", { startMs: 200, stallMs: 320 });
  const parts = Object.values(row.toolWaitByTool).reduce((a, b) => a + b, 0);
  assert.equal(parts, row.toolWaitMs,
    `the per-tool parts sum to ${parts} and the total is ${row.toolWaitMs} — the identity moved, so this `
    + "change did more than record");
  assert.equal(row.toolCalls, 3, "three asks were made and the count must still say so");
});

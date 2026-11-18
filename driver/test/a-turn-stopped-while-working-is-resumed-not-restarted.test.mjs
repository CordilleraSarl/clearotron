// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A stage attempt stopped at its hard wall always retried on a fresh session, even when it was still working: measured
// before this was built, 10 of 14 saved hard-wall kills on production and 18 of 24 on a test machine had asked for a
// tool inside their last stall window, and two production syntheses each spent about 55 minutes doing their work again.
// The single extended timeout retry now resumes the same session when the kill was working, with the message design
// wrote; a kill that was silent, or only making its own record write, retries fresh as before. These arms drive the
// gateway's ladder with an engine stand-in, so no program runs and no model or register is called.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
const ROOT = mkdtempSync(join(tmpdir(), "warm-timeout-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "0";
const GW = await import("../gateway.mjs");

const OPENING = "You are RESUMING your own session for this stage — your prior work and inputs are already in your context. Do NOT redo the work from scratch.\n"
  + "Your previous turn was stopped at the stage's time limit while you were still working. Everything you already recorded through the stage's tools is kept; do not record it again. Continue from the last step you completed, finish what remains, and then ";
const CLOSING = " This attempt has a longer limit, but not an unlimited one: finish the remaining work rather than revisiting finished steps.";

/** A turn the watchdog stopped at its hard wall `wall` seconds in, whose last asks were at these ms from spawn. */
const killed = (wall, lastToolAsk) => ({ code: 137, killed: true, wall, stdout: "", stderr: "", laneWaitMs: 0, json: null, usage: null,
  sessionRef: "thr-1", signals: { hardWall: true }, lastToolAsk });

test("a kill reads as working, record-only or silent from the stage's last stall window, and anything else is null", () => {
  const at = (s) => s * 1000;
  assert.equal(GW.killedWhile(killed(2600, { workMs: at(2599), recordMs: null }), 900), "working");
  assert.equal(GW.killedWhile(killed(2600, { workMs: at(1000), recordMs: at(2590) }), 900), "record-only");
  assert.equal(GW.killedWhile(killed(2600, { workMs: at(1000), recordMs: null }), 900), "silent");
  assert.equal(GW.killedWhile(killed(2600, { workMs: null, recordMs: null }), 900), "silent", "a turn that asked for nothing was silent");
  assert.equal(GW.killedWhile(killed(2600, { workMs: at(1000), recordMs: null }), 1700), "working", "the window is the stage's own");
  assert.equal(GW.killedWhile(killed(2600, { workMs: at(2550), recordMs: null }), undefined), "working", "120 s where a stage sets none");
  assert.equal(GW.killedWhile({ ...killed(2600, { workMs: at(2599) }), signals: { stalled: true } }, 900), null, "a stall is not a hard-wall kill");
  assert.equal(GW.killedWhile({ ...killed(2600, { workMs: at(2599) }), killed: false }, 900), null);
  assert.equal(GW.killedWhile(killed(2600, null), 900), null, "an engine that cannot say is not read as silent");
});

test("the resume message is design's, closed by the stage's own tail", () => {
  // A tool-written output closes on its record call; any other on the whole-file write.
  const recorded = GW.warmTimeoutMessage([join(ROOT, "narrative.md")]);
  assert.ok(recorded.startsWith(OPENING), recorded);
  assert.ok(recorded.endsWith(CLOSING), recorded);
  assert.match(recorded, /and then Call `record_synthesis` with the values from the work already in your context/);
  const written = GW.warmTimeoutMessage([join(ROOT, "an-invented-output.md")]);
  assert.ok(written.startsWith(OPENING) && written.endsWith(CLOSING), written);
  assert.match(written, /and then Write the COMPLETE file now at .*an-invented-output\.md with the Write tool/);
});

/** One synthesis stage through the ladder; `turns` answers each attempt in order. What each attempt was handed. */
async function ladder(tag, turns, { stallSec = 900, maxRetries = 1 } = {}) {
  const runDir = mkdtempSync(join(ROOT, `${tag}-`));
  mkdirSync(driverDir(runDir), { recursive: true });
  const out = join(runDir, "narrative.md");
  const asked = [];
  GW.registerEngine({ name: "openai-agent", async runTurn(args) {
    asked.push({ resumeRef: args.resumeRef, message: args.message, timeoutSec: args.timeoutSec });
    const turn = turns[asked.length - 1];
    if (turn.writes) writeFileSync(out, "# Narrative\n\nAn invented narrative the turn wrote.\n");
    return turn.result;
  } });
  const prev = {};
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_MAX_RETRIES: String(maxRetries), CLEAROTRON_RECOVERY_MAX: "0" })) {
    prev[k] = process.env[k]; pinEnv(process.env, k, v);
  }
  try {
    const r = await GW.runStage("synthesis", { agent: "mailagent", message: "go", model: "haiku", sessionKey: `clearance-${tag}`,
      timeoutSec: 2500, stallSec, runDir, expectFile: [out] });
    const rows = readFileSync(driverDir(runDir, "synthesis.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    return { r, asked, rows };
  } finally { for (const [k, v] of Object.entries(prev)) pinEnv(process.env, k, v); }
}
const DONE = { writes: true, result: { code: 0, killed: false, wall: 400, stdout: "", stderr: "", laneWaitMs: 0, json: { status: "ok", runId: "run" }, usage: { input_tokens: 10, output_tokens: 5 }, sessionRef: "thr-1" } };

test("a turn stopped while working is resumed in its own session, with the longer limit and design's message", async () => {
  const { r, asked, rows } = await ladder("working", [{ result: killed(2560, { workMs: 2555_000, recordMs: null }) }, DONE]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(asked.length, 2);
  assert.equal(asked[1].resumeRef, "thr-1", "the retry did not resume the killed session");
  assert.ok(asked[1].message.startsWith(OPENING), asked[1].message);
  assert.equal(asked[1].timeoutSec, 3750, "the resume did not get the single extended limit");
  assert.equal(rows[0].killedWhile, "working");
  assert.equal(rows[1].killedWhile, null, "an attempt that was not killed carries no class, and says so");
});

test("a kill that was silent, or only writing its record, is retried fresh as before", async () => {
  for (const [tag, ask] of [["silent", { workMs: 30_000, recordMs: null }], ["record-only", { workMs: 30_000, recordMs: 2550_000 }]]) {
    const { r, asked, rows } = await ladder(tag, [{ result: killed(2560, ask) }, DONE]);
    assert.equal(r.ok, true, `${tag}: ${JSON.stringify(r)}`);
    assert.equal(asked[1].resumeRef, undefined, `${tag}: the retry resumed a session it should have started fresh`);
    assert.ok(!asked[1].message.startsWith(OPENING), `${tag}: the fresh retry was handed the resume message`);
    assert.equal(asked[1].timeoutSec, 3750);
    assert.equal(rows[0].killedWhile, tag);
  }
});

test("a resume that fails falls back to a fresh session on the ladder's next rung", async () => {
  const refused = { result: { code: 1, killed: false, wall: 3, stdout: "", stderr: "no session to resume", laneWaitMs: 0, json: null, usage: null, sessionRef: null } };
  const { r, asked } = await ladder("refused", [{ result: killed(2560, { workMs: 2555_000, recordMs: null }) }, refused, DONE], { maxRetries: 2 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(asked.length, 3);
  assert.equal(asked[1].resumeRef, "thr-1");
  assert.equal(asked[2].resumeRef, undefined, "after a failed resume the ladder resumed again rather than starting fresh");
  assert.ok(!asked[2].message.startsWith(OPENING));
});

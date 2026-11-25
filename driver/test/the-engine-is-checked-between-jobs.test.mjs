// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The engine is proven between jobs (engine/health.mjs): when the worker starts, after the installed build changes,
// and when it has had no successful call for CLEAROTRON_ENGINE_CHECK_ROUTINE. A dead login raises one alert in the
// outbox and no second one until a check passes; an overload is logged and never alerted. The dead logins are the
// stand-ins in dead-login-engines.mjs, driven through the door's own judgment; nothing outside this machine is called.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseCheckInterval, routineInterval, engineCheckDue, runEngineCheck, maybeCheckEngine, recordEngineAnswered,
  lastEngineAnswer, readEngineCheck, turnAnswered, failedCheckLines, engineCheckPacketName, FAILING_RECHECK_MS, ROUTINE_SETTING,
} from "../engine/health.mjs";
import { deadLoginEngines } from "./dead-login-engines.mjs";
import { dispatchTurn } from "../ladder/dispatch.mjs";

const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
const T0 = Date.parse("2026-11-25T10:00:00Z");

/** A scratch record folder, the dead-login programs, and an outbox that keeps what is written to it. */
function bench() {
  const dir = mkdtempSync(join(tmpdir(), "engine-check-"));
  const engines = deadLoginEngines(dir);
  const sent = [], logged = [], withdrawn = [];
  return {
    dir, engines, sent, logged, withdrawn,
    write: (name, packet) => { sent.push({ name, packet }); return join(dir, `${name}.pending`); },
    withdraw: (engine) => { withdrawn.push(engine); return true; },
    log: (line) => logged.push(line),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}
const passes = async () => ({ ok: true, engine: "anthropic-agent" });
const overloaded = async () => ({ ok: false, engine: "anthropic-agent", mode: "failed", basis: "nonzero-exit", headline: "anthropic-agent ran but the turn failed (exit 1)", fix: "The engine's stderr below is the whole story." });
const noWait = async () => {};

test("the setting takes whole hours or days, or off, and nothing else", () => {
  assert.deepEqual(parseCheckInterval("12h"), { ms: 12 * HOUR });
  assert.deepEqual(parseCheckInterval("3d"), { ms: 3 * DAY });
  assert.deepEqual(parseCheckInterval("7d"), { ms: 7 * DAY });
  assert.deepEqual(parseCheckInterval("30D"), { ms: 30 * DAY });
  assert.deepEqual(parseCheckInterval("off"), { ms: null });
  for (const bad of ["7", "1w", "0d", "-1d", "1.5d", "7 d", "", "never"]) assert.equal(parseCheckInterval(bad), null, bad);
  assert.equal(routineInterval({}).ms, 7 * DAY, "unset is seven days");
  assert.deepEqual(routineInterval({ [ROUTINE_SETTING]: "1w" }), { ms: 7 * DAY, raw: "1w", invalid: true }, "a value it cannot take runs at the default, and says so");
});

test("when a check is due: a new build, the routine interval since the last answer, and an hour after a failure", () => {
  const ok = { at: new Date(T0).toISOString(), ok: true, build: "aaa" };
  assert.equal(engineCheckDue({ now: T0 + HOUR, build: "aaa", intervalMs: 7 * DAY, lastAnswer: T0, record: ok }), null);
  assert.equal(engineCheckDue({ now: T0 + HOUR, build: "bbb", intervalMs: 7 * DAY, lastAnswer: T0, record: ok }), "build");
  assert.equal(engineCheckDue({ now: T0 + 7 * DAY, build: "aaa", intervalMs: 7 * DAY, lastAnswer: T0, record: ok }), "routine");
  assert.equal(engineCheckDue({ now: T0 + 7 * DAY, build: "aaa", intervalMs: 7 * DAY, lastAnswer: T0 + 6 * DAY, record: ok }), null,
    "a stage's answer moves the clock: a busy install is never checked");
  assert.equal(engineCheckDue({ now: T0 + 30 * DAY, build: "aaa", intervalMs: null, lastAnswer: T0, record: ok }), null, "off");
  const failed = { ...ok, ok: false };
  assert.equal(engineCheckDue({ now: T0 + FAILING_RECHECK_MS - 1, build: "bbb", intervalMs: 7 * DAY, lastAnswer: T0, record: failed }), null,
    "a failing engine is not re-checked on every tick");
  assert.equal(engineCheckDue({ now: T0 + FAILING_RECHECK_MS, build: "aaa", intervalMs: 7 * DAY, lastAnswer: T0, record: failed }), "recheck");
  assert.equal(engineCheckDue({ now: T0 + 60_000, build: "aaa", intervalMs: 7 * DAY, lastAnswer: T0 + 30_000, record: failed }), "recheck",
    "a turn the engine completed since the failure says it was fixed, and the check confirms it at once");
  assert.equal(engineCheckDue({ now: T0 + 30 * DAY, build: "aaa", intervalMs: 7 * DAY, lastAnswer: null, record: null }), null,
    "an install with no record is not checked on sight");
});

for (const which of ["claude", "codex"]) {
  test(`a dead ${which} login raises one alert, and the next one only after a check has passed`, async () => {
    const b = bench();
    // The Codex adapter reads its sign-in file from this process, as the worker's does: set here, the dead login
    // is the one refused, not a machine with no sign-in at all.
    const savedAuth = process.env.CLEAROTRON_OPENAI_AUTH_FILE;
    process.env.CLEAROTRON_OPENAI_AUTH_FILE = b.engines.authFile;
    try {
      const env = b.engines[which];
      const engine = env.CLEAROTRON_AI;
      const check = (judge) => runEngineCheck({ env, reason: "routine", now: () => T0, dir: b.dir, write: b.write, withdraw: b.withdraw, log: b.log, wait: noWait, ...(judge ? { judge } : {}) });

      const first = await check();
      assert.equal(first.lane, "configuration", JSON.stringify(first.verdict));
      assert.equal(first.verdict.basis, "text-match", "refused by the engine in its own words, not missing a sign-in file");
      assert.equal(first.alerted, true);
      assert.equal(b.sent.length, 1);
      const { name, packet } = b.sent[0];
      assert.equal(name, engineCheckPacketName(engine));
      assert.equal(packet.kind, "engine-check-failed");
      assert.equal(packet.audience, "operator");
      assert.match(packet.text, new RegExp(`^The engine check failed at 2026-11-25T10:00:00Z: ${engine} is not signed in\\.\\nNo search can run until this is fixed\\.\\nTo fix it: `));
      assert.match(packet.text, /\nThen run `clearotron doctor` to confirm\.$/);
      assert.deepEqual(failedCheckLines(readEngineCheck(engine, { dir: b.dir })), packet.text.split("\n"), "status shows the alert's own lines while it stands");

      await check();
      assert.equal(b.sent.length, 1, "a second failure of the same kind is not a second alert");

      assert.deepEqual(failedCheckLines(readEngineCheck(engine, { dir: b.dir }), T0 + 1), [], "a turn completed since the failure hides it");
      assert.deepEqual(b.withdrawn, [], "nothing is withdrawn while the failure stands");
      await check(passes);
      assert.deepEqual(failedCheckLines(readEngineCheck(engine, { dir: b.dir })), [], "a passing check clears it");
      assert.deepEqual(b.withdrawn, [engine], "and takes back the alert if nothing has collected it");
      assert.ok(lastEngineAnswer(engine, { dir: b.dir }) >= T0, "and moves the clock");

      await check();
      assert.equal(b.sent.length, 2, "a failure after a pass alerts again");
    } finally {
      if (savedAuth === undefined) delete process.env.CLEAROTRON_OPENAI_AUTH_FILE; else process.env.CLEAROTRON_OPENAI_AUTH_FILE = savedAuth;
      b.done();
    }
  });
}

test("an overload is logged and never alerted: no search is stopped by it, and the run's own park recovers", async () => {
  const b = bench();
  try {
    const r = await runEngineCheck({ env: b.engines.claude, now: () => T0, dir: b.dir, write: b.write, log: b.log, judge: overloaded });
    assert.equal(r.lane, "weather");
    assert.equal(b.sent.length, 0);
    assert.match(b.logged.join("\n"), /logged, not alerted/);
    assert.deepEqual(failedCheckLines(readEngineCheck("anthropic-agent", { dir: b.dir })), []);
  } finally { b.done(); }
});

test("the worker checks on a start, after a new build and when the interval has passed, and never with no engine chosen", async () => {
  const b = bench();
  try {
    const env = { ...b.engines.claude, [ROUTINE_SETTING]: "3d" };
    const ran = [];
    const run = async ({ reason }) => { ran.push(reason); return {}; };
    const tick = (at, extra = {}) => maybeCheckEngine({ env, now: () => at, build: "aaa", dir: b.dir, run, log: b.log, ...extra });

    assert.deepEqual(await maybeCheckEngine({ env: {}, now: () => T0, dir: b.dir, run }), { due: null }, "no engine chosen");
    assert.deepEqual(await tick(T0), { due: null }, "the first look starts the clock and checks nothing");
    assert.deepEqual(await tick(T0 + DAY), { due: null });
    await tick(T0 + DAY, { starting: true });
    await tick(T0 + DAY, { build: "bbb" });
    await tick(T0 + 3 * DAY);
    assert.deepEqual(ran, ["start", "build", "routine"]);

    recordEngineAnswered("anthropic-agent", { now: T0 + 3 * DAY, dir: b.dir });
    assert.deepEqual(await tick(T0 + 5 * DAY), { due: null }, "a completed turn moves the clock");
  } finally { b.done(); }
});

test("a turn the engine completed moves the clock; a refused or stopped one does not", async () => {
  assert.equal(turnAnswered({ code: 0, killed: false, signals: {} }), true);
  assert.equal(turnAnswered({ code: 1, killed: false, signals: {} }), false);
  assert.equal(turnAnswered({ code: 137, killed: true, signals: {} }), false);
  assert.equal(turnAnswered({ code: 0, killed: false, signals: { signedOut: "run `codex login`" } }), false);
  // Through a stage's own dispatch, with an engine that answers as told, into this install's work folder.
  const work = mkdtempSync(join(tmpdir(), "engine-check-stage-"));
  const saved = process.env.CLEAROTRON_WORK_DIR;
  process.env.CLEAROTRON_WORK_DIR = work;
  try {
    const stageTurn = async (engineName, turn) => {
      const runDir = mkdtempSync(join(work, "run-"));
      const engine = { name: engineName, runTurn: async () => ({ stdout: "", stderr: "", json: null, usage: null, signals: {}, ...turn }) };
      await dispatchTurn({ name: "matter-frame", engine, agent: "a", message: "m", model: "haiku", thinking: "low", sessionKey: "k",
        stallSec: 30, files: [], maxRetries: 0, runDir, turnConfig: () => null, engineResolveSkill: () => null, engineSkillsDir: null },
      { attempt: 1, effTimeout: 60 });
    };
    await stageTurn("anthropic-agent", { code: 1, killed: false });
    assert.equal(lastEngineAnswer("anthropic-agent"), null, "a failed stage turn moved the clock");
    await stageTurn("anthropic-agent", { code: 0, killed: false });
    assert.ok(lastEngineAnswer("anthropic-agent") > 0, "a completed stage turn did not move the clock");
    assert.equal(lastEngineAnswer("openai-agent"), null, "the clock is the engine's own");
  } finally {
    if (saved === undefined) delete process.env.CLEAROTRON_WORK_DIR; else process.env.CLEAROTRON_WORK_DIR = saved;
    rmSync(work, { recursive: true, force: true });
  }
});

test("the alert lands in the outbox as one packet per engine, and a passing check takes it back", async () => {
  const b = bench();
  const outbox = join(b.dir, "outbox");
  const saved = process.env.CLEAROTRON_OUTBOX_DIR;
  process.env.CLEAROTRON_OUTBOX_DIR = outbox;
  try {
    await runEngineCheck({ env: b.engines.claude, now: () => T0, dir: b.dir, log: b.log, wait: noWait });
    assert.deepEqual(readdirSync(outbox), ["engine-check-anthropic-agent.failed.pending"]);
    const packet = JSON.parse(readFileSync(join(outbox, "engine-check-anthropic-agent.failed.pending"), "utf8"));
    assert.equal(packet.kind, "engine-check-failed");
    assert.match(packet.text, /anthropic-agent is not signed in/);
    await runEngineCheck({ env: b.engines.claude, now: () => T0 + HOUR, dir: b.dir, log: b.log, judge: passes });
    assert.deepEqual(readdirSync(outbox), [], "a fixed fault is not left waiting to be delivered");
  } finally {
    if (saved === undefined) delete process.env.CLEAROTRON_OUTBOX_DIR; else process.env.CLEAROTRON_OUTBOX_DIR = saved;
    b.done();
  }
});

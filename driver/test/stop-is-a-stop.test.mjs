// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the knockout stop path end to end: records an engine child, reads it back, and
// proves the sentinel-before-signal ordering in the real stop_run source
// — a stop is a stop.
//
// The owner pressed Stop on his own run and nothing happened: the cooperative stop closes admission and
// waits for the stage in flight, and that stage was 28 minutes into a turn with no bound on it. The
// cooperative stop is not SLOW, it is UNBOUNDED, and presenting it as the only Stop is what made the
// control feel dead.
//
// The objection to a hard stop was that it leaves a half-written artifact. Measured on his own run:
// sentinel first, then SIGTERM to the engine child, terminal in three seconds, record clean.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  recordEngineChild, clearEngineChild, readEngineChild, engineChildIsLive, engineChildPath,
} from "../engine/child-record.mjs";

const runDirFixture = () => {
  const d = mkdtempSync(join(tmpdir(), "stop-2076-"));
  mkdirSync(join(d, "_driver"), { recursive: true });
  return d;
};

test("2076 the engine child is written down, read back, and cleared when its turn ends", () => {
  const dir = runDirFixture();
  assert.equal(readEngineChild(dir), null, "a run with no turn in flight has nothing to target");

  assert.equal(recordEngineChild(dir, 4242, { starttimeOf: () => "111" }), true);
  assert.deepEqual(readEngineChild(dir), { pid: 4242, starttime: "111" });
  // ONE FORMAT, the claim sidecar's. A second spelling of "which process is this" is a second thing to
  // keep in step, and parseClaimSidecar is what reads it back.
  assert.match(readFileSync(engineChildPath(dir), "utf8"), /^4242:111\n$/);

  assert.equal(clearEngineChild(dir, 4242), true);
  assert.equal(readEngineChild(dir), null, "the record must not outlive the turn");
});

test("2076 a slow-exiting child cannot erase the record of the one that replaced it", () => {
  // Narrow race, and "narrow" is how the next reader inherits a stop that signals a process which
  // finished ten minutes ago. The clear is conditional on the record still naming this pid.
  const dir = runDirFixture();
  recordEngineChild(dir, 100, { starttimeOf: () => "aaa" });
  recordEngineChild(dir, 200, { starttimeOf: () => "bbb" });          // the turn that replaced it
  assert.equal(clearEngineChild(dir, 100), false, "the older child must not clear the newer record");
  assert.deepEqual(readEngineChild(dir), { pid: 200, starttime: "bbb" }, "…and the newer one survives");
  assert.equal(clearEngineChild(dir, 200), true, "its own child still clears it");
});

test("2076 liveness is pid AND starttime, because the thing done with the answer is a signal", () => {
  // pid reuse is the whole reason the starttime is recorded. On a box up for days a bare pid can name
  // something else entirely by the time anyone reads it — and this decides who gets SIGTERM.
  const live = { pid: 7, starttime: "s1" };
  assert.equal(engineChildIsLive(live, { starttimeOf: () => "s1" }), true, "same process");
  assert.equal(engineChildIsLive(live, { starttimeOf: () => "s2" }), false,
    "SAME PID, DIFFERENT PROCESS — this is the case that would signal a stranger");
  assert.equal(engineChildIsLive(live, { starttimeOf: () => null }), false, "gone is not live");
  // A record with no starttime is NOT VERIFIABLE, and unverifiable fails toward doing nothing.
  assert.equal(engineChildIsLive({ pid: 7, starttime: null }, { starttimeOf: () => "s1" }), false);
  assert.equal(engineChildIsLive(null), false);
  assert.equal(engineChildIsLive({ pid: 0, starttime: "s" }), false);
});

test("2076 recording is best effort and never fatal — a dispatch that cannot write it must still run", () => {
  // Failing here costs a stop that falls back to the boundary, which is the behaviour that shipped for
  // a year. Throwing here costs the run. The asymmetry decides the failure direction.
  const dir = runDirFixture();
  assert.equal(recordEngineChild(dir, 5, { write: () => { throw new Error("EROFS"); } }), false);
  assert.equal(recordEngineChild(null, 5), false, "no run dir is not an error either");
  assert.equal(recordEngineChild(dir, 0), false, "and a nonsense pid is refused rather than written");
  assert.equal(recordEngineChild(dir, -1), false);
});

test("2076 THE ORDERING: the sentinel is written before the signal, never after", () => {
  // ACCEPTANCE 3, and it is the load-bearing one. The sentinel is what makes the kill clean — the
  // gateway finds an already-recorded cancel instead of an unexplained dead child, and writes a proper
  // terminal with attribution rather than 's `state:running` orphan. Reversed, this change becomes
  // the unsafe version of itself while every other arm here still passes.
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "mcp-server", "lib", "ops.mjs"), "utf8");

  const sentinel = src.indexOf('requestCancel(run.runDir, { via: "mcp/stop_run"');
  const kill = src.indexOf('process.kill(child.pid, "SIGTERM")');
  // SELF-CONTROL. Two indexOf calls that both return -1 satisfy `-1 < -1` being false but would satisfy
  // a sloppier comparison, and an anchor that moved would make this arm pass over a file it can no
  // longer see. Both must be FOUND before their order means anything.
  assert.ok(sentinel > 0, "the cancel sentinel write must still be at this call site");
  assert.ok(kill > 0, "the immediate-mode signal must still be at this call site");
  assert.ok(sentinel < kill,
    "the sentinel must be written BEFORE the signal — reversed, a killed child is an unexplained dead "
    + "child and the run is left reading as running, which is the #1090 orphan this ordering prevents");

  // And the signal targets the RECORDED child, never a pattern match. The box carries several
  // deployments under different users; a `claude` process here can belong to another agent's work.
  assert.match(src, /readEngineChild\(run\.runDir\)/,
    "the target must come from this run's own record");
  assert.doesNotMatch(src, /pgrep|ps -u|comm==?"claude"|\bpkill\b/,
    "no process-name search may appear in the stop path");
});

test("2076 an immediate stop with nothing to end falls back to the boundary AND SAYS SO", () => {
  // Acceptance 5. Silence here would be the second silent thing on the same control: the presser asked
  // for an immediate stop, did not get one, and must not be told they did.
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "mcp-server", "lib", "ops.mjs"), "utf8");
  assert.match(src, /no engine turn is recorded for this run/, "the between-turns case is named");
  assert.match(src, /the recorded engine turn has already exited/, "the already-exited case is named");
  assert.match(src, /An immediate stop was asked for and could not be made/,
    "and the ANSWER carries it back to the presser, rather than reporting the boundary stop as if it "
    + "were what they asked for");
});

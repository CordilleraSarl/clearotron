// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The probe validated one environment and spawned with a different one.
//
// `applyEngineEnv` copies the caller's environment onto `process.env` for the duration of the turn,
// because the adapters read `process.env` rather than taking an environment. Its key list carried
// CLEAROTRON_AI and the binary paths — and neither the billing mode nor the API key. So the setup
// wizard could hand the probe a correct api-key environment, watch `resolveAuthMode` accept it, and
// then have the adapter read a `process.env` where neither had arrived. `spawnEnv` deletes the API key
// under any mode that is not api-key, the mode it read was unset, and it deleted the key the reader had
// just typed. The turn failed as "not signed in" — correctly, about an environment nobody asked for.
//
// Reported from a real WSL2 install, 2026-09-09: a valid key, the api-key lane, and a sign-in failure
// the reader could only get past by exporting the key into their own shell.
//
// THE SECOND HALF IS THE ONE THAT WOULD BE WORSE TO GET WRONG. Widening what this writes onto the
// process widens what it must take back off again: a credential surviving the probe would be a defect
// larger than the one being fixed, so the restore is driven, not assumed.
//
// OFFLINE. `runTurn` is injected throughout, so nothing here spawns a CLI or spends a turn.
import { test } from "node:test";
import assert from "node:assert/strict";

import { probeEngineTurn, classifyProbe } from "../engine/probe.mjs";

const KEY = `sk-ant-${"x".repeat(101)}`;
const apiKeyLane = () => ({
  ...process.env,
  CLEAROTRON_AI: "anthropic-agent",
  CLEAROTRON_CLAUDE_PATH: "/opt/node/v22/bin/claude",
  CLEAROTRON_AI_BILLING: "api-key",
  ANTHROPIC_API_KEY: KEY,
});
// A turn that reports what the ADAPTER would see, which is process.env — `spawnEnv(base = process.env)`.
const observingTurn = (seen, tuple = { code: 0, stdout: "ok", stderr: "", json: {}, signals: {} }) => async () => {
  seen.billing = process.env.CLEAROTRON_AI_BILLING ?? null;
  seen.key = process.env.ANTHROPIC_API_KEY ?? null;
  seen.ai = process.env.CLEAROTRON_AI ?? null;
  return tuple;
};

test("the api-key lane reaches the spawn — the mode AND the key, not just the binary", () => {
  const seen = {};
  return probeEngineTurn({ env: apiKeyLane(), runTurn: observingTurn(seen) }).then(() => {
    assert.equal(seen.ai, "anthropic-agent", "the engine id never reached the turn");
    assert.equal(seen.billing, "api-key",
      "the billing mode did not reach the turn, so spawnEnv reads an unset mode and strips the key");
    assert.equal(seen.key, KEY,
      "the API key did not reach the turn — the lane the reader proved is not the lane that ran");
  });
});

test("and the key does not survive the probe", () => {
  // The cost of widening what this writes onto the process. A credential left behind would be read by
  // every later step of the wizard, and by anything else sharing the process, having been put there by
  // a check that was only meant to borrow it.
  const before = Object.prototype.hasOwnProperty.call(process.env, "ANTHROPIC_API_KEY");
  assert.equal(before, false, "this box already exports the key, so the arm below cannot prove a restore");
  return probeEngineTurn({ env: apiKeyLane(), runTurn: observingTurn({}) }).then(() => {
    assert.equal(Object.prototype.hasOwnProperty.call(process.env, "ANTHROPIC_API_KEY"), false,
      "the probe left a credential in this process after it returned");
    assert.equal(process.env.CLEAROTRON_AI_BILLING, undefined, "and left the billing mode behind too");
  });
});

test("a failure reported on stdout carries its evidence, like one reported on stderr", () => {
  // The classification reads stderr AND stdout; the detail read stderr alone. So a CLI that prints its
  // refusal on stdout produced a verdict whose evidence was dropped — a headline with nothing under it,
  // over a heuristic that matches text broadly on purpose.
  const onStdout = classifyProbe({ engine: "anthropic-agent",
    tuple: { code: 1, stdout: "Invalid API key · Please run /login", stderr: "", json: null, signals: {} } });
  assert.equal(onStdout.mode, "signed-out");
  assert.match(onStdout.detail ?? "", /Invalid API key/, "the engine's own words were dropped");

  // stderr stays FIRST where both carry something: that is where a diagnostic belongs.
  const both = classifyProbe({ engine: "anthropic-agent",
    tuple: { code: 1, stdout: "chatter on stdout", stderr: "boom: /login required", json: null, signals: {} } });
  assert.match(both.detail ?? "", /boom/, "stderr is no longer preferred");
  assert.doesNotMatch(both.detail ?? "", /chatter/);
});

test("a verdict says HOW it was reached, so a text match is not read as a provider signal", () => {
  // The signed-out test matches broadly — bare `oauth`, a 401, `unauthorized`. That is deliberate and it
  // is why `basis` exists. A reader shown a conclusion without it cannot tell a genuinely signed-out CLI
  // from an unrelated failure whose words happened to match, which is what the raw lines are for.
  const v = classifyProbe({ engine: "anthropic-agent",
    tuple: { code: 1, stdout: "", stderr: "oauth handshake with the metrics endpoint failed", json: null, signals: {} } });
  assert.equal(v.mode, "signed-out");
  assert.equal(v.basis, "text-match", "a text match must not be reported with the confidence of a signal");
});

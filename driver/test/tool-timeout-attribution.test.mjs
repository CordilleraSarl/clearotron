// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// half 2 — A TOOL CALL THAT NEVER RETURNED IS NOT A MISSING-STRUCTURE DEFECT.
//
// The R5 round of 2026-08-12 failed `named_band_missing` four times and the handover read it as the
// model omitting required structure. It had not: it called `register_execute_plan` ONCE exactly as
// dictated, codex killed the call at its 300s default, the band was never written, and the model wrote
// an honest audit note recording the timeout and flagging CROSS-CHECK REQUIRED — the doctrine-compliant
// act, since hand-authoring the band is the forbidden one. All four attempts repeated the same
// deterministic timeout (walls 447/424/436/414s ≈ the 300s cap plus session overhead).
//
// The two causes produce IDENTICAL evidence in the run dir — md present, band absent — so no validator
// could have told them apart. The fact lived only in the MCP server process that was holding the call
// when it was killed, and that process wrote nothing. It writes a start line and a settle line now.
//
// WHAT THESE TESTS PIN, and the second is the one that keeps this honest:
//   1. a started-and-never-settled call turns the verdict into `tool_timeout`, a product fault: the step is told so
//      and is not sent back to make the call again;
//   2. NO LOG changes NOTHING. Absence is not evidence the call returned — every run without the log
//      (a replay, an archived run, a run whose servers never started) keeps the verdict it had.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { unsettledToolCalls, registerPlanCallKilled, toolCallsPath } from "../tool-calls.mjs";
import { validators } from "../verify.mjs";
import { repairTarget, warmPatchMessage, warmEligible } from "../gateway.mjs";
import { nextRung } from "../ladder/next-rung.mjs";
import { productFaultOf, productFaultReason, PRODUCT_FAULT_MESSAGE } from "../product-fault.mjs";
import { plainCause } from "../deferral-row.mjs";
import { recordUnitNote } from "../register-unit-record.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

/** A run dir shaped like the fresh-run path registerUnit gates on: instructed-scope + a register plan. */
function runWithPlan(axis = "incumbent-class") {
  const runDir = mkdtempSync(join(tmpdir(), "r793-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  mkdirSync(join(runDir, "register-units"), { recursive: true });
  writeFileSync(driverDir(runDir, "instructed-scope.json"), JSON.stringify({ marks: ["THISTLE"] }));
  writeFileSync(driverDir(runDir, "register-plan.json"), JSON.stringify({ entries: [{ axis, qid: "q1" }] }));
  const md = join(runDir, "register-units", `${axis}.md`);
  // The unit's own honest note — the artifact R5 actually produced. Deliberately NOT narrating success:
  // the point is that even a truthful .md was being read as fabrication.
  writeFileSync(md, "# incumbent-class\n\nAttempted 26 plan entries (13 owners x THISTLE cl 9/42).\n"
    + "The register_execute_plan call did not return before it was killed.\n"
    + "No register results or band blocks were hand-authored.\n\nCROSS-CHECK REQUIRED.\n");
  return { runDir, md, axis };
}

const started = (runDir, row) => appendFileSync(toolCallsPath(runDir), JSON.stringify({ ts: "2026-08-12T10:00:00Z", event: "started", ...row }) + "\n");
const settled = (runDir, row) => appendFileSync(toolCallsPath(runDir), JSON.stringify({ ts: "2026-08-12T10:05:00Z", event: "settled", ...row }) + "\n");

// ── the log reader ──────────────────────────────────────────────────────────────────────────────────

test("a started call with no settle is unsettled; a settled one is not", () => {
  const { runDir } = runWithPlan();
  started(runDir, { seq: 1, server: "euipo", tool: "register_execute_plan", axis: "primary-sweep" });
  settled(runDir, { seq: 1, server: "euipo", tool: "register_execute_plan", axis: "primary-sweep", ok: true });
  started(runDir, { seq: 2, server: "euipo", tool: "register_execute_plan", axis: "incumbent-class" });

  const open = unsettledToolCalls(runDir);
  assert.equal(open.length, 1);
  assert.equal(open[0].axis, "incumbent-class");
  // R5's exact shape: one axis wrote a 1.6 MB band and the slow one died. Same run, same model.
  assert.equal(registerPlanCallKilled(runDir, "primary-sweep"), null);
  assert.ok(registerPlanCallKilled(runDir, "incumbent-class"));
});

// A KILLED PROCESS WRITES NO EPILOGUE, which is why the pairing key matters. The counter is per process
// and a register server is spawned per stage, so two stages both produce a seq 1. Keyed on seq alone,
// the second stage's settle would close the first stage's start — a killed call silently marked
// returned, which is the exact failure this module exists to prevent, re-created inside the fix.
test("pairing is per SERVER — one stage's settle cannot close another stage's call", () => {
  const { runDir } = runWithPlan();
  started(runDir, { seq: 1, server: "euipo", tool: "register_execute_plan", axis: "incumbent-class" });
  settled(runDir, { seq: 1, server: "clarivate", tool: "register_execute_plan", axis: "primary-sweep", ok: true });
  assert.equal(unsettledToolCalls(runDir).length, 1, "different servers, same seq — not the same call");
  assert.ok(registerPlanCallKilled(runDir, "incumbent-class"));
});

test("a THROWN tool error settles — it returned an answer the model could act on", () => {
  const { runDir } = runWithPlan();
  started(runDir, { seq: 1, server: "euipo", tool: "register_execute_plan", axis: "incumbent-class" });
  settled(runDir, { seq: 1, server: "euipo", tool: "register_execute_plan", axis: "incumbent-class", ok: false });
  assert.deepEqual(unsettledToolCalls(runDir), [], "a live failure is not a timeout and must not borrow its excuse");
});

// THE HOUSE RULE, POINTED THE OTHER WAY. An absence is a finding — but a MISSING log is an absence of
// EVIDENCE, not evidence of absence, and collapsing the two would let any run without the file claim a
// timeout it never had.
test("no log is null, not an empty answer — absence of evidence is not evidence", () => {
  const { runDir } = runWithPlan();
  assert.equal(unsettledToolCalls(runDir), null, "null and [] are different facts and must stay different");
  assert.equal(registerPlanCallKilled(runDir, "incumbent-class"), null);
});

test("a torn last line costs its own row and nothing else", () => {
  const { runDir } = runWithPlan();
  started(runDir, { seq: 1, server: "euipo", tool: "register_execute_plan", axis: "incumbent-class" });
  appendFileSync(toolCallsPath(runDir), '{"event":"settled","seq":1,"server":"eui');   // killed mid-write
  assert.equal(unsettledToolCalls(runDir).length, 1, "the unreadable settle does not silently close the call");
});

// ── the verdict ─────────────────────────────────────────────────────────────────────────────────────

test("the killed call is attributed as tool_timeout, not named_band_missing", () => {
  const { runDir, md, axis } = runWithPlan();
  started(runDir, { seq: 1, server: "euipo", tool: "register_execute_plan", axis });
  const v = validators.registerUnit(md, "attempted the plan; the call did not return; nothing hand-authored");
  assert.equal(v.ok, false, "the stage still fails — the band IS absent and the unit cannot pass");
  assert.match(v.reason, /tool_timeout:register_execute_plan:incumbent-class/);
  assert.doesNotMatch(v.reason, /named_band_missing/, "the producer is not the defect here");
});

test("with no tool log the verdict is unchanged — this fix flips nothing on its own", () => {
  const { runDir, md } = runWithPlan();
  assert.equal(existsSync(toolCallsPath(runDir)), false, "no log at all — the archived/replay shape");
  const v = validators.registerUnit(md, "narrates coverage it never obtained");
  assert.equal(v.ok, false);
  assert.match(v.reason, /named_band_missing/, "the fabrication verdict stays the default");
});

test("a unit whose call RETURNED still fails as named_band_missing", () => {
  const { runDir, md, axis } = runWithPlan();
  started(runDir, { seq: 1, server: "euipo", tool: "register_execute_plan", axis });
  settled(runDir, { seq: 1, server: "euipo", tool: "register_execute_plan", axis, ok: true });
  const v = validators.registerUnit(md, "narrates coverage");
  assert.match(v.reason, /named_band_missing/,
    "the tool answered and no band exists — that IS the fabrication signature and must stay one");
});

// ── the corrective ──────────────────────────────────────────────────────────────────────────────────

test("the killed call is a product fault: no resumed repair, the ladder ends, and the gap is delivered", () => {
  const md = "/run/register-units/incumbent-class.md";
  const fail = "invalid_file:incumbent-class.md:tool_timeout:register_execute_plan:incumbent-class";
  // The band file is joined beside the unit's notes with this machine's `join`, so it is expected that way.
  assert.equal(repairTarget(fail, md), join("/run/register-units", "incumbent-class-band.json"),
    "same absent artifact, reached the other way");
  assert.equal(warmEligible(fail, { status: "ok" }), false, "no resumed session is sent back to make the call again");
  assert.deepEqual(productFaultOf({ fail, label: "register-unit:incumbent-class" }),
    { cause: "tool_timeout", tool: "register_execute_plan", axis: "incumbent-class" });
  const next = nextRung({ fail, warm: false, attempt: 1, maxRetries: 2, attemptFails: [fail], name: "register-unit:incumbent-class",
    runDir: mkdtempSync(join(tmpdir(), "r793-rung-")), warmEscalatedAt: 0, rungsRefunded: 0, timeoutRetriesUsed: 0, effTimeout: 600 });
  assert.equal(next.rung, "break", "a second attempt would make the call again");
});

// THE NOTE IS WHERE THE STEP LEARNS IT. Its note cannot be filed without a band, and the refusal it used to get said
// "the unit has not run", which sends a step that did run back to make the call again.
test("a note filed after the plan call never came back is answered with the product-fault message, and nothing else", () => {
  const { runDir, axis } = runWithPlan();
  rmSync(join(runDir, "register-units", `${axis}.md`));
  started(runDir, { seq: 1, server: "euipo", tool: "register_execute_plan", axis });
  const r = recordUnitNote(runDir, { axis, note: "The plan call did not return." });
  assert.equal(r.written, null, "nothing is filed");
  assert.equal(r.refused, null, "it is not a refusal the step corrects");
  assert.match(r.product_fault, /register_execute_plan for incumbent-class never returned/, "the cause stays in the run's record");
  assert.ok(PRODUCT_FAULT_MESSAGE.includes("product fault"), "the record rule's stop condition is in the message");
  // A missing note on that unit is the same killed call, read off the same log.
  assert.equal(productFaultOf({ fail: `missing_file:${join(runDir, "register-units", `${axis}.md`)}`, runDir, label: `register-unit:${axis}` })?.cause, "tool_timeout");
});

test("a note with no band and no killed call is still refused as an account of nothing", () => {
  const { runDir, axis } = runWithPlan();
  const r = recordUnitNote(runDir, { axis, note: "Nothing ran." });
  assert.equal(r.product_fault, undefined);
  assert.match(String(r.refused), /unit_band_unreadable/);
  assert.equal(productFaultOf({ fail: "missing_file:x.md", runDir, label: `register-unit:${axis}` }), null, "no log, no fault");
});

test("named_band_missing keeps its own corrective untouched", () => {
  const md = "/run/register-units/incumbent-class.md";
  const msg = warmPatchMessage("invalid_file:incumbent-class.md:named_band_missing", md);
  assert.match(msg, /NEVER WRITTEN/, "the fabrication branch is unchanged");
  assert.doesNotMatch(msg, /Nothing about your turn was wrong/);
});

// ── the seam the tests above cannot see ─────────────────────────────────────────────────────────────
//
// EVERY TEST ABOVE WRITES THE LOG BY HAND, so all eleven pass whether or not the servers can write it
// at all. `toolLogPath()` reads `CLEAROTRON_BAND_RUN_DIR`, and `serverEnv` sets it CONDITIONALLY —
// `if (runDir)`. A register stage that did not pass `runDir` would produce no rows, every verdict would
// stay `named_band_missing`, and this file would report eleven passes over a mechanism that never runs.
//
// That is the failure the free-tier `unconfigured-member` tests document in their own header: a stub
// that behaves as the author believed rather than as the product does. This test asks the product.
test("a register stage's server really is given the run dir the log hangs off", async () => {
  const prior = process.env.CLEAROTRON_DATABASE;
  pinEnv(process.env, "CLEAROTRON_DATABASE", "euipo");
  try {
    const { toolGroupsForStage, buildGatherMcpConfig } = await import("../engine/mcp/gather-config.mjs");
    const groups = toolGroupsForStage("register-unit:incumbent-class");
    assert.ok(groups.includes("register"), `the register unit must get the register group, got ${JSON.stringify(groups)}`);

    const cfg = buildGatherMcpConfig(groups, { sessionKey: "k", agent: "a", runDir: "/tmp/RUNDIR" });
    const servers = Object.entries(cfg?.mcpServers ?? {});
    assert.ok(servers.length, "the register unit must get at least one local server");
    for (const [id, spec] of servers) {
      assert.equal(spec?.env?.CLEAROTRON_BAND_RUN_DIR, "/tmp/RUNDIR",
        `server "${id}" got no run dir — its tool calls would be unrecordable and #793 would stay broken silently`);
    }
  } finally {
    if (prior === undefined) pinEnv(process.env, "CLEAROTRON_DATABASE", undefined);
    else pinEnv(process.env, "CLEAROTRON_DATABASE", prior);
  }
});

test("the reader's line for a slice the killed call left open says only that it was not completed", () => {
  // A start with no return shows no answer was recorded; it does not show the source timed out, and `tool_timeout` is
  // itself minted from the missing return.
  assert.equal(productFaultReason(), plainCause("unfinished"));
  assert.equal(plainCause("unfinished"), "it could not be completed this run, so it is left open here rather than reported as clean");
  assert.doesNotMatch(productFaultReason(), /timed out/);
});

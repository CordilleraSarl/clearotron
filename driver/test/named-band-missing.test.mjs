// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// PR C (2026-07-14, copper-keystone): fail-closed at the PRODUCER when a fresh-run unit writes no band.
// The HALCYON terminal: the saturation-probe unit exited ok with a success-narrating .md but NO band
// file (the model skipped its one register_execute_plan call and fabricated the narrative). The stage
// validator was lenient (band strict-checked only WHEN PRESENT), so the stage passed, the resume skipped
// it, and fan-in re-threw the identical signature — terminal after one futile park. These tests pin:
// (1) validators.registerUnit fails `named_band_missing` on a FRESH run (instructed-scope sentinel) whose
//     plan dictates entries for the axis — and stays lenient for legacy/plan-less/archived shapes;
// (2) the corrective plumbing: warm-eligible, a dedicated warm-patch message that demands the TOOL CALL
//     (never the hand-author sibling re-save), and a correctionHint naming register_execute_plan;
// (3) end-to-end: a unit that skips its band on attempt 1 is caught at the stage, healed by the retry,
//     and the run still delivers — where pre-PR it sailed to fan-in and died.
// SAFETY GUARD (2026-07-14, learned the hard way): driver.config freezes workspaceRoot AND poolRoot at
// FIRST import with PRODUCTION defaults (a platform workspace, /srv/trademark-archive). Pin BOTH to throwaway roots
// BEFORE any driver module loads — a static driver import above this line would hoist past it, so driver
// modules are imported DYNAMICALLY. (poolRoot omitted here first shipped a red CI: the heal-path e2e
// delivered to the frozen /srv pool and died EACCES, since the per-call CLEAROTRON_REPORTS_DIR below is too late.)
import { mkdtempSync as __mkdtemp } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling; the default is taken only when NO spelling holds one
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-testroot-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __mkdtemp(__join(__tmpdir(), "prelim-testpool-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
// pin the ENGINE BINARY too — the engine path is frozen at first import, and its default is the REAL
// CLI on PATH; with the mock pinned here, an early driver import
// can never reach production even by accident.
process.env.CLEAROTRON_AI ||= "anthropic-agent";
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_RECALL_TRIPWIRE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";   // inert on this branch; on the COMBINED main the truth gate must not judge hermetic mock runs against the production ledger

// dynamic driver imports — AFTER the workspace-root guard above (see SAFETY GUARD)
const { validators } = await import("../verify.mjs");
const { warmEligible, warmPatchMessage, correctionHint } = await import("../gateway.mjs");


// ── (1) the validator ────────────────────────────────────────────────────────────────────────────────

const MD_OK = "# Register unit: saturation-probe axis audit\n\nExecuted the dictated plan via the tool; counts recorded for judgment.\n";

function mkUnitDir({ sentinel = true, planEntries = [{ qid: "saturation-probe:default:x", axis: "saturation-probe" }] } = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "nbm-"));
  mkdirSync(join(runDir, "register-units"), { recursive: true });
  mkdirSync(driverDir(runDir), { recursive: true });
  if (sentinel) writeFileSync(driverDir(runDir, "instructed-scope.json"), "{}");
  if (planEntries) writeFileSync(driverDir(runDir, "register-plan.json"), JSON.stringify({ plan_version: 1, entries: planEntries }));
  const md = join(runDir, "register-units", "saturation-probe.md");
  writeFileSync(md, MD_OK);
  return { runDir, md };
}

test("validator: fresh run + plan entries + NO band → named_band_missing (the fabrication signature)", () => {
  const { md } = mkUnitDir();
  const v = validators.registerUnit(md, MD_OK);
  assert.equal(v.ok, false);
  assert.match(v.reason, /named_band_missing/);
});

test("validator: legacy replay (no instructed-scope sentinel) stays lenient — archived verdicts never flip", () => {
  const { md } = mkUnitDir({ sentinel: false });
  const v = validators.registerUnit(md, MD_OK);
  assert.equal(v.ok, true, JSON.stringify(v));
});

test("validator: plan-less resume / axis with no dictated entries stays lenient", () => {
  const noPlan = mkUnitDir({ planEntries: null });
  assert.equal(validators.registerUnit(noPlan.md, MD_OK).ok, true, "no run plan → lenient");
  const otherAxis = mkUnitDir({ planEntries: [{ qid: "primary-sweep:exact:x", axis: "primary-sweep" }] });
  assert.equal(validators.registerUnit(otherAxis.md, MD_OK).ok, true, "no entries for THIS axis → lenient");
});

test("validator: band present keeps the existing strict-when-present behaviour", () => {
  const { runDir, md } = mkUnitDir();
  writeFileSync(join(runDir, "register-units", "saturation-probe-band.json"),
    JSON.stringify([{ state: "incomplete", qid: "saturation-probe:default:x", query: "X", total_hits: 3, fetched: 0, sample: [], reason: "count-only" }]));
  assert.equal(validators.registerUnit(md, MD_OK).ok, true);
});

// ── (2) the corrective plumbing ──────────────────────────────────────────────────────────────────────

test("corrective plumbing: named_band_missing is warm-eligible and its patch message demands the TOOL CALL", () => {
  const fail = "invalid_file:saturation-probe.md:named_band_missing";
  assert.equal(warmEligible(fail, { status: "ok" }), true, "warm-eligible (session completed cleanly)");
  const msg = warmPatchMessage(fail, "/x/run/register-units/saturation-probe.md");
  assert.match(msg, /register_execute_plan/, "repair IS the tool call");
  assert.match(msg, /saturation-probe-band\.json/, "names the exact band path");
  assert.match(msg, /NEVER WRITTEN|never written/i, "states the defect");
  assert.doesNotMatch(msg, /Re-save the COMPLETE corrected JSON/, "NOT the sibling hand-author re-save message");
  const hint = correctionHint(fail);
  assert.match(hint, /register_execute_plan/, "cold-ladder hint names the tool too");
  assert.match(hint, /hand-authored band fails the stage/i, "hint forbids the hand lane");
});

// ── (3) end-to-end through the mock pipeline ─────────────────────────────────────────────────────────

const JOB = {
  id: "test-job-nbm", msgId: "<nbm@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8902", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

async function runMockPipeline(env, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "prelim-nbm-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_NO_BAND_ONCE", "MOCK_NO_BAND"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, opts);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

test("e2e: a unit that skips its band is FAILED AT THE STAGE and healed by the corrective retry — run delivers", async () => {
  const { res, events } = await runMockPipeline({ MOCK_NO_BAND_ONCE: "transliteration-numeric", CLEAROTRON_MAX_RETRIES: "1" });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  const ev = events.find((e) => e.event === "stage" && e.stage === "register-unit:transliteration-numeric");
  assert.ok(ev?.ok, "unit ultimately ok");
  assert.ok((ev.attempts ?? 1) >= 2, `caught at the producer and retried (attempts=${ev.attempts})`);
  assert.ok(existsSync(join(res.runDir, "register-units", "transliteration-numeric-band.json")), "band present after heal");
});

// ── THE SIGNATURE MOVED, AND THE SUBJECT DID NOT ───────────────────────────────
//
// This arm asserts one thing: a unit that never writes its band FAILS AT THE UNIT, where a retry can
// help, instead of sailing to fan-in and dying terminal. That still holds, and the two assertions that
// state it are unchanged.
//
// What moved is which artifact's absence names the failure. The note is a typed call now and the
// transport refuses one filed over a band that does not exist — its counts are aggregates over that
// band — so the seat cannot reach the old fabrication signature at all: "note present, band absent" is
// unreachable from the seat's side. The run fails one step EARLIER, on the note the driver could not
// render, and the reason carries the band refusal that caused it.
//
// `named_band_missing` IS NOT DEAD and must not be deleted from the vocabulary on the strength of this
// arm: it still names a band written and then lost, a torn band, and a resume that finds none. What this
// knob can no longer produce is a SEAT that skips it, which is the narrower thing.
test("e2e: a unit that NEVER writes its band fails AT THE STAGE, naming the band, never a fan-in terminal", async () => {
  // persistent MOCK_NO_BAND: even the warm-patch repair arm (which fires regardless of the retry
  // budget — the designed heal lane) cannot conjure the band → the stage must fail-close at the
  // producer with the fabrication signature, where pre-PR the run sailed to fan-in and died terminal.
  const { res, events } = await runMockPipeline({ MOCK_NO_BAND: "transliteration-numeric", CLEAROTRON_MAX_RETRIES: "0" });
  assert.equal(res.ok, false);
  const why = String(res.reason ?? res.fail ?? "");
  assert.match(why, /unit_band_unreadable/, `fails naming the BAND as the cause, not merely the absent note: ${JSON.stringify({ fail: res.fail, reason: res.reason, stage: res.failedStage })}`);
  // AND THE ABSENCE IS STILL REPORTED, so the two halves cannot drift apart into a reason that names a
  // cause for an artifact nobody said was missing.
  assert.match(why, /missing_file:.*register-units\/transliteration-numeric\.md/,
    "the absent artifact is named beside its cause");
  assert.notEqual(res.failedStage, "fan-in", "the failure is at the unit, where a retry CAN help — not the fan-in terminal");
  const ev = events.find((e) => e.event === "stage" && e.stage === "register-unit:transliteration-numeric");
  assert.equal(ev?.ok, false, "stage event records the unit failure");
});

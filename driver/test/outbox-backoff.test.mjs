// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// C5 unit tests — outbox wake-failure detection + backoff (outbox-backoff.mjs). Offline, hermetic:
// everything runs against a mkdtemp workspace/outbox; no gateway, no billable calls. The load-bearing
// invariants pinned here: (1) every observed wake-failure SHAPE classifies as failed (the old script
// treated exit-0 as success even on stopReason:"error"); (2) a not-due check means NO wake (tight-loop
// impossibility is decided here, paced by the shell's sleep); (3) delays grow exponentially and cap;
// (4) success clears the sidecar; (5) the sidecar lives where prelim-outbox.path's glob can never see
// it; (6) the rescan re-drops markers on exactly the sendPending-and-no-.sent predicate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "outbox-backoff-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", join(ROOT, "workspaces"));
pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", join(ROOT, "outbox"));
process.env.CLEAROTRON_OUTBOX_BACKOFF_BASE_SEC = "10";
process.env.CLEAROTRON_OUTBOX_BACKOFF_CAP_SEC = "40";
process.env.CLEAROTRON_OUTBOX_BACKOFF_MAX_RETRIES = "5";
process.env.CLEAROTRON_OUTBOX_GIVEUP_COOLDOWN_SEC = "3600";
process.env.CLEAROTRON_OUTBOX_NOPROGRESS_MAX = "3";
mkdirSync(process.env.CLEAROTRON_OUTBOX_DIR, { recursive: true });

const { classifyWake, checkDue, recordFailure, recordSuccess, settleWake, rescanOwedRuns,
  owedANotification, OWED_TERMINAL_STATES } = await import("../outbox-backoff.mjs");

const okEnvelope = JSON.stringify({ status: "ok", result: { stopReason: "stop", payloads: [] } });

test("classifyWake: every observed failure shape counts as FAILED; a clean turn counts as ok", () => {
  const table = [
    // [input, expected ok, expected reason] — the shapes from the 3-of-20 incident review
    [{ code: 1, stdout: okEnvelope }, false, "nonzero_exit_1"],                 // CLI error exit
    [{ code: 124, stdout: "" }, false, "nonzero_exit_124"],                     // timeout(1) SIGTERM wall
    [{ code: 137, stdout: "" }, false, "nonzero_exit_137"],                     // timeout(1) SIGKILL escalation
    [{ code: 0, stdout: "" }, false, "unparseable_json"],                       // process died silently
    [{ code: 0, stdout: "not json at all" }, false, "unparseable_json"],
    [{ code: 0, stdout: JSON.stringify({ status: "error", error: "boom" }) }, false, "status_error"],
    // THE incident class: CLI exits 0, envelope status ok, but the agent TURN errored — delivery never ran
    [{ code: 0, stdout: JSON.stringify({ status: "ok", result: { stopReason: "error" } }) }, false, "stop_reason_error"],
    [{ code: 0, stdout: okEnvelope }, true, null],
    [{ code: 0, stdout: `some stray log line\n${okEnvelope}` }, true, null],    // defensive prefix-line parse
  ];
  for (const [input, ok, reason] of table) {
    const c = classifyWake(input);
    assert.equal(c.ok, ok, `ok for ${JSON.stringify(input).slice(0, 80)}`);
    assert.equal(c.reason, reason, `reason for ${JSON.stringify(input).slice(0, 80)}`);
  }
});

test("backoff: delays grow exponentially and cap; retries count up; giveup past the bound", () => {
  const t0 = Date.parse("2026-07-12T00:00:00Z");
  assert.deepEqual(recordFailure("growth", "x", t0), { outcome: "retry", waitSec: 10, retries: 1 });
  assert.deepEqual(recordFailure("growth", "x", t0), { outcome: "retry", waitSec: 20, retries: 2 });
  assert.deepEqual(recordFailure("growth", "x", t0), { outcome: "retry", waitSec: 40, retries: 3 });
  assert.deepEqual(recordFailure("growth", "x", t0), { outcome: "retry", waitSec: 40, retries: 4 }, "capped, not 80");
  // 5th consecutive failure = the bound: hand the lane to the rescan timer with a long cooldown
  assert.deepEqual(recordFailure("growth", "x", t0), { outcome: "giveup", waitSec: 3600, retries: 5 });
});

test("due-check gate: after a failure the agent is NOT due until the window elapses (no wake attempted)", () => {
  const t0 = Date.parse("2026-07-12T00:00:00Z");
  recordFailure("gated", "stop_reason_error", t0);
  const during = checkDue("gated", t0 + 5000);
  assert.equal(during.due, false, "inside the 10s window: not due — the shell never reaches the wake");
  assert.ok(during.waitSec >= 1 && during.waitSec <= 10, `wait is the window remainder (got ${during.waitSec})`);
  const after = checkDue("gated", t0 + 11000);
  assert.equal(after.due, true, "window elapsed: due again");
});

test("success clears the sidecar: next check is due with a reset retry count", () => {
  const t0 = Date.parse("2026-07-12T00:00:00Z");
  recordFailure("healed", "x", t0);
  assert.equal(checkDue("healed", t0).due, false);
  recordSuccess("healed");
  assert.equal(existsSync(join(process.env.CLEAROTRON_OUTBOX_DIR, "backoff", "healed.json")), false, "sidecar removed");
  assert.deepEqual(checkDue("healed", t0), { due: true, retries: 0, waitSec: 0 });
});

test("settleWake: composes classification + sidecar bookkeeping", () => {
  const t0 = Date.parse("2026-07-12T00:00:00Z");
  const fail = settleWake("settled", { code: 0, stdout: JSON.stringify({ status: "ok", result: { stopReason: "error" } }) }, t0);
  assert.deepEqual(fail, { outcome: "retry", waitSec: 10, retries: 1, reason: "stop_reason_error" });
  const ok = settleWake("settled", { code: 0, stdout: okEnvelope }, t0);
  assert.deepEqual(ok, { outcome: "ok", waitSec: 0, retries: 0, reason: null });
  assert.equal(checkDue("settled", t0).due, true, "success cleared the backoff");
});

test("fail-safe: a torn sidecar reads as due (retry, never a wedged agent)", () => {
  const dir = join(process.env.CLEAROTRON_OUTBOX_DIR, "backoff");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "torn.json"), "{ definitely not js");
  assert.equal(checkDue("torn").due, true);
});

test("sidecar location is invisible to prelim-outbox.path's glob (tight-loop precondition)", () => {
  // The unit watches PathExistsGlob=…/prelim-outbox/*.pending — level-triggered. If a sidecar ever
  // matched it, every backoff write would itself re-trigger the service. Pin both halves: the unit's
  // glob shape, and that a real sidecar write leaves the watched glob unmatched.
  const unit = readFileSync(join(HERE, "..", "systemd", "prelim-outbox.path"), "utf8");
  const glob = unit.match(/^PathExistsGlob=(.+)$/m)?.[1];
  assert.ok(glob?.endsWith("/prelim-outbox/*.pending"), `glob is the flat *.pending watch (got ${glob})`);
  for (const f of nonEmpty(readdirSync(process.env.CLEAROTRON_OUTBOX_DIR), "readdirSync(process.env.CLEAROTRON_OUTBOX_DIR)")) {
    if (f.endsWith(".pending")) continue;   // real markers are allowed to match, nothing else is
    assert.equal(f, "backoff", `only the backoff/ subdir lives beside markers (found ${f})`);
    assert.ok(statSync(join(process.env.CLEAROTRON_OUTBOX_DIR, f)).isDirectory());
  }
  // `*` never crosses `/`: no sidecar path can match the flat glob
  for (const f of nonEmpty(readdirSync(join(process.env.CLEAROTRON_OUTBOX_DIR, "backoff")), "readdirSync(join(process.env.CLEAROTRON_OUTBOX_DIR, \"backof...")) {
    assert.ok(f.endsWith(".json"), `sidecars are <agent>.json, never *.pending (found ${f})`);
  }
});

// ── rescan ─────────────────────────────────────────────────────────────────────────────────────────

function makeRun({ agent = "clawdi", slug, leaf, archived = false, sendPending, withSent = false, runId = null, codename = null, state}) {
  const studio = join(process.env.CLEAROTRON_WORK_DIR, `workspace-${agent}`, "studio", "prelim-search");
  const runDir = archived ? join(studio, "archive", "2026-07", slug, leaf) : join(studio, slug, leaf);
  mkdirSync(runDir, { recursive: true });
  // codename defaults to the leaf (fixture shorthand); the runId-form tests pass the REAL bare codename
  // so the legacy dateless `<slug>-<codename>` form genuinely differs from the dated canonical id.
  const status = { runId: runId ?? `${slug}-${leaf}`, slug, codename: codename ?? leaf, agent,
    // — the terminal state is a PARAMETER now. It was hardcoded `delivered`, which is why every
    // arm in this file agreed with a predicate that had no rule about failed runs at all.
    ...(state === null ? {} : { state: state ?? "delivered" }) };
  if (sendPending !== undefined) status.sendPending = sendPending;
  writeFileSync(join(runDir, "status.json"), JSON.stringify(status));
  if (withSent) writeFileSync(join(runDir, ".sent"), JSON.stringify({ sentAt: "2026-07-11T06:00:00Z" }));
  return runDir;
}

test("rescan re-drops markers on exactly the sendPending-and-no-.sent predicate (live + archive)", () => {
  const outbox = process.env.CLEAROTRON_OUTBOX_DIR;
  for (const f of nonEmpty(readdirSync(outbox), "readdirSync(outbox)")) if (f.endsWith(".pending")) rmSync(join(outbox, f));
  makeRun({ slug: "owed-live", leaf: "2026-07-11-alpha", sendPending: true });                       // → marker
  makeRun({ agent: "agent-a", slug: "owed-arch", leaf: "2026-07-10-bravo", archived: true, sendPending: true }); // → marker
  makeRun({ slug: "settled", leaf: "2026-07-11-charlie", sendPending: false });                      // no
  makeRun({ slug: "sent-already", leaf: "2026-07-11-delta", sendPending: true, withSent: true });    // no — .sent wins
  makeRun({ slug: "legacy-stage", leaf: "2026-07-11-echo" });                                        // no — no sendPending field
  makeRun({ slug: "bad-agent", leaf: "2026-07-11-foxtrot", sendPending: true, agent: "x y; rm -rf" }); // no — unsafe agent line

  const dropped = rescanOwedRuns();
  assert.deepEqual(dropped.map((d) => d.runId).sort(), ["owed-arch-2026-07-10-bravo", "owed-live-2026-07-11-alpha"]);
  assert.equal(readFileSync(join(outbox, "owed-live-2026-07-11-alpha.pending"), "utf8"), "clawdi\n");
  assert.equal(readFileSync(join(outbox, "owed-arch-2026-07-10-bravo.pending"), "utf8"), "agent-a\n");
  const markers = readdirSync(outbox).filter((f) => f.endsWith(".pending"));
  assert.equal(markers.length, 2, `no marker for settled/sent/legacy/unsafe runs (got ${markers.join(", ")})`);

  // idempotent: a second rescan neither duplicates nor rewrites existing markers (inotify churn)
  writeFileSync(join(outbox, "owed-live-2026-07-11-alpha.pending"), "clawdi\nkeep-me\n");
  assert.deepEqual(rescanOwedRuns(), []);
  assert.equal(readFileSync(join(outbox, "owed-live-2026-07-11-alpha.pending"), "utf8"), "clawdi\nkeep-me\n");
});

// ── no-progress circuit-breaker ──────────────────────────────────────────────────────────────────────
// The gap the 2026-07 runaway spend fell through: those wakes all returned status ok (mark_sent →
// alreadySent:true reads as "consuming"), so classifyWake never faulted and the level-triggered .path
// re-fired ~400×/day. Progress — the marker actually leaving the outbox — is the real signal.

test("no-progress breaker: ok-but-unconsumed wakes strike a marker, then quarantine it into the audit log (no packet pushed to the requester outbox)", () => {
  const outbox = process.env.CLEAROTRON_OUTBOX_DIR;
  for (const f of nonEmpty(readdirSync(outbox), "readdirSync(outbox)")) if (f.endsWith(".pending")) rmSync(join(outbox, f));
  rmSync(join(outbox, "quarantine"), { recursive: true, force: true });
  const okEnv = JSON.stringify({ status: "ok", result: { stopReason: "stop" } });
  const marker = "loopy-2026-07-23-x.pending";
  writeFileSync(join(outbox, marker), "loopy\n");
  const sidecar = () => JSON.parse(readFileSync(join(outbox, "backoff", "loopy.json"), "utf8"));

  // strikes 1, 2 — retained + paced, not yet quarantined (NOPROGRESS_MAX=3)
  assert.equal(settleWake("loopy", { code: 0, stdout: okEnv }).outcome, "stuck");
  assert.equal(sidecar().markerStrikes[marker], 1, "an ok wake that left the marker behind strikes it");
  assert.equal(settleWake("loopy", { code: 0, stdout: okEnv }).outcome, "stuck");
  assert.equal(sidecar().markerStrikes[marker], 2);
  assert.ok(existsSync(join(outbox, marker)), "still live before the threshold");

  // strike 3 — threshold: quarantined + recorded in the audit log
  const q = settleWake("loopy", { code: 0, stdout: okEnv });
  assert.equal(q.outcome, "quarantine");
  assert.deepEqual(q.quarantined, [marker]);
  assert.ok(!existsSync(join(outbox, marker)), "marker moved out of the flat *.pending glob — the re-fire loop ends");
  assert.ok(existsSync(join(outbox, "quarantine", marker)), "payload preserved in quarantine/");
  const audit = readFileSync(join(outbox, "quarantine", "STUCK-ALERTS.jsonl"), "utf8");
  assert.match(audit, /"marker":"loopy-2026-07-23-x\.pending"/);
  assert.match(audit, /"recover":/, "the audit record carries the manual-recovery step");

  // INTEGRATOR-AGNOSTIC: nothing is pushed back into the delivery outbox (that's the requester's channel,
  // and 'who is the operator' is integrator config the engine can't know) — only the audit log records it.
  assert.deepEqual(readdirSync(outbox).filter((f) => f.endsWith(".pending")), [],
    "no alert packet pushed into the outbox — operators read the audit record / MCP surface");
});

test("no-progress breaker: a CONSUMED marker is clean success — no strike, sidecar cleared", () => {
  const outbox = process.env.CLEAROTRON_OUTBOX_DIR;
  for (const f of nonEmpty(readdirSync(outbox), "readdirSync(outbox)")) if (f.endsWith(".pending")) rmSync(join(outbox, f));
  const okEnv = JSON.stringify({ status: "ok", result: { stopReason: "stop" } });
  writeFileSync(join(outbox, "consumed.pending"), "worker\n");
  // one strike recorded...
  assert.equal(settleWake("worker", { code: 0, stdout: okEnv }).outcome, "stuck");
  // ...then the courier consumes it (marker gone) → the next settle is a clean success
  rmSync(join(outbox, "consumed.pending"));
  assert.deepEqual(settleWake("worker", { code: 0, stdout: okEnv }), { outcome: "ok", waitSec: 0, retries: 0, reason: null });
  assert.equal(existsSync(join(outbox, "backoff", "worker.json")), false, "sidecar cleared on real progress");
});

test("no-progress breaker: a delivered marker whose run is already .sent is SILENTLY cleared — no strike, no false alarm (the AXIS orphan)", () => {
  const outbox = process.env.CLEAROTRON_OUTBOX_DIR;
  for (const f of nonEmpty(readdirSync(outbox), "readdirSync(outbox)")) if (f.endsWith(".pending")) rmSync(join(outbox, f));
  rmSync(join(outbox, "quarantine"), { recursive: true, force: true });
  // a delivered run that IS .sent (mark_sent already ran) but left a stray marker behind — the exact
  // "sent:true, sendPending:false, marker resurfacing" shape the user reported for Axis Workflow.
  makeRun({ slug: "delivered-ok", leaf: "2026-07-23-yankee", sendPending: false, withSent: true });
  const runId = "delivered-ok-2026-07-23-yankee";
  writeFileSync(join(outbox, `${runId}.pending`), "clawdi\n");
  const okEnv = JSON.stringify({ status: "ok", result: { stopReason: "stop" } });

  const r = settleWake("clawdi", { code: 0, stdout: okEnv });
  assert.equal(r.outcome, "ok", "a successful-delivery orphan is progress, not a stuck marker");
  assert.equal(r.silentCleared, 1);
  assert.ok(!existsSync(join(outbox, `${runId}.pending`)), "the stray marker is cleared, like mark_sent's idempotent path");
  assert.equal(existsSync(join(outbox, "quarantine", `${runId}.pending`)), false, "NOT quarantined — the delivery succeeded");
  assert.equal(readdirSync(outbox).filter((f) => f.includes("delivery-stuck")).length, 0, "no false 'could not be sent' alert on a send that happened");
  assert.equal(existsSync(join(outbox, "backoff", "clawdi.json")), false, "no strike sidecar");
});

// ── ONE canonical runId form (charter P1 §3, 2026-07-30) ───────────────────────────────────────────
// One delivery wrote a dateless AND a dated marker two minutes apart (the 2026-07-19 runId-form split
// recurring): the pipeline minted `<slug>-<codename>.pending` while the rescan re-dropped from the dated
// status.runId. Minting is now canonical (dated, everywhere) — and the DEFENCE below pins that the rescan
// dedupe and the .sent orphan guard both honour the legacy dateless form for markers already on disk.

test("rescan does not drop a dated sibling while a LEGACY dateless marker for the same run is live", () => {
  const outbox = process.env.CLEAROTRON_OUTBOX_DIR;
  for (const f of readdirSync(outbox)) if (f.endsWith(".pending")) rmSync(join(outbox, f));
  makeRun({ slug: "legacy-live", leaf: "2026-07-24-alpha", codename: "alpha", sendPending: true,
    runId: "legacy-live-2026-07-24-alpha" });
  writeFileSync(join(outbox, "legacy-live-alpha.pending"), "clawdi\n");   // the pre-fix (dateless) marker, still queued
  const dropped = rescanOwedRuns();
  assert.ok(!dropped.some((d) => d.runId.startsWith("legacy-live")), "the run is already queued under its legacy name");
  assert.ok(!existsSync(join(outbox, "legacy-live-2026-07-24-alpha.pending")),
    "no dated sibling minted beside the live dateless marker — the two-markers-per-delivery split is over");
  rmSync(join(outbox, "legacy-live-alpha.pending"));
});

test("the .sent orphan guard matches the LEGACY dateless marker form (historical markers still clear silently)", () => {
  const outbox = process.env.CLEAROTRON_OUTBOX_DIR;
  for (const f of readdirSync(outbox)) if (f.endsWith(".pending")) rmSync(join(outbox, f));
  rmSync(join(outbox, "quarantine"), { recursive: true, force: true });
  makeRun({ slug: "legacy-sent", leaf: "2026-07-24-bravo", codename: "bravo", sendPending: false, withSent: true,
    runId: "legacy-sent-2026-07-24-bravo" });
  writeFileSync(join(outbox, "legacy-sent-bravo.pending"), "clawdi\n");   // pre-fix marker orphaned by a completed send
  const okEnv = JSON.stringify({ status: "ok", result: { stopReason: "stop" } });
  const r = settleWake("clawdi", { code: 0, stdout: okEnv });
  assert.equal(r.outcome, "ok", "a successful-delivery orphan is progress under EITHER runId form");
  assert.equal(r.silentCleared, 1);
  assert.ok(!existsSync(join(outbox, "legacy-sent-bravo.pending")), "the legacy-form orphan is cleared, never struck/quarantined");
});

test("rescan does NOT resurrect a quarantined delivery (else the circuit-breaker would loop)", () => {
  const outbox = process.env.CLEAROTRON_OUTBOX_DIR;
  for (const f of readdirSync(outbox)) if (f.endsWith(".pending")) rmSync(join(outbox, f));
  makeRun({ slug: "quar-owed", leaf: "2026-07-23-zulu", sendPending: true });   // would normally be re-dropped
  const runId = "quar-owed-2026-07-23-zulu";
  mkdirSync(join(outbox, "quarantine"), { recursive: true });
  writeFileSync(join(outbox, "quarantine", `${runId}.pending`), "clawdi\n");     // already set aside
  const dropped = rescanOwedRuns();
  assert.ok(!dropped.some((d) => d.runId === runId), "rescan skips the quarantined runId");
  assert.ok(!existsSync(join(outbox, `${runId}.pending`)), "no live marker re-created");
});

test.after(() => { try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best-effort */ } });

// ── — WHAT A RUN OWES, AFTER TWO RULINGS THAT LOOK LIKE A REVERSAL AND ARE NOT ──────────────
//
// `sendPending` was RIGHT here by accident: written on the delivery paths only, so failed runs were
// skipped because nobody set their flag rather than because this sweep had a rule about them. Measured:
// 25 of 25 delivered runs carry it, 0 of 29 failed/parked/cancelled.
//
// Owner ruling, 2026-08-22: "clean up the failed runs. they owe the client nothing." → a `delivered`
// filter here, and the failure packets already in the outbox disposed of on the box.
//
// Owner ruling, 2026-08-24: failed runs' notification packets get the same re-drop cover as delivered
// ones. → this arm, inverted.
//
// THE SECOND DID NOT OVERTURN THE FIRST, and an arm reading as a straight reversal would teach the next
// person otherwise. A failed run owes the CLIENT no report — `scripts/e2e.mjs`'s delivery assertion is
// still scoped by terminal state and is untouched here. It owes the REQUESTER the news that it failed,
// and the product writes that packet on purpose (`driver/runner.mjs` sets `sendPending` on the pre-run
// and self-resume failure paths). Different recipients; one question that only looked singular.
test("#1561 a failed, parked or cancelled run IS owed its notification, on the same cover as a delivered one", () => {
  const outbox = process.env.CLEAROTRON_OUTBOX_DIR;
  for (const f of readdirSync(outbox)) if (f.endsWith(".pending")) rmSync(join(outbox, f));
  makeRun({ slug: "owed", leaf: "2026-07-11-alpha", sendPending: true });
  for (const st of ["failed", "parked", "cancelled"])
    makeRun({ slug: `owed-${st}`, leaf: `2026-07-11-${st}`, sendPending: true, state: st });

  // Asserted as a PROPERTY of this test's own runs, not as the whole list: earlier tests in this file
  // leave their run dirs on disk, so the sweep legitimately re-drops for those too. Pinning the global
  // list would make this arm a hostage to test order and would fail for a reason that is not the defect.
  const dropped = rescanOwedRuns().map((d) => d.runId);
  assert.ok(dropped.includes("owed-2026-07-11-alpha"), "the delivered run is owed and still gets one");
  for (const st of ["failed", "parked", "cancelled"])
    assert.ok(dropped.some((id) => id.includes(`owed-${st}`)),
      `a ${st} run was NOT re-dropped a marker — its notification has no retry cover, which is the defect `
      + "#1561 measured: 220 failure packets in the outbox against 110 ordinary ones, none of them covered");
});

test("#1561 a run that has NOT finished is not owed anything yet", () => {
  // Neither earlier version of this predicate excluded a non-terminal state: the first admitted anything
  // carrying the flag, the second admitted only `delivered`. A marker for a run still in flight is
  // premature, and a run mid-flight is the state a careless write is most likely to leave the flag on.
  assert.equal(owedANotification({ sendPending: true, state: "running" }), false);
  assert.equal(owedANotification({ sendPending: true, state: "queued" }), false);
  for (const st of [...OWED_TERMINAL_STATES])
    assert.equal(owedANotification({ sendPending: true, state: st }), true, `${st} is owed`);
  // Case and whitespace come off status files written by several producers over two years.
  assert.equal(owedANotification({ sendPending: true, state: " Failed " }), true);
  // The flag still gates everything: a terminal state alone owes nothing.
  for (const st of [...OWED_TERMINAL_STATES])
    assert.equal(owedANotification({ state: st }), false, `${st} with no sendPending must owe nothing`);
  assert.equal(owedANotification({ sendPending: false, state: "failed" }), false);
  assert.equal(owedANotification(null), false, "a status that could not be read owes nothing, and does not throw");
});

test("#1561 a status with NO state is still swept — absence is not evidence a run failed", () => {
  // This sweep exists to catch markers that were LOST. A missing state must not become a silent
  // exemption, or the belt-and-braces stops covering exactly the runs it was built for.
  const outbox = process.env.CLEAROTRON_OUTBOX_DIR;
  for (const f of readdirSync(outbox)) if (f.endsWith(".pending")) rmSync(join(outbox, f));
  makeRun({ slug: "stateless", leaf: "2026-07-11-golf", sendPending: true, state: null });
  assert.ok(rescanOwedRuns().map((d) => d.runId).includes("stateless-2026-07-11-golf"),
    "no state is not a scope-out — this sweep exists to catch markers that were lost");
});

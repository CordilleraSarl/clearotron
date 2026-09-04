// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// deliver-trigger.sh end-to-end against a MOCK openclaw (hermetic; no billable calls, no production
// paths). Drives the real script under bash with PATH-shimmed openclaw + a tmp outbox and pins the
// v2+C5 contract the shell owns:
//   v2 (packet contract): the trigger NEVER deletes events — consumption belongs to the courier's
//   mark_sent/ack_event (simulated here by the "ok-consume" mock mode). A successful wake with no
//   consumption RETAINS the events (drain-wait expires; the .path re-fire is the retry).
//   C5 (wake-failure backoff): a FAILED wake (incl. the incident class — CLI exit 0, envelope ok,
//   result.stopReason "error") retains events + records a backoff sidecar; a re-fire inside the window
//   attempts NO wake (tight-loop impossibility); after the window the wake retries; a successful+
//   consumed retry clears events AND sidecar. The rescan step manufactures markers for owed runs.
//   Markers naming no routable agent are QUARANTINED (payload kept, outside the .path glob), never
//   deleted and never retained in place. Plus the syntax gates: bash -n always, shellcheck advisory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DEPLOYMENT_SHELL, NO_DEPLOYMENT_SHELL_WHY } from "./platform-caps.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRIGGER = join(HERE, "..", "deliver-trigger.sh");

// ── WHERE THIS SCRIPT CAN BE DRIVEN, AND WHERE IT ONLY LOOKS LIKE IT CAN ────────────────────
//
// Everything below spawns the REAL deliver-trigger.sh. That needs two things a stock macOS does not
// have: bash >= 4 for `declare -A`, and timeout(1) for the wall around every wake. On the first macOS
// CI run five of these failed identically — `0 !== 1`, "one wake", in under 80ms each. That reads like
// a slow-runner race and is not one: the runner never got as far as being slow. The trigger resolved
// no wall, bash answered 127, `set -u` without `set -e` carried the script to a clean exit 0, and the
// mock openclaw was never invoked at all. Reproduced on Linux by removing exactly that one fact from
// PATH, which produced the same 0/1 and the same clean exit.
//
// THE SIXTH TEST IS WHY THIS GATES THE WHOLE GROUP rather than the five that went red. "marker naming
// no routable agent is QUARANTINED without any wake" asserts `calls().length === 0`, and it PASSED on
// macOS — for the one reason that makes a pass worthless, which is that nothing there could have woken
// anything. A green that a broken platform hands you for free is the absence-read-as-a-pass this
// codebase keeps being bitten by, and it is more dangerous than the five reds beside it.
//
// The skip is a STATED one, not a platform check that quietly returns: the reason names what went
// unverified and points at the README sentence that now scopes the claim.
const SHELL_GATE = DEPLOYMENT_SHELL.ok ? {} : { skip: NO_DEPLOYMENT_SHELL_WHY };

test("deliver-trigger.sh parses (bash -n)", () => {
  const r = spawnSync("bash", ["-n", TRIGGER], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("deliver-trigger.sh passes shellcheck (skipped when shellcheck is not installed)", (t) => {
  const probe = spawnSync("shellcheck", ["--version"], { encoding: "utf8" });
  if (probe.error) return t.skip("shellcheck not installed here — CI runs it");
  const r = spawnSync("shellcheck", [TRIGGER], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout || r.stderr);
});

// ── harness ────────────────────────────────────────────────────────────────────────────────────────

function makeHarness() {
  const root = mkdtempSync(join(tmpdir(), "deliver-trigger-"));
  const bin = join(root, "bin");
  const outbox = join(root, "outbox");
  const workspaces = join(root, "workspaces");
  mkdirSync(bin, { recursive: true });
  mkdirSync(outbox, { recursive: true });
  mkdirSync(workspaces, { recursive: true });
  // Mock openclaw: logs every invocation, answers per the MODE file. "ok-consume" additionally deletes
  // the pending events — the courier's mark_sent/ack_event, which is the ONLY legitimate consumer.
  writeFileSync(join(bin, "openclaw"), `#!/bin/bash
echo "$@" >> "${root}/calls.log"
case "$(cat "${root}/mode" 2>/dev/null)" in
  turn-error) echo '{"status":"ok","result":{"stopReason":"error"}}' ;;
  garbage)    echo 'not json' ;;
  ok-consume) rm -f "${outbox}"/*.pending; echo '{"status":"ok","result":{"stopReason":"stop","payloads":[]}}' ;;
  clawdi-only) for f in "${outbox}"/*.pending; do [ -e "$f" ] || continue; [ "$(head -n1 "$f" | tr -d '[:space:]')" = clawdi ] && rm -f "$f"; done
              echo '{"status":"ok","result":{"stopReason":"stop","payloads":[]}}' ;;
  *)          echo '{"status":"ok","result":{"stopReason":"stop","payloads":[]}}' ;;
esac
exit 0
`);
  chmodSync(join(bin, "openclaw"), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CLEAROTRON_OUTBOX_DIR: outbox,
    CLEAROTRON_WORK_DIR: workspaces,
    CLEAROTRON_OUTBOX_DRAIN_WAIT: "0",           // no post-wake drain poll in tests — retention is asserted directly
    // — A WINDOW WIDE ENOUGH THAT NO BOX CAN OUTRUN IT. These were 2 and 4: a real two-second
    // wall clock the test did not control, so the in-window leg measured how busy the runner was. Under
    // full-suite load the gap between two spawnSync calls exceeded it, the due-check correctly said DUE,
    // a second wake fired, and the arm read `actual: 2` — an EXTRA wake, which is the signature of a
    // window that closed rather than of a broken due-check.
    //
    // BOTH knobs, and the cap is the one that matters. `recordFailure` computes
    // `min(baseSec * 2 ** (retries - 1), capSec)`, so raising the base alone would have left the delay
    // clamped at the 4s cap — a wider wall clock, and still a wall clock.
    CLEAROTRON_OUTBOX_BACKOFF_BASE_SEC: "600",
    CLEAROTRON_OUTBOX_BACKOFF_CAP_SEC: "3600",
    CLEAROTRON_OUTBOX_BACKOFF_MAX_RETRIES: "5",
    CLEAROTRON_OUTBOX_MAX_SLEEP_SEC: "0",        // never sleep in tests — the sleep is only re-fire pacing
  };
  return {
    root, outbox, workspaces, env,
    setMode(m) { writeFileSync(join(root, "mode"), m); },
    calls() { try { return readFileSync(join(root, "calls.log"), "utf8").trim().split("\n").filter(Boolean); } catch { return []; } },
    markers() { return readdirSync(outbox).filter((f) => f.endsWith(".pending")).sort(); },
    quarantined() { try { return readdirSync(join(outbox, "quarantine")).sort(); } catch { return []; } },
    sidecar(agent) { try { return JSON.parse(readFileSync(join(outbox, "backoff", `${agent}.json`), "utf8")); } catch { return null; } },
    // — make the backoff window ELAPSE by writing, not by waiting. `checkDue` reads exactly one
    // field, `Date.parse(sc.nextDueAt) - now`, so rewinding that field is the whole of "the window has
    // passed". Deliberately NOT wrapped in try/catch: if there is no sidecar to expire, the leg that
    // follows is testing nothing and must say so loudly rather than sleep through it.
    expireBackoff(agent) {
      const p = join(outbox, "backoff", `${agent}.json`);
      const sc = JSON.parse(readFileSync(p, "utf8"));
      sc.nextDueAt = new Date(Date.now() - 60_000).toISOString();
      writeFileSync(p, JSON.stringify(sc));
      return sc;
    },
    run() {
      const r = spawnSync("bash", [TRIGGER], { encoding: "utf8", env: this.env });
      assert.equal(r.status, 0, `script always exits 0 (stderr: ${r.stderr})`);
      return r;
    },
  };
}

test("successful wake + courier consumption: agent woken once, events consumed, no backoff sidecar", SHELL_GATE, () => {
  const h = makeHarness();
  h.setMode("ok-consume");
  writeFileSync(join(h.outbox, "run-a.pending"), "clawdi\n");
  h.run();
  assert.equal(h.calls().length, 1, "one wake");
  assert.match(h.calls()[0], /--agent clawdi .*--json/, "woke the marker's agent under --json");
  assert.deepEqual(h.markers(), [], "events consumed by the courier (mark_sent/ack_event)");
  assert.equal(h.sidecar("clawdi"), null, "no sidecar on success");
});

test("successful wake WITHOUT consumption: events RETAINED + a no-progress strike is recorded (circuit-breaker arming)", SHELL_GATE, () => {
  const h = makeHarness();
  h.setMode("ok");
  writeFileSync(join(h.outbox, "run-r.pending"), "clawdi\n");
  h.run();
  assert.equal(h.calls().length, 1, "one wake");
  assert.deepEqual(h.markers(), ["run-r.pending"], "turn ok is NOT consumption — payload survives an idle courier (trigger never deletes)");
  const sc = h.sidecar("clawdi");
  assert.equal(sc?.markerStrikes?.["run-r.pending"], 1,
    "an ok-but-unconsumed wake now STRIKES the marker (the old behaviour — no sidecar at all — is exactly the loophole the runaway spend fell through)");
});

test("no-progress circuit-breaker: an ok wake that never consumes is quarantined into the audit log (the runaway-spend stop) — nothing pushed to the requester outbox", SHELL_GATE, () => {
  const h = makeHarness();
  h.env.CLEAROTRON_OUTBOX_NOPROGRESS_MAX = "1";   // trip on the first unconsumed wake for a deterministic e2e
  h.setMode("ok");                            // turn succeeds but consumes nothing — the exact 2026-07 class
  writeFileSync(join(h.outbox, "stuck-run.pending"), "clawdi\n");
  h.run();
  assert.equal(h.calls().length, 1, "one wake attempted");
  assert.deepEqual(h.markers(), [], "the stuck marker no longer matches the .path glob AND no alert packet is pushed back in");
  assert.ok(h.quarantined().includes("stuck-run.pending"), "payload preserved (moved, never deleted) in outbox/quarantine/");
  assert.ok(h.quarantined().includes("STUCK-ALERTS.jsonl"), "recorded in the integrator-agnostic audit log");
});

test("failed wake (stopReason error, exit 0) → retained events + sidecar; in-window re-fire wakes NOBODY; post-window retry succeeds and clears all", SHELL_GATE, () => {
  const h = makeHarness();
  h.setMode("turn-error");
  writeFileSync(join(h.outbox, "run-b.pending"), "clawdi\n");

  h.run();   // fire 1: wake attempted, turn errored
  assert.equal(h.calls().length, 1);
  assert.deepEqual(h.markers(), ["run-b.pending"], "events RETAINED on wake failure");
  assert.equal(h.sidecar("clawdi")?.retries, 1, "backoff sidecar recorded");

  h.run();   // fire 2, inside the 2s window (the .path re-fire): due-check false ⇒ no wake attempted
  assert.equal(h.calls().length, 1, "tight-loop impossibility: in-window fire attempts NO wake");
  assert.deepEqual(h.markers(), ["run-b.pending"], "events still retained");

  // — the window elapses because the sidecar says so, not because 2.1 real seconds passed. The
  // old sleep made this leg cost real time AND made the leg above a race against the same clock.
  h.expireBackoff("clawdi");
  h.setMode("ok-consume");
  h.run();   // fire 3: due again — retry, this time the turn succeeds and the courier consumes
  assert.equal(h.calls().length, 2, "post-window fire retries the wake");
  assert.deepEqual(h.markers(), [], "events consumed on the successful retry");
  assert.equal(h.sidecar("clawdi"), null, "sidecar cleared on success");
});

test("rescan manufactures a marker for an owed run and the same activation delivers it", SHELL_GATE, () => {
  const h = makeHarness();
  h.setMode("ok-consume");
  const runDir = join(h.workspaces, "workspace-clawdi", "studio", "prelim-search", "owed-slug", "2026-07-11-alpha");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "status.json"), JSON.stringify({
    runId: "owed-slug-2026-07-11-alpha", slug: "owed-slug", agent: "clawdi", state: "delivered", sendPending: true,
  }));
  h.run();   // no pre-existing marker: the rescan step drops one, then the wake processes it
  assert.equal(h.calls().length, 1, "the timer-cadence fire wakes the agent for the owed run");
  assert.deepEqual(h.markers(), [], "manufactured marker consumed by the woken courier");
});

// ── — the drain block has to survive its own zero ──────────────────────────────────────────────
//
// CLEAROTRON_OUTBOX_DRAIN_WAIT defaults to 180, so on a normal host the drain loop always runs at least
// once. 0 is what an operator sets to make delivery synchronous — on a test box, in a reproduction, or
// while already chasing a delivery that is late. `remaining` was assigned ONLY inside that loop body,
// which 0 executes zero times, so the post-loop `${#remaining[@]}` read an unset array: under `set -u`
// the echo never runs and "remaining: unbound variable" goes to stderr in its place, so the operator
// gets a shell error about a variable they never set instead of the pending count. On bash 5.2 the
// script carries on to exit 0 (an unset SCALAR aborts; an unset array length does not), which is why
// every existing arm here — the harness has always set DRAIN_WAIT=0 — passed straight over it.
//
// Both arms assert the REPORTED OUTCOME, not merely a clean stderr. Initialising `remaining=()` before
// the loop would silence the shell error while announcing "0 event(s) still pending" over a populated
// outbox — the same wrong answer in a quieter voice.
test("#830 DRAIN_WAIT=0 and the courier consumed everything: the drain is reported, not an unbound-variable error", SHELL_GATE, () => {
  const h = makeHarness();
  assert.equal(h.env.CLEAROTRON_OUTBOX_DRAIN_WAIT, "0", "this arm is about the zero — the harness must be setting it");
  h.setMode("ok-consume");
  writeFileSync(join(h.outbox, "run-z.pending"), "clawdi\n");
  const r = h.run();
  assert.doesNotMatch(r.stderr, /unbound variable/, `set -u tripped inside the drain block:\n${r.stderr}`);
  assert.match(r.stdout, /prelim-outbox: drained/, "the drain outcome reaches the journal");
});

test("#830 DRAIN_WAIT=0 with an event left behind: the retained COUNT is reported", SHELL_GATE, () => {
  const h = makeHarness();
  h.setMode("clawdi-only");   // clawdi's wake settles ok (woke_ok=1); otherbot's marker is left pending
  writeFileSync(join(h.outbox, "run-c.pending"), "clawdi\n");
  writeFileSync(join(h.outbox, "run-o.pending"), "otherbot\n");
  const r = h.run();
  assert.equal(h.calls().length, 2, "both agents woken");
  assert.doesNotMatch(r.stderr, /unbound variable/, `set -u tripped inside the drain block:\n${r.stderr}`);
  assert.match(r.stdout, /1 event\(s\) still pending after 0s/,
    "the count is globbed, not assumed — reporting 0 over a populated outbox would be the same defect with the noise removed");
  assert.deepEqual(h.markers(), ["run-o.pending"], "the trigger still deletes nothing: the unconsumed event is retained");
});

test("marker naming no routable agent is QUARANTINED (payload kept) without any wake", SHELL_GATE, () => {
  const h = makeHarness();
  h.setMode("ok");
  writeFileSync(join(h.outbox, "junk.pending"), "not a/valid agent!\n");
  h.run();
  assert.equal(h.calls().length, 0, "nothing woken off garbage");
  assert.deepEqual(h.markers(), [], "quarantined marker no longer matches the .path glob (no eternal re-fire)");
  assert.deepEqual(h.quarantined(), ["junk.pending"], "payload preserved in outbox/quarantine/");
  assert.equal(readFileSync(join(h.outbox, "quarantine", "junk.pending"), "utf8"), "not a/valid agent!\n", "payload byte-intact");
});

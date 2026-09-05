// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The drain check reports the drainer this deployment has — tracker issue 181.
//
// `e2e.mjs run` asked systemd about `prelim-driver.timer` and `prelim-driver.path`, the two RETIRED
// units, and about nothing else. On a deployment drained by `clearotron-worker.service` it found neither
// and printed, in capitals, that nothing would drain the queue — then gave the command to arm a second
// drainer beside the running one.
//
// Measured while that message was on screen: queue=1 claimed=0 at t+12s, t+24s, t+36s; claimed=1 at
// t+48s. The worker had it, and the run settled and delivered.
//
// THE INSTRUCTION WAS THE DANGEROUS HALF. A second drainer beside a live one is a known incident shape,
// and the guard that stops `clearotron update` running under a live clearance assumes one drainer owns
// the queue. The reader most likely to obey is the one least able to judge it — somebody who ran the
// documented command and saw capitals.
//
// ── WHY THESE ARMS INJECT EVERYTHING ────────────────────────────────────────────────────────────────
//
// The defect lived in a branch reachable only on a worker-drained box, and nobody testing had one. So
// the probe, the systemctl reader and the queue directory are all injected: every branch is driven here,
// on any machine, including the two states this box cannot be in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { queueDrainState } from "../../scripts/e2e.mjs";

// A systemctl that ANSWERS, reporting both retired units inactive — the state the defect was found in.
// `null` would be a different fixture entirely: it means systemctl could not be reached, which the code
// reports as unknown. Getting that wrong is how an arm drives a branch it did not mean to.
const noRetiredUnits = () => "inactive";
const workerEnabled = { unit: "/h/.config/systemd/user/clearotron-worker.service", present: true, enabled: true, error: null };
const workerOff = { ...workerEnabled, enabled: false };
const workerUnreadable = { unit: workerEnabled.unit, present: null, enabled: null, error: "EACCES" };

test("tracker issue 181 — an enabled worker IS the drain, and nothing is armed", () => {
  // THE DEFECT ITSELF. Both retired units inactive plus an enabled worker used to be reported as
  // "nothing will drain this queue".
  const r = queueDrainState({ worker: workerEnabled, sc: noRetiredUnits, queueDir: "/q" });
  assert.equal(r.armed, true, "a deployment drained by the worker is still reported as undrained");
  assert.match(r.how, /clearotron-worker\.service/, "the answer does not name the unit that is doing the draining");
});

test("tracker issue 181 — with no drainer at all, the claim NAMES the queue it checked", () => {
  // The issue asks for a genuine "nothing will drain" to be falsifiable. It named no queue, so a reader
  // had nothing to check it against — and this is the strongest sentence the command prints.
  const r = queueDrainState({ worker: workerOff, sc: noRetiredUnits, queueDir: "/var/spool/clearotron" });
  assert.equal(r.armed, false);
  assert.match(r.how, /\/var\/spool\/clearotron/, "the claim that nothing drains names no queue, so nobody can falsify it");
  assert.match(r.how, /clearotron-worker\.service is not enabled/,
    "the answer does not say the CURRENT drainer was looked for — only the retired ones");
});

test("tracker issue 181 — a worker that could not be READ is unknown, never 'nothing drains'", () => {
  // The could-not-look, which must not become the sentence that carries an instruction. A permission
  // error on the unit file is not evidence that no drainer is running.
  const r = queueDrainState({ worker: workerUnreadable, sc: noRetiredUnits, queueDir: "/q" });
  assert.equal(r.armed, null, "a failure to read the worker unit was reported as a finding that nothing drains");
  assert.match(r.how, /unknown/);
});

test("tracker issue 181 — a retired unit still counts when it is genuinely the drain", () => {
  // The old posture is retired, not forbidden. A box that really is running the timer must still be
  // reported as drained — otherwise this change would have swapped one wrong answer for another.
  const timerActive = (...a) => (a[0] === "is-active" && a[1] === "prelim-driver.timer" ? "active" : "inactive");
  const r = queueDrainState({ worker: workerOff, sc: timerActive, queueDir: "/q" });
  assert.equal(r.armed, true, "a box actually running the retired timer is now reported as undrained");
});

test("tracker issue 181 — no state that could be a live drainer prints an arm-a-drainer command", () => {
  // THE CLASS, driven at the surface the operator reads rather than at the predicate. Suggesting a
  // second drainer is the failure; only a state that has EXCLUDED every drainer may print the command.
  const src = readSource();
  const shown = src.slice(src.indexOf("queued. ${"), src.indexOf("Watch it with:"));
  assert.ok(shown.length, "the printed block moved — this arm is no longer reading what the operator sees");

  // The command appears exactly once, and in the `armed === false` branch only.
  const armLines = shown.split("\n").filter((l) => l.includes("enable --now"));
  assert.equal(armLines.length, 1, "the arm-a-drainer command is printed from more than one state");
  assert.match(armLines[0], /NOTHING WILL DRAIN THIS QUEUE/,
    "the command to start a drainer is printed from a state that has not excluded a running one");
  // And it names the unit this deployment uses, not a retired one.
  assert.match(armLines[0], /clearotron-worker\.service/,
    "the command still arms a retired unit, which on this deployment starts a second drainer");
  assert.doesNotMatch(armLines[0], /prelim-driver/, "the retired unit is still what an operator is told to start");

  // UNKNOWN must carry no command at all, and must say why not.
  const unknownLine = shown.split("\n").find((l) => l.includes("Drain state UNKNOWN"));
  assert.ok(unknownLine, "the unknown state is gone from the printed block");
  assert.doesNotMatch(unknownLine, /enable --now/, "an unknown drain state tells the operator to start a drainer");
});

function readSource() {
  return readFileSync(new URL("../../scripts/e2e.mjs", import.meta.url), "utf8");
}

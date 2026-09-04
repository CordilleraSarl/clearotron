// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// doubt-closure-budget.test.mjs —. The retry ladder is sized against MEASURED stage work, and a
// wall kill says what it was killed against.
//
// The defect had two halves and only one of them was the obvious one. `doubt-closure` carried
// timeoutSec 300, so its hard wall stood at 360s (timeoutSec + 60) while the stage's clean-pass
// generation measured 466.0s and 497.4s on the two runs that produced a settled closure. That is the
// visible half: attempt 1 was killed, ~42k output tokens were generated and discarded, and the retry
// re-did the same work.
//
// THE HALF THAT DECIDED THE FIX is that gateway grants the single extended shot at `timeoutSec * 1.5`,
// so the old ladder was 300 -> 450 and BOTH successes exceeded rung 2 as well. They landed only because
// the +60s grace carried them, which means a change that raised the first rung to 450 and stopped would
// have looked like a fix and left every clean pass still riding the margin.
//
// So the arm below is written against the OBSERVED NEED rather than against the number in the file:
// stating `timeoutSec === 600` would pass just as well for a ladder that was never sized against
// anything, and would tell the next reader nothing about why 600. Both rungs must clear 497.4s on their
// own budget, with the grace explicitly not counted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { STAGES } from "../stages.mjs";
import { stallMs } from "../engine/common.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { runLedger, investigate } from "../../scripts/e2e.mjs";

// From the attempt records of the two incidents on (an R1 and an R2 round, 2026-08-19 and
// 2026-08-21), each `_driver/doubt-closure.jsonl`. The runs are cited by ROUND and DATE and not by
// codename: this repository is de-identified by design and a generator codename names a real matter.
// The SLOWER of the two clean passes is the number the ladder has to clear — sizing to the faster one
// re-files this issue.
const OBSERVED_CLEAN_PASS_SEC = 497.4;
const GRACE_SEC = 60;              // gateway's hard wall = timeoutSec + 60. A margin, never a budget.
const RETRY_MULTIPLIER = 1.5;      // gateway.mjs: `effTimeout = Math.round(timeoutSec * 1.5)`

test("#1502 — every rung of doubt-closure's ladder clears the stage's measured work without the grace", () => {
  const rung1 = Number(STAGES["doubt-closure"]?.timeoutSec);
  assert.ok(Number.isFinite(rung1) && rung1 > 0, "doubt-closure declares no timeoutSec");
  const rung2 = Math.round(rung1 * RETRY_MULTIPLIER);

  for (const [label, budget] of [["first attempt", rung1], ["the extended retry", rung2]]) {
    assert.ok(budget > OBSERVED_CLEAN_PASS_SEC,
      `${label} budget is ${budget}s, and the stage's observed clean pass is ${OBSERVED_CLEAN_PASS_SEC}s. `
      + `A rung below the work it has to fit is survived only on the ${GRACE_SEC}s grace, which is the `
      + `state #1502 was filed about. Raise timeoutSec against a measurement, not by doubling.`);
  }
});

// A stall is NOT a small budget, and the two are repaired in opposite directions — gateway retries a
// stall at the SAME budget on purpose, because extending one only extends the next stall's burn. So the
// decision to leave doubt-closure's stallSec UNDECLARED, while widening its wall, needs its premise
// measured rather than remembered: the inherited default is a SILENCE window, and a stage that streams
// for 497s at 85-116 tok/s never goes quiet inside it. Both incidents signalled `hardWall`, never
// `stalled`. If that default is ever shrunk, this is where a stage now running 600s finds out.
test("#1502 — the stall window doubt-closure inherits is a silence window its work does not trip", () => {
  const prior = process.env.CLEAROTRON_STALL_MS;
  delete process.env.CLEAROTRON_STALL_MS;
  try {
    assert.equal(stallMs(), 120_000,
      "the undeclared-stallSec default moved; doubt-closure's wall was widened to 600s on the premise that "
      + "this is a window of SILENCE, which a continuously-streaming stage never fills");
  } finally { if (prior !== undefined) process.env.CLEAROTRON_STALL_MS = prior; }

  const { stallSec, timeoutSec } = STAGES["doubt-closure"];
  const effectiveMs = Number(stallSec) > 0 ? Number(stallSec) * 1000 : 120_000;
  assert.ok(effectiveMs < timeoutSec * 1000,
    `the stall window (${effectiveMs / 1000}s) must stay under the budget (${timeoutSec}s), or a genuinely `
    + "silent wedge burns the whole wall before anything trips");
});

// ── the round report ──────────────────────────────────────────────────────────────────────────────
//
// The driver has always written `timeoutSec` on the per-attempt row. `runLedger` picked its fields by
// name and dropped it, so the ledger could say "killed at its 6m01s wall" with no way to say whether
// 6m01s was the stage's entire budget or a stage hanging inside a much larger one — opposite findings,
// one sentence. Both halves are asserted here: the reader carries the field, and the line spends it.

function seatRow(over = {}) {
  return { attempt: 1, engine: "claude", wall: 361.3, code: 137, timeoutSec: 300,
    signals: { hardWall: true, thought: true }, fail: "timeout", ...over };
}

function ledgerFor(rows) {
  const dir = mkdtempSync(join(tmpdir(), "e2e-1502-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(join(dir, "status.json"), JSON.stringify({ state: "delivered" }));
  writeFileSync(driverDir(dir, "doubt-closure.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  try { return runLedger(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("#1502 — a wall-killed attempt names the budget it was killed against", () => {
  const led = ledgerFor([seatRow(), seatRow({ attempt: 2, wall: 466.0, code: 0, timeoutSec: 450, fail: null, signals: {} })]);

  assert.equal(led.attempts[0].timeoutSec, 300,
    "runLedger dropped timeoutSec — the report cannot describe a budget it never read");

  const line = investigate(led).find((l) => l.startsWith("doubt-closure retried"));
  assert.ok(line, `no retry line: ${JSON.stringify(investigate(led))}`);
  assert.match(line, /killed at its .* wall/, "a wall kill must still read as a wall kill");
  assert.match(line, /300s budget/, `the line must name the budget — got: ${line}`);
});

// THE CONTROL. Without it the arm above passes for a report that stamps "killed at its budget" on
// everything, which is the same blindness in the other direction: a stage that failed on a validator is
// not a stage that needed more time, and a reader who cannot tell them apart chases the wrong repair.
test("#1502 — a retry after a failure FOR CAUSE does not read as a wall kill", () => {
  const cause = "invalid_file:/runs/x/doubt-closure.md:banned tone \"Massive\"";
  const led = ledgerFor([
    seatRow({ wall: 44.2, code: 0, fail: cause, signals: {} }),
    seatRow({ attempt: 2, wall: 51.0, code: 0, fail: null, signals: {} }),
  ]);

  const line = investigate(led).find((l) => l.startsWith("doubt-closure retried"));
  assert.ok(line, "the retry itself must still be reported");
  assert.doesNotMatch(line, /killed at its/, `a failure for cause must not read as a wall kill — got: ${line}`);
  assert.match(line, /banned tone/, `the line must carry the actual cause — got: ${line}`);
});

// An absence is a finding. A row that carries no budget is a GAP IN THE RECORD, and saying so is a
// different statement from a stage that ran without a wall — which cannot happen, since the wall is
// always timeoutSec + 60. Printing `null` or dropping the clause would read as the latter.
test("#1502 — a kill whose row recorded no budget says so, rather than reading as unbounded", () => {
  const noBudget = seatRow(); delete noBudget.timeoutSec;
  const led = ledgerFor([noBudget, seatRow({ attempt: 2, wall: 466.0, code: 0, fail: null, signals: {} })]);

  const line = investigate(led).find((l) => l.startsWith("doubt-closure retried"));
  assert.match(line, /did not record/, `an unrecorded budget must be named as unrecorded — got: ${line}`);
  assert.doesNotMatch(line, /null|undefined|NaN/, `an absence must not print as a value — got: ${line}`);
});

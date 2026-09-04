// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// cannot-repair-is-a-fact.test.mjs —.
//
// THE LADDER HAD A CASE IT COULD NOT CLOSE AND NO WAY TO SAY SO. A run died at 1.1 minutes with
// `repair-attempted=3` already in its log, on `recall_reconciliation_unended`. The refusal is correct and
// stays. What was missing sits one layer down: three spent attempts against a case the repair has no move
// for, and three spent attempts against a case a fourth would have fixed, left IDENTICAL evidence — an
// attempts count and a generic refusal.
//
// The durable row is where this had to be fixed. added `effect: {asked, closed}` to the LOG line and
// stopped there, so `_driver/repairs.json` carried `attempts` and `lastOutcome` and nothing about whether
// anything ever closed. Across a park/resume — which is the whole reason that file exists — the ledger
// could not tell its own history apart.
//
// WHAT THIS DOES NOT CLOSE: the pipeline floor that prints the refusal still words it generically. That
// call site belongs to another lane's active work and is untouched here; the FACT is now derivable and
// persisted, which is what the issue asks for first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { createRepairLedger, repairVerdict, REPAIR_VERDICTS } from "../repairs.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "repairs-1063-"));
const rowOf = (runDir, key) => JSON.parse(readFileSync(driverDir(runDir, "repairs.json"), "utf8"))[key];

test("#1063 THE DEFECT: budget spent, nothing ever closed, and every attempt measured — cannot-repair", () => {
  const runDir = dir();
  const ledger = createRepairLedger(runDir);
  for (let i = 0; i < 3; i++) {
    ledger.record("recall-reconcile", "unended:1", "ok", { effect: { asked: 4, closed: 0 } });
  }
  const v = ledger.verdict("recall-reconcile", "unended:1", { max: 3 });
  assert.equal(v.verdict, "cannot-repair",
    "three measured attempts that closed nothing is the class #1063 filed — a repair with no move for "
    + "this case, which is a different fact from a repair that failed three times");
  assert.equal(v.attempts, 3);
  assert.equal(v.closed, 0);
  assert.equal(v.asked, 12, "the totals ride the row so a reader can check the verdict rather than trust it");
  // `outcome: "ok"` on every attempt is the shape: the DISPATCH returned. That must not read as a repair.
  assert.equal(rowOf(runDir, "recall-reconcile:unended:1").lastOutcome, "ok");
});

test("#1063 an UNMEASURED attempt is never laundered into cannot-repair", () => {
  // The whole hazard of a derived verdict: silence reading as the stronger answer. An attempt that never
  // measured whether it closed anything is honest ignorance, and the remedy for ignorance is to measure.
  const runDir = dir();
  const ledger = createRepairLedger(runDir);
  ledger.record("recall-reconcile", "unended:2", "ok", { effect: { asked: 4, closed: 0 } });
  ledger.record("recall-reconcile", "unended:2", "ok");                       // no effect supplied
  const v = ledger.verdict("recall-reconcile", "unended:2", { max: 2 });
  assert.equal(v.verdict, "exhausted-unmeasured",
    "one unmeasured attempt makes the population unknowable — reporting cannot-repair here would indict "
    + "a repair on evidence that was never gathered");
  assert.equal(v.measured, 1);
  assert.equal(v.attempts, 2);
});

test("#1063 a row written before this change reads as unmeasured, never as cannot-repair", () => {
  // Backwards honesty. Old rows carry attempts and lastOutcome and no counters; they genuinely cannot
  // say, and a migration that read their silence as "closed nothing" would manufacture the finding.
  const legacy = { attempts: 3, lastOutcome: "failed: nothing", ts: "2026-08-15T00:00:00.000Z" };
  assert.equal(repairVerdict(legacy, { max: 3 }).verdict, "exhausted-unmeasured");
  assert.equal(repairVerdict(legacy, { max: 3 }).measured, 0);
});

test("#1063 anything that closed is repaired — partial counts, because the repair HAS a move", () => {
  const runDir = dir();
  const ledger = createRepairLedger(runDir);
  ledger.record("finding-corrective-reemit", "f:7", "ok", { effect: { asked: 5, closed: 0 } });
  ledger.record("finding-corrective-reemit", "f:7", "ok", { effect: { asked: 5, closed: 2 } });
  const v = ledger.verdict("finding-corrective-reemit", "f:7", { max: 2 });
  assert.equal(v.verdict, "repaired", "2 of 5 closed is a repair with a move, not a repair that cannot");
  assert.equal(v.closed, 2);
});

test("#1063 in-budget and untried stay distinct from both exhausted answers", () => {
  const runDir = dir();
  const ledger = createRepairLedger(runDir);
  assert.equal(ledger.verdict("x", "y", { max: 3 }).verdict, "untried", "no row is not a spent budget");
  ledger.record("x", "y", "failed", { effect: { asked: 1, closed: 0 } });
  assert.equal(ledger.verdict("x", "y", { max: 3 }).verdict, "in-budget", "1 of 3 is not exhausted");
  assert.equal(ledger.verdict("x", "y", { max: 1 }).verdict, "cannot-repair",
    "the SAME row against a ceiling of 1 is exhausted — the verdict is a function of the budget, and the "
    + "budget belongs to the caller");
});

test("#1063 the counters survive a park/resume, which is the only reason the file exists", () => {
  const runDir = dir();
  createRepairLedger(runDir).record("r", "t", "ok", { effect: { asked: 3, closed: 0 } });
  createRepairLedger(runDir).record("r", "t", "ok", { effect: { asked: 3, closed: 0 } });
  const reopened = createRepairLedger(runDir);                                 // a third process
  const v = reopened.verdict("r", "t", { max: 2 });
  assert.equal(v.verdict, "cannot-repair");
  assert.equal(v.measured, 2, "the measured count did not survive the reopen — the durable row is the point");
});

test("#1063 a new epoch re-arms the verdict as well as the budget", () => {
  // The input legitimately changed, so the old row answers a different question. canAttempt already
  // treated it that way; a verdict that kept reporting cannot-repair across an epoch change would hold a
  // repair guilty of failing at something it was never asked.
  const runDir = dir();
  const ledger = createRepairLedger(runDir);
  ledger.record("r", "t", "ok", { epoch: 1, effect: { asked: 2, closed: 0 } });
  assert.equal(ledger.verdict("r", "t", { max: 1, epoch: 1 }).verdict, "cannot-repair");
  assert.equal(ledger.verdict("r", "t", { max: 1, epoch: 2 }).verdict, "untried");
  assert.equal(ledger.canAttempt("r", "t", { max: 1, epoch: 2 }), true, "and the two agree");
});

test("#1063 the log line carries the totals always, and the verdict only when a ceiling was named", () => {
  const events = [];
  const runDir = dir();
  const ledger = createRepairLedger(runDir, { log: (o) => events.push(o) });
  ledger.record("r", "t", "ok", { effect: { asked: 2, closed: 0 } });
  assert.equal(events[0].measuredAttempts, 1);
  assert.equal(events[0].closedTotal, 0);
  assert.equal("verdict" in events[0], false,
    "this layer does not know the budget; a verdict emitted without one would be a guessed ceiling, and a "
    + "guessed ceiling manufactures cannot-repair");
  ledger.record("r", "t", "ok", { effect: { asked: 2, closed: 0 }, max: 2 });
  assert.equal(events[1].verdict, "cannot-repair", "and it says so when the caller names the budget");
  assert.ok(REPAIR_VERDICTS.includes(events[1].verdict));
});

test("#1063 record() still returns the attempt count and still survives a dead logger", () => {
  const runDir = dir();
  const ledger = createRepairLedger(runDir, { log: () => { throw new Error("logger down"); } });
  assert.equal(ledger.record("a", "b", "ok", { effect: { asked: 1, closed: 1 } }), 1);
  assert.equal(ledger.verdict("a", "b", { max: 1 }).verdict, "repaired");
});

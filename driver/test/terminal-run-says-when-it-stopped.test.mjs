// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A RUN THAT HAS STOPPED SAYS WHEN, WHICHEVER WAY IT STOPPED.
//
// The owner watched a SIGKILLed run sit at `state:"running"`, `endedAt:null`, showing 5h43m in the UI.
// The reconciler fixed the corpse — it brings a dead run to terminal WITH `endedAt` and `reconciledAt`.
// Nothing else ever wrote the field.
//
// So a run that was KILLED and reconciled ended up better recorded than one that stopped CLEANLY:
//
//   · two cancelled runs measured on the test box:  state=cancelled  endedAt=null  reason=null
//   · the delivered example run:                     state=delivered  deliveredAt=…  endedAt=undefined
//   · a reconciled corpse:                          state=failed     endedAt=…      reconciledAt=…
//
// Any reader computing a duration from status.json gets nothing on EVERY clean terminal. That is the
// coping behaviour this issue was filed about, still present on the paths that work — and it is broader
// than the routed shortfall, which named only the cooperative-stop path.
//
// The stamp lives in `writeRunStatus`, the one place all three terminals pass through. Three call sites
// in three files would be three chances to forget, and a field somebody has to remember is a field one
// of them will not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRunStatus } from "../progress.mjs";

const run = () => mkdtempSync(join(tmpdir(), "endedat-"));
const status = (d) => JSON.parse(readFileSync(join(d, "status.json"), "utf8"));

test("#1090 every clean terminal stamps endedAt — cancelled, delivered and failed alike", () => {
  for (const state of ["cancelled", "delivered", "failed"]) {
    const d = run();
    writeRunStatus(null, { state: "running" }, d);
    assert.equal(status(d).endedAt, undefined, `premise held: a RUNNING run has no endedAt (${state})`);
    writeRunStatus(null, { state }, d);
    const s = status(d);
    assert.equal(s.state, state);
    assert.ok(s.endedAt, `a ${state} run still carries no endedAt — a reader computing a duration gets nothing`);
    assert.equal(s.endedAt, s.updatedAt, "the stamp is the write's own timestamp, not a second clock read");
  }
});

test("#1090 a run still RUNNING is not stamped — the field means stopped, not touched", () => {
  const d = run();
  writeRunStatus(null, { state: "running", stepIndex: 1 }, d);
  writeRunStatus(null, { state: "running", stepIndex: 2 }, d);
  assert.equal(status(d).endedAt, undefined,
    "a live run acquired an end time. Every reader that trusts this field would then count it as stopped");
  // …and the two non-terminal pauses are not ends either. A parked run resumes; stamping it would make
  // the record say the run finished at the moment it was interrupted.
  for (const state of ["recovery-parked", "rate-limit-postponed"]) {
    const p = run();
    writeRunStatus(null, { state }, p);
    assert.equal(status(p).endedAt, undefined, `${state} is a pause, not a terminal — it must not be stamped`);
  }
});

test("#1090 the RECONCILER's own endedAt wins — a corpse says when the process died", () => {
  // The reconciler passes an explicit endedAt for the moment it judges the process gone. That is a
  // different fact from "when the record was repaired", and the patch spread must keep it: stamping over
  // it would silently relabel every reconciled corpse with its repair time.
  const d = run();
  writeRunStatus(null, { state: "running" }, d);
  const died = "2026-08-17T09:00:00.000Z";
  writeRunStatus(null, { state: "failed", endedAt: died, reconciledAt: died, reconciledFrom: "running" }, d);
  assert.equal(status(d).endedAt, died,
    "the stamp overwrote the reconciler's value — a corpse would now claim it died when it was repaired");
});

test("#1090 endedAt is APPEND-ONLY — a re-entrant terminal write cannot move it", () => {
  // Same rule as startedAt, for the same reason. `judgeArtifacts` is invoked more than once per attempt
  // and the wall rescues call terminal paths again; a patch-wins field is what destroyed `reportedAt`.
  const d = run();
  writeRunStatus(null, { state: "running" }, d);
  writeRunStatus(null, { state: "delivered" }, d);
  const first = status(d).endedAt;
  assert.ok(first, "premise held");
  writeRunStatus(null, { state: "delivered", stepLabel: "a later write" }, d);
  assert.equal(status(d).endedAt, first, "a second terminal write moved the time the run stopped");
});

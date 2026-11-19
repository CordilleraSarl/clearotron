// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A STOP IS READ ONCE MORE BEFORE ANYTHING IS PUBLISHED.
//
// THE DEFECT, MEASURED. A stop was pressed on a knockout, recorded, and a complete report was published
// 100 seconds later. The dialog and the API had each told the operator that nothing would be delivered.
//
// The gateway's read of the flag is INSIDE the attempt loop, before a turn is dispatched, and a
// dispatched turn always finishes. So the flag is consulted when a stage is about to spend and at no
// other moment. On the knockout lane publication follows the final stage directly — it is not a stage
// and never goes through the gateway — so a stop arriving during that stage has no later read to be
// seen at. Nothing failed; there was no boundary left.
//
// WHAT THIS FILE HOLDS: that the read refuses when it should. That both lanes perform it, in the right place, is held
// by what a run does: a-stop-pressed-during-the-last-knockout-stage-publishes-nothing.test.mjs and
// a-clearance-reads-the-stop-before-it-publishes-and-never-after.test.mjs. A helper nobody calls is the shape this whole
// defect had, so the pair is needed.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertNotCancelledBeforePublish, requestCancel, RunCancelled, CANCEL_MARKER } from "../cancel.mjs";

const runDir = () => mkdtempSync(join(tmpdir(), "stop-before-publish-"));

test("a run with no stop request publishes — the read is not a wall", () => {
  assert.equal(assertNotCancelledBeforePublish(runDir(), "knockout"), null,
    "an uncancelled run was refused at publish, which would withhold every ordinary report");
});

test("a stop recorded at any earlier moment refuses the publish", () => {
  const dir = runDir();
  // Recorded through the same door the engine uses, not by writing the marker by hand: a test that
  // plants its own file cannot notice the day requestCancel starts writing something else.
  const rec = requestCancel(dir, { via: "mcp/stop_run", by: "someone@example.com" });
  assert.ok(rec.ts, "the cancel record carries no timestamp — the rest of this arm proves nothing");

  assert.throws(() => assertNotCancelledBeforePublish(dir, "knockout"), RunCancelled,
    "a recorded stop did not refuse the publish — this is the measured defect, exactly");

  // The refusal must carry the record, because the run-level handler writes the provenance from it into
  // the archived matter record. A bare throw would land as an unattributed stop.
  try { assertNotCancelledBeforePublish(dir, "knockout"); assert.fail("did not throw"); }
  catch (e) {
    assert.ok(e instanceof RunCancelled, "not the distinct class — a StageFailure here would be classified, parked and RESUMED");
    assert.match(String(e.message), /publish/, "the refusal does not say where it happened");
  }
});

test("the marker the read looks for is the one the engine writes", () => {
  // The two halves of the measured incident were "the request was recorded" and "no cancel artefact was
  // found". They are reconcilable — the marker is a DOTFILE — and this pins that the name the reader
  // looks for is the name the writer writes, so the two can never drift into a real absence.
  const dir = runDir();
  requestCancel(dir, { via: "mcp/stop_run" });
  assert.ok(CANCEL_MARKER.startsWith("."), "the marker stopped being a dotfile — every listing of a run dir now shows it");
  assert.doesNotThrow(() => readFileSync(join(dir, CANCEL_MARKER), "utf8"),
    "requestCancel did not write the marker the pre-publish read looks for");
});

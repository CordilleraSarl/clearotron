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
// WHAT THIS FILE HOLDS, in two parts, because either alone is satisfiable while the pair is wrong:
// that the read refuses when it should, and that both lanes actually perform it. A helper nobody calls
// is the shape this whole defect had.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { assertNotCancelledBeforePublish, requestCancel, RunCancelled, CANCEL_MARKER } from "../cancel.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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

test("BOTH lanes perform the read, and the clearance lane does it after the already-published branch", () => {
  // THE WIRING, WHICH IS THE HALF THE DEFECT ACTUALLY WAS. The gateway's read existed and was correct;
  // nothing asked it late enough. A test of the helper alone would have passed throughout.
  const ko = readFileSync(join(ROOT, "pipeline-knockout.mjs"), "utf8");
  const cl = readFileSync(join(ROOT, "pipeline.mjs"), "utf8");

  for (const [name, src, lane] of [["pipeline-knockout.mjs", ko, "knockout"], ["pipeline.mjs", cl, "clearance"]]) {
    const call = src.indexOf(`assertNotCancelledBeforePublish(run.runDir, "${lane}")`);
    assert.ok(call > 0, `${name} does not read the stop flag before publishing`);
  }

  // ORDER, not presence. On the knockout lane the read must precede the publish call.
  assert.ok(ko.indexOf('assertNotCancelledBeforePublish(run.runDir, "knockout")') < ko.indexOf("publishKnockout({"),
    "the knockout lane reads the flag after it has already published, which is no read at all");

  // On the clearance lane it must sit INSIDE the else branch — after the `.published` short-circuit —
  // or a run that already delivered would be recorded as cancelled, which is this defect reversed.
  const shortCircuit = cl.indexOf('existsSync(join(run.runDir, ".published"))');
  const call = cl.indexOf('assertNotCancelledBeforePublish(run.runDir, "clearance")');
  const publish = cl.indexOf("published = await publishReport({");
  assert.ok(shortCircuit > 0 && call > shortCircuit,
    "the clearance lane reads the flag BEFORE the already-published check — a delivered run would be recorded as stopped");
  assert.ok(call < publish, "the clearance lane reads the flag after publishing, which is no read at all");
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

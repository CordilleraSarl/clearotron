// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the deadline enrichment and a later synthesis save, on invented records
//
// A RECORDED DEADLINE SURVIVES A LATER SAVE.
//
// Before the delivery seam the driver gives a finding with no deadline the register's own opposition window, when
// that window is in the action window ("a recorded deadline never silently disappears"). It wrote the window to the
// findings file alone. Every synthesis save renders the file from the model's call: a patch is merged onto the stored
// call, which never carried the window, and a whole re-send replaces it. So the next save dropped the deadline, and a
// card built with it was rebuilt without it.
//
// Now the stored call takes the window too, so a patch keeps it, and after a save that follows the seam the driver
// writes it again, judged by the clock the first enrichment used.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { paths } from "../stages.mjs";
import { recordSynthesis } from "../synthesis-record.mjs";
import { foldFindingsFile } from "../record-fold.mjs";
import { enrichFindingDeadlines, rewriteFromBeforeTheSeam } from "../pipeline.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
const THREE = [["Halvorne Works", "TESSARIN"], ["Quillmere Ltd", "ODRAVEL"], ["Pennick Supply", "MARVETTE"]];
function record() {
  const doc = JSON.parse(synthesisFindings(null));
  const base = doc.findings[0];
  return { ...doc, findings: THREE.map(([owner, mark], i) => {
    const f = structuredClone(base);
    f.ordinal = i + 1;
    f.mark = mark;
    f.owner.name = owner;
    f.owner.registrations[0].uri = `/mark/us/9300000${i + 1}`;
    if (f.meters?.mark_similarity) f.meters.mark_similarity.source = f.owner.registrations[0].uri;
    delete f.deadline;
    return f;
  }) };
}
const COVERAGE = [{ area: "the invented register", state: "not-searched", note: "The reworded note for the one slice." }];

// The clock the first enrichment judges by, and a window nineteen days after it: inside the action window then, and
// long closed by the time any test runs, so only that clock can find it in the window again.
const CLOCK = Date.parse("2026-01-01T00:00:00.000Z");
const WINDOW_END = "2026-01-20";

/** A run whose second finding's registration carries an opposition window, holding one accepted whole save. */
function runWithAWindow() {
  const dir = mkdtempSync(join(tmpdir(), "deadline-survives-"));
  dirs.push(dir);
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(join(dir, "register-named-band.json"), JSON.stringify([{ uri: "/mark/us/93000002", oppositionEndDate: WINDOW_END }]));
  const r = recordSynthesis(dir, { narrative: NARRATIVE, findings: record() });
  assert.equal(r.refused, null, `the first save was refused: ${r.refused}`);
  return dir;
}
const onDisk = (dir) => JSON.parse(readFileSync(join(dir, "findings.json"), "utf8"));
const deadlineOf = (dir, ordinal) => onDisk(dir).findings.find((f) => f.ordinal === ordinal)?.deadline ?? null;
const accepts = (r, what) => assert.equal(r.refused, null, `${what} was refused: ${r.refused}`);
const quiet = () => {};

test("an enriched deadline reaches the stored call, so the next patch keeps it", () => {
  const dir = runWithAWindow();
  enrichFindingDeadlines(paths(dir), dir, quiet, { nowMs: CLOCK });
  assert.deepEqual(deadlineOf(dir, 2), { kind: "opposition", date: WINDOW_END }, "premise: the enrichment gave finding 2 its window");
  const receipt = JSON.parse(readFileSync(driverDir(dir, "deadline-enrich.json"), "utf8"));
  assert.equal(receipt.base, "enriched", "the receipt does not say the stored call took the window");
  assert.equal(receipt.judged_at, new Date(CLOCK).toISOString(), "the receipt does not keep the clock the window was judged by");
  for (const [what, patch] of [
    ["a corrected coverage register", { findings: { coverage: COVERAGE } }],
    ["a corrected first finding", { findings_patch: [{ ...record().findings[0], legal_position: "The corrected legal position for the first invented finding." }] }],
  ]) {
    accepts(recordSynthesis(dir, patch), what);
    assert.deepEqual(deadlineOf(dir, 2), { kind: "opposition", date: WINDOW_END }, `${what}: the patch dropped the recorded deadline`);
  }
});

test("after a whole re-send that follows the seam, the late-save rewrite gives the finding its window again, by the first clock", () => {
  const dir = runWithAWindow();
  enrichFindingDeadlines(paths(dir), dir, quiet, { nowMs: CLOCK });
  foldFindingsFile(dir, join(dir, "findings.json"), null, { seam: true });
  accepts(recordSynthesis(dir, { narrative: NARRATIVE, findings: record() }), "a whole re-send after the seam");
  assert.equal(deadlineOf(dir, 2), null, "premise: the whole re-send carried no deadline, so the save dropped it");
  rewriteFromBeforeTheSeam({ paths: paths(dir) });
  assert.deepEqual(deadlineOf(dir, 2), { kind: "opposition", date: WINDOW_END }, "the rewrite did not give the finding its window again");
  assert.deepEqual([deadlineOf(dir, 1), deadlineOf(dir, 3)], [null, null], "a finding with no window gained a deadline");
  // and the stored call took it, so a patch after the rewrite keeps it too
  accepts(recordSynthesis(dir, { findings: { coverage: COVERAGE } }), "a patch after the rewrite");
  assert.deepEqual(deadlineOf(dir, 2), { kind: "opposition", date: WINDOW_END }, "the patch after the rewrite dropped the deadline");
});

test("a deadline the model wrote itself is never replaced, before the seam or after it", () => {
  const dir = runWithAWindow();
  const own = { kind: "opposition", date: "2026-01-25" };
  const doc = record();
  doc.findings[1].deadline = own;
  accepts(recordSynthesis(dir, { narrative: NARRATIVE, findings: doc }), "a save whose second finding carries its own deadline");
  enrichFindingDeadlines(paths(dir), dir, quiet, { nowMs: CLOCK });
  assert.deepEqual(deadlineOf(dir, 2), own, "the enrichment replaced the deadline the model wrote");
  rewriteFromBeforeTheSeam({ paths: paths(dir) });
  assert.deepEqual(deadlineOf(dir, 2), own, "the late-save rewrite replaced the deadline the model wrote");
});

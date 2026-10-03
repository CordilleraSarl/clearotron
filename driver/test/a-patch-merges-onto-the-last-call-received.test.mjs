// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the synthesis save's patch base, on invented records
//
// A PATCH MERGES ONTO THE LAST CALL THIS RUN RECEIVED, ACCEPTED OR REFUSED (design, 2026-10-03).
//
// Measured on the first run under the sentence cap: the first save was refused for one finding sentence of
// 26 words. The seat sent a patch for that one finding, and the save refused it, because a patch merged only
// onto an ACCEPTED record and there was none. So the seat resent the whole record, 61,000 characters. Now a
// patch merges onto the record the last call carried, refused or not, and the merged record is checked
// whole. A patch with no record before it is refused as before. No line the seat reads changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordSynthesis, synthesisCallPaths, FINDINGS_FILE, NARRATIVE_FILE } from "../synthesis-record.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
const SHORT = "Qorvalen Holdings' earlier VELTRIN would probably win against your mark for software in the European Union.";
const LONG = `${SHORT.slice(0, -1)} because the goods overlap, the marks are near and the earlier right is live on the register today too.`;
const words = (s) => s.split(/\s+/).filter(Boolean).length;

/** A two-finding record; `nets` gives each finding's sentence. */
function record(nets) {
  const doc = JSON.parse(synthesisFindings(null));
  const one = doc.findings[0];
  return { ...doc, findings: nets.map((net, i) => ({ ...one, ordinal: i + 1, mark: i ? "VELTRIN NOVA" : one.mark, net })) };
}
function runDir() {
  const dir = mkdtempSync(join(tmpdir(), "patch-base-"));
  mkdirSync(driverDir(dir), { recursive: true });
  return dir;
}
const onDisk = (dir) => JSON.parse(readFileSync(join(dir, FINDINGS_FILE), "utf8"));

test("premise: the long sentence is over the cap and the short one is within it", () => {
  assert.equal(words(LONG) > 25, true, `the long sentence has ${words(LONG)} words`);
  assert.equal(words(SHORT) <= 25, true);
});

test("a whole record refused for one long sentence, then a patch for that one finding, is accepted", () => {
  const dir = runDir();
  try {
    const first = recordSynthesis(dir, { narrative: NARRATIVE, findings: record([SHORT, LONG]) });
    assert.match(String(first.refused), /^synthesis_net_too_long:2 /);
    const patch = { ...record([SHORT, SHORT]).findings[1] };
    const second = recordSynthesis(dir, { findings_patch: [patch] });
    assert.equal(second.refused, null, `the patch was refused: ${second.refused}`);
    // the record is the refused call's, with the one finding corrected
    assert.deepEqual(onDisk(dir).findings.map((f) => f.net), [SHORT, SHORT]);
    assert.match(readFileSync(join(dir, NARRATIVE_FILE), "utf8"), /enumerated to completeness on the named band/,
      "the narrative the refused call carried did not survive the merge");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the merged record is checked whole: a second long sentence the first refusal did not name refuses the patch", () => {
  const dir = runDir();
  try {
    assert.match(String(recordSynthesis(dir, { narrative: NARRATIVE, findings: record([LONG, LONG]) }).refused), /^synthesis_net_too_long:1 /);
    const fixOne = recordSynthesis(dir, { findings_patch: [record([SHORT, LONG]).findings[0]] });
    assert.match(String(fixOne.refused), /^synthesis_net_too_long:2 /, "a patch onto a refused record was checked on its own finding only");
    // and the next patch merges onto that refused patch, so finding 1's correction is kept
    const fixTwo = recordSynthesis(dir, { findings_patch: [record([SHORT, SHORT]).findings[1]] });
    assert.equal(fixTwo.refused, null, String(fixTwo.refused));
    assert.deepEqual(onDisk(dir).findings.map((f) => f.net), [SHORT, SHORT]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a patch with no record before it is refused as before, and so is one after a patch that carried none", () => {
  const dir = runDir();
  try {
    const patch = record([SHORT, SHORT]).findings[0];
    assert.match(String(recordSynthesis(dir, { findings_patch: [patch] }).refused), /^synthesis_patch_without_base:/);
    assert.match(String(recordSynthesis(dir, { findings_patch: [patch] }).refused), /^synthesis_patch_without_base:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a record accepted before the cap still patches finding by finding: its unchanged long sentence is not checked", () => {
  const dir = runDir();
  try {
    assert.equal(recordSynthesis(dir, { narrative: NARRATIVE, findings: record([SHORT, SHORT]) }).refused, null);
    // A run saved before the cap: its accepted record carries a long sentence, and it has no record of its
    // last call, only the accepted one.
    const { accepted, lastReceived } = synthesisCallPaths(dir);
    const stored = JSON.parse(readFileSync(accepted, "utf8"));
    stored.params.findings.findings[0].net = LONG;
    writeFileSync(accepted, JSON.stringify(stored));
    rmSync(lastReceived, { force: true });
    const patch = { ...record([SHORT, SHORT]).findings[1], legal_position: "The earlier registration is live in the searched class." };
    const r = recordSynthesis(dir, { findings_patch: [patch] });
    assert.equal(r.refused, null, `a patch to finding 2 was refused over finding 1's accepted sentence: ${r.refused}`);
    assert.equal(onDisk(dir).findings[0].net, LONG, "the patch merged onto something other than the accepted record");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

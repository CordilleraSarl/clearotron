// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the synthesis save records which findings each accepted call changed, on invented names
//
// EVERY ACCEPTED SAVE RECORDS WHICH FINDINGS IT CHANGED (owner, ruling 719, 2026-10-02).
//
// The post-repair fix pass applies only the flags on findings a repair changed, "read from the repair's own
// record of what it touched". The save writes that record when it accepts a call: the ordinals whose
// finding differs from the accepted record before it. A refused call changes nothing and records nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordSynthesis, readTouched, touchedBetween } from "../synthesis-record.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};

test("touchedBetween names every ordinal that differs, appears or disappears — and nothing else", () => {
  const a = { findings: [{ ordinal: 1, net: "A." }, { ordinal: 2, net: "B." }, { ordinal: 3, net: "C." }] };
  const b = { findings: [{ ordinal: 1, net: "A." }, { ordinal: 2, net: "B, changed." }, { ordinal: 4, net: "D." }] };
  assert.deepEqual(touchedBetween(a, b), [2, 3, 4]);
  assert.deepEqual(touchedBetween(a, a), []);
  assert.deepEqual(touchedBetween(null, { findings: [{ ordinal: 1 }] }), [1], "the first record touches every finding it holds");
});

test("each accepted save appends what it changed; a refused one appends nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "touched-"));
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    const doc = JSON.parse(synthesisFindings(dir));
    assert.equal(recordSynthesis(dir, { narrative: NARRATIVE, findings: doc }).refused, null);
    assert.deepEqual(readTouched(dir).map((e) => e.ordinals), [[1]], "the first save holds finding 1");

    const changed = { ...doc.findings[0], legal_position: `${doc.findings[0].legal_position ?? ""} Renewed in the searched class.`.trim() };
    assert.equal(recordSynthesis(dir, { findings_patch: [changed] }).refused, null);
    assert.deepEqual(readTouched(dir).map((e) => e.ordinals), [[1], [1]], "a patch that changed finding 1 records it");

    assert.equal(recordSynthesis(dir, { actions: doc.actions }).refused, null);
    assert.deepEqual(readTouched(dir).at(-1).ordinals, [], "a save that changed no finding records an empty list");

    const before = readTouched(dir).length;
    const refused = recordSynthesis(dir, { findings_patch: [{ ...changed, net: "One. Two. Three." }] });
    assert.notEqual(refused.refused, null, "premise: the three-sentence net is refused");
    assert.equal(readTouched(dir).length, before, "a refused call recorded a change it never made");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

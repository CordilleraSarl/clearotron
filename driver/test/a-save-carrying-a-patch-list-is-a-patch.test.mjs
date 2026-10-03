// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the synthesis save reading a corrective call's shape, on invented records
//
// A SAVE THAT CARRIES A PATCH LIST IS A PATCH, WHATEVER ELSE IT CARRIES (design, 2026-10-03).
//
// On the first synthesis round the corrective pass sent one call with three parts: the narrative, a patch
// list of the findings it changed, and the record's other sections with no findings list among them. The
// save read the third part as a whole record holding no findings, so every record the run had carried was
// unaccounted and the call was refused; the model then resent the whole record, 73,000 characters on each
// run. Now the patch list patches the findings it names, the sections beside it replace theirs, and every
// finding it does not name stands. A save carrying a findings list is still a whole record, whatever patch
// list it carries, and the refusal for unaccounted records still fires on a whole save that drops findings.
// No line the model reads changes.
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
const URIS = ["/mark/us/91000001", "/mark/us/91000002"];
// The records the judges carried to the findings surface: the save holds the call to account for each.
const OWED = URIS.map((uri, i) => ({ uri, mark: i ? "VELTRIN NOVA" : "VELTRIN", owner: "Qorvalen Holdings", tier: "carried" }));
const DUTY = { owed: OWED, declined: [] };
const LONG = "Qorvalen Holdings' earlier VELTRIN would probably win against your mark for software in the European Union "
  + "because the goods overlap, the marks are near and the earlier right is live on the register today too.";

/** A two-finding record, each finding naming its record. */
function record() {
  const doc = JSON.parse(synthesisFindings(null));
  const one = doc.findings[0];
  return { ...doc, findings: URIS.map((uri, i) => ({ ...one, ordinal: i + 1, mark: OWED[i].mark,
    owner: { ...(one.owner ?? {}), name: "Qorvalen Holdings", registrations: [{ uri }] } })) };
}
/** The record's sections other than its findings list, as the corrective pass sends them. */
const sectionsOf = (doc) => Object.fromEntries(Object.entries(doc).filter(([k]) => k !== "findings"));
function runWithAcceptedRecord() {
  const dir = mkdtempSync(join(tmpdir(), "patch-list-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const doc = record();
  assert.equal(recordSynthesis(dir, { narrative: NARRATIVE, findings: doc }, DUTY).refused, null, "premise: the first save is accepted");
  return { dir, doc };
}
const onDisk = (dir) => JSON.parse(readFileSync(join(dir, FINDINGS_FILE), "utf8"));

test("the corrective shape is a patch: the list patches what it names, the sections replace theirs, the rest stands", () => {
  const { dir, doc } = runWithAcceptedRecord();
  try {
    const changed = { ...doc.findings[0], legal_position: "The earlier registration is live in the searched class and was renewed." };
    const sections = { ...sectionsOf(doc), actions: [] };
    const r = recordSynthesis(dir, {
      narrative: { verdict: `${NARRATIVE.verdict} The earlier owner has used the mark since filing.` },
      findings: sections, findings_patch: [changed] }, DUTY);
    assert.equal(r.refused, null, `the corrective call was refused: ${r.refused}`);
    const after = onDisk(dir);
    assert.equal(after.findings.length, 2, "a finding the list did not name was dropped");
    assert.equal(after.findings[0].legal_position, changed.legal_position, "the named finding was not patched");
    assert.deepEqual(after.findings[1], doc.findings[1], "the finding the list did not name did not stand as it was");
    assert.deepEqual(after.actions, [], "the actions section sent beside the list did not replace its counterpart");
    assert.match(readFileSync(join(dir, NARRATIVE_FILE), "utf8"), /used the mark since filing/, "the narrative section sent was not applied");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a whole save that drops findings is still refused for unaccounted records, in the same words", () => {
  const { dir, doc } = runWithAcceptedRecord();
  try {
    const r = recordSynthesis(dir, { narrative: NARRATIVE, findings: { ...doc, findings: [doc.findings[0]] } }, DUTY);
    assert.match(String(r.refused), /^synthesis_unaccounted_records:1 of 2 — these records reached your findings surface/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the record's sections with no findings list and no patch list still read as a whole record, as before", () => {
  const { dir, doc } = runWithAcceptedRecord();
  try {
    const r = recordSynthesis(dir, { narrative: NARRATIVE, findings: sectionsOf(doc) }, DUTY);
    assert.notEqual(r.refused, null, "a whole save holding no findings was accepted");
    assert.equal(onDisk(dir).findings.length, 2, "a refused save changed the record on disk");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a save carrying a findings list is still a whole record beside a patch list: the cap reads every finding it holds", () => {
  const { dir, doc } = runWithAcceptedRecord();
  try {
    // A record accepted before the cap: its finding 1 carries a sentence over it.
    const { accepted } = synthesisCallPaths(dir);
    const stored = JSON.parse(readFileSync(accepted, "utf8"));
    stored.params.findings.findings[0].net = LONG;
    writeFileSync(accepted, JSON.stringify(stored));
    const whole = { ...doc, findings: [{ ...doc.findings[0], net: LONG }, doc.findings[1]] };
    const r = recordSynthesis(dir, { narrative: NARRATIVE, findings: whole, findings_patch: [] }, DUTY);
    assert.match(String(r.refused), /^synthesis_net_too_long:1 /, `a whole save beside an empty patch list was checked as a patch: ${r.refused}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

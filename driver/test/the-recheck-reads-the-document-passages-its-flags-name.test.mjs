// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RECHECK READS THE DOCUMENT PASSAGES ITS FLAGS NAME.
//
// A flag about the document is a declared target (ruled 2026-10-30): it names a passage, a section or a coverage claim
// and no finding, so a review whose flags do only that is scoped with no finding named. The recheck's opening still
// told that reviewer it had declared which findings its flags were about, and to read the narrative passages "that
// discuss them": with no finding named, the passages its flags identify were nowhere in what it was told to read. The
// opening now names what is in scope, the named findings, the excluded positions and the document passages, with the
// conclusions that depend on the corrections, and says the recorded outcome alone does not prove a correction answers
// its flag (approved 2026-11-04).
//
// Each scope is built as the pipeline builds the recheck's: the review is recorded, `correctionRows` reads its flags,
// and `scopeDrift` compares the record before and after the correction. The expected paragraph is written out here,
// so a change to the composer cannot carry this file's expectation with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths } from "../stages.mjs";
import { writerExclusionBlock, prepareDeclinationSpec, correctionReading, correctionRows } from "../pipeline.mjs";
import { appendDeclinations } from "../declination-tool.mjs";
import { recordRefutation } from "../narrative-refutation-record.mjs";
import { scopeDrift } from "../corrections-feedforward.mjs";
import { repairFollowup } from "../repair-composers.mjs";
import { modelRecordPath } from "../record-fold.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

// One position the finding delivers and one the writer excluded, so a flag can name an excluded position.
const PLACEMENTS = [
  { mark: "QZORVAK", owner: "Alpha Ltd", jurisdiction: "EU", records: ["/mark/eu/a1"], tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
  { mark: "QZORVEX", owner: "Delta AG", jurisdiction: "EU", records: ["/mark/eu/d1"], tier: "sheet-2", reason: "near in sound, live for game accessories" },
];

function seedRun(t) {
  const runDir = mkdtempSync(join(tmpdir(), "recheck-passages-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  writeFileSync(P.placementModel, JSON.stringify({ schema_version: 1, placements: PLACEMENTS }));
  writeFileSync(P.registerFindings, "## Findings\n\n| /mark/eu/a1 | QZORVAK |\n| /mark/eu/d1 | QZORVEX |\n");
  writeFileSync(P.bandShape, JSON.stringify({ floors: { in_class_identical_or_near: [{ record_id: "/mark/eu/a1" }] } }));
  writeFileSync(P.findings, synthesisFindings(runDir).replaceAll("/mark/us/90000001", "/mark/eu/a1"));
  appendDeclinations(runDir, [{ uri: "/mark/eu/d1", reason: "dissimilar-mark", grounds: "A different ending the client's buyers say aloud." }]);
  writerExclusionBlock(P, { review: "full" });   // the full review's list, which a flag's position is checked against
  return P;
}

const NONE = "(no existing finding is named)";
const CASES = [
  { name: "document only", list: NONE, named: [], positions: [],
    flags: [{ kind: "narrative", text: "narrative.md puts the sheet-2 section before the headline candidates" }] },
  { name: "finding and document", list: "#1", named: [1], positions: [],
    flags: [{ kind: "fact", text: "narrative.md misstates the owner of the first finding", on: [1] },
      { kind: "coverage-disposition", text: "narrative.md claims the annex was searched in full" }] },
  { name: "position and document", list: NONE, named: [], positions: ["/mark/eu/d1"],
    flags: [{ kind: "rating", text: "narrative.md drops the QZORVEX position on a sound reading", positions: ["/mark/eu/d1"] },
      { kind: "narrative", text: "narrative.md orders the sheet-2 section first" }] },
];

// The scoped paragraph, written out: the approved opening, then every sentence that followed the old one, unchanged.
const OPENING = (findings, list, narrative) => `The synthesis author applied your flagged corrections. Read narrowly. Named findings in ${findings}: ${list}. Review those findings, the excluded positions your flags name, and the document passages your flags identify in ${narrative}, together with conclusions that depend on the corrections. Judge whether each correction answers its flag; the recorded outcome alone is not proof.`;
const POSITIONS = " For each excluded position your flags named, check the resulting finding or renewed exclusion against the evidence and the specific objection you raised. A newly recorded ground alone does not settle the flag. Retain the flag if its factual error, reasoning error, or relevant uncertainty remains.";
const NONE_MOVED = " THE DRIVER COMPARED EVERY OTHER FINDING OBJECT against the pre-correction file and none moved, so you do not need to re-read them.";
const ONE_MOVED = " THE DRIVER COMPARED EVERY OTHER FINDING OBJECT against the pre-correction file and 1 moved anyway — #1; read those too and say whether the change is defended.";
const REWRITE = (review) => ` Then re-write ${review}: the verdict (CLEAR / CONDITIONAL / BLOCKING) on the FIRST line, then any corrections that still stand.`;
const OLD_OPENING = ["YOU DECLARED WHICH FINDINGS YOUR FLAGS WERE ABOUT", "so read narrowly:", "that discuss them"];

/** The recheck's message, composed with the arguments the pipeline passes it. */
const recheck = (P, correctionsScope) => String(repairFollowup("narrative-refutation:verdict-recheck", {
  narrative: P.narrative, findings: modelRecordPath(P.runDir, P.findings), seniorEyeReview: P.seniorEyeReview,
  correctionsScope, appliedTable: "", restoredTable: "", evidenceTable: "", planAuditCarry: "",
  writerExclusions: writerExclusionBlock(P, { review: "later", named: correctionsScope?.positions ?? [] }),
}));
const scopedParagraph = (text) => text.split("\n").find((l) => l.startsWith("The synthesis author applied your flagged corrections."));
const recheckScope = (P, before, after) => scopeDrift(correctionRows(P, readFileSync(P.seniorEyeReview, "utf8")), before, after);

test("the recheck names the findings, positions and passages in scope, and every sentence after its opening is unchanged", (t) => {
  for (const { name, list, named, positions, flags } of CASES) {
    const P = seedRun(t);
    assert.ok(recordRefutation(P.runDir, { verdict: "BLOCKING", flags }).written, `${name}: the review was not recorded`);
    prepareDeclinationSpec({ paths: P }, P);   // as the pipeline does before the corrective pass
    const record = JSON.parse(readFileSync(P.findings, "utf8"));
    const scope = recheckScope(P, record, record);
    assert.deepEqual([scope.scoped, scope.named, scope.positions ?? []], [true, named, positions], `${name}: the recheck's scope`);
    // That the typed call and the rendered review give one reading of the flags is proved beside the correction's own
    // scope; this holds the recheck's seam to the correction's reading of the same review.
    const { scope: correction } = correctionReading(P);
    assert.deepEqual([scope.scoped, scope.named, scope.positions ?? []], [correction.scoped, correction.ordinals, correction.positions ?? []],
      `${name}: the correction and the recheck read the review's scope differently`);

    const text = recheck(P, scope);
    assert.equal(scopedParagraph(text), OPENING(P.findings, list, P.narrative) + (positions.length ? POSITIONS : "") + NONE_MOVED + REWRITE(P.seniorEyeReview),
      `${name}: the scoped paragraph is not the approved opening followed by the sentences it had`);
    for (const old of OLD_OPENING) assert.ok(!text.includes(old), `${name}: the old opening's "${old}" is still sent`);
    assert.ok(!text.includes("Re-read BOTH updated files"), `${name}: a scoped review was sent the whole re-read`);
  }
});

test("a document-only scope still names a finding that moved outside it, and leaves the rest unread", (t) => {
  const P = seedRun(t);
  assert.ok(recordRefutation(P.runDir, { verdict: "BLOCKING", flags: CASES[0].flags }).written);
  const before = JSON.parse(readFileSync(P.findings, "utf8"));
  const after = { ...before, findings: before.findings.map((f) => (f.ordinal === 1 ? { ...f, band: "Low" } : f)) };
  const scope = recheckScope(P, before, after);
  assert.deepEqual([scope.scoped, scope.named, scope.moved], [true, [], [1]], "the finding no flag named did not read as moved");
  assert.equal(scopedParagraph(recheck(P, scope)), OPENING(P.findings, NONE, P.narrative) + ONE_MOVED + REWRITE(P.seniorEyeReview),
    "the recheck was not told the finding that moved anyway");
});

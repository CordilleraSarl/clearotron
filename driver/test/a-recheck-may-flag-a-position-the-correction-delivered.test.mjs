// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RECHECK MAY FLAG A POSITION THE CORRECTION DELIVERED, AND THE FLAG IS ON THAT FINDING.
//
// A later review is told the positions the full review read as excluded that a finding now delivers, each by its record
// ids ("excluded at the full review, now delivered as a finding"). Its flags were checked only against the exclusions
// that still stand, so a flag naming one of those records was refused. Through the tool the seat was refused; saved as a
// file it had no second chance, so the recheck counted no review, the correction stood unverified and the delivery was
// marked degraded at its checks (measured in testing, 2026-11-16). The record of what the review was shown now keeps
// those positions with the finding that delivers each, and a flag naming one is read as a flag on that finding. A record
// on neither list is refused as before. Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths } from "../stages.mjs";
import { writerExclusionBlock } from "../pipeline.mjs";
import { appendDeclinations } from "../declination-tool.mjs";
import { renderRefutation, settleRecheckSave, recordRefutation, acceptReviewFile, listedExclusionPositions, REVIEW_FILE, REVIEW_EXCLUSIONS_FILE } from "../narrative-refutation-record.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const PLACEMENTS = [
  { mark: "QZORVAK", owner: "Alpha Ltd", jurisdiction: "EU", records: ["/mark/eu/a1"], tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
  { mark: "QZORVEX", owner: "Delta AG", jurisdiction: "EU", records: ["/mark/eu/d1"], tier: "sheet-2", reason: "near in sound, live for game accessories" },
  { mark: "ZORVA", owner: "Epsilon BV", jurisdiction: "EU", records: ["/mark/eu/e1", "/mark/de/e2"], tier: "headline-candidate", reason: "a shared root, live in the class" },
];

/** A run after its full review: a1 delivered as finding 1, d1 and e1 excluded by the writer. */
function seedRun(t) {
  const runDir = mkdtempSync(join(tmpdir(), "recheck-withdrawn-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  writeFileSync(P.placementModel, JSON.stringify({ schema_version: 1, placements: PLACEMENTS }));
  writeFileSync(P.registerFindings, "## Findings\n\n| /mark/eu/a1 | QZORVAK |\n| /mark/eu/d1 | QZORVEX |\n| /mark/eu/e1 | ZORVA |\n");
  writeFileSync(P.bandShape, JSON.stringify({ floors: { in_class_identical_or_near: [] } }));
  writeFileSync(P.findings, synthesisFindings(runDir).replaceAll("/mark/us/90000001", "/mark/eu/a1"));
  appendDeclinations(runDir, [
    { uri: "/mark/eu/d1", reason: "dissimilar-mark", grounds: "A different ending the client's buyers say aloud." },
    { uri: "/mark/eu/e1", reason: "unrelated-goods", grounds: "Registered for printer cartridges only, read in full." },
  ]);
  writerExclusionBlock(P, { review: "full" });
  return P;
}

/** The correction delivers the ZORVA position as finding 2, as the run measured delivered one as finding 11. */
function deliverAsFinding2(P) {
  const doc = JSON.parse(readFileSync(P.findings, "utf8"));
  const second = structuredClone(doc.findings[0]);
  second.ordinal = 2;
  second.mark = "ZORVA";
  second.owner = { ...second.owner, name: "Epsilon BV", registrations: [{ uri: "/mark/eu/e1" }] };
  doc.findings.push(second);
  writeFileSync(P.findings, JSON.stringify(doc));
}

const FLAG = { kind: "rating", text: "narrative.md rates ZORVA Manageable on goods the record does not list", positions: ["/mark/eu/e1"] };

test("a recheck saved as a file that flags a position the correction delivered is read, not refused", (t) => {
  const P = seedRun(t);
  deliverAsFinding2(P);
  const later = writerExclusionBlock(P, { review: "later" });
  assert.ok(later.lines.includes("- ZORVA — Epsilon BV (/mark/eu/e1, /mark/de/e2): excluded at the full review, now delivered as a finding"),
    `guard: the later review was not told the delivered position: ${later.lines.join(" | ")}`);
  const before = "CONDITIONAL\n\nNo flags raised.\n";
  writeFileSync(join(P.runDir, REVIEW_FILE), before);
  writeFileSync(join(P.runDir, REVIEW_FILE), renderRefutation("CONDITIONAL", [{ ...FLAG, on: [] }], null));
  const s = settleRecheckSave(P.runDir, { before, stageOk: true, seq0: 1 });
  assert.equal(s.fail, null, `the recheck counted no review: ${s.fail}`);
  assert.deepEqual(s.read, { by: "file", seq: null });
});

test("the flag is read as a flag on the finding that delivers the position, by the file and by the tool alike", (t) => {
  const P = seedRun(t);
  deliverAsFinding2(P);
  writerExclusionBlock(P, { review: "later" });
  const shown = JSON.parse(readFileSync(driverDir(P.runDir, REVIEW_EXCLUSIONS_FILE), "utf8"));
  assert.deepEqual(shown.withdrawn, [{ uri: "/mark/eu/e1", members: ["/mark/eu/e1", "/mark/de/e2"], ordinals: [2] }],
    "the record of what the review was shown does not keep the delivered position with its finding");

  // Saved as a file: the typed values carry the finding, and the other record id of the same position reads the same.
  const rules = { positionsListed: listedExclusionPositions(P.runDir),
    withdrawnListed: new Map([["/mark/eu/e1", { uri: "/mark/eu/e1", ordinals: [2] }], ["/mark/de/e2", { uri: "/mark/eu/e1", ordinals: [2] }]]) };
  for (const id of ["/mark/eu/e1", "/mark/de/e2"]) {
    const file = acceptReviewFile(renderRefutation("CONDITIONAL", [{ ...FLAG, on: [], positions: [id] }], null), rules);
    assert.equal(file.ok, true, file.reason);
    assert.deepEqual([file.flags[0].ordinals, file.flags[0].positions ?? null], [[2], null], `${id}: not read as a flag on finding 2`);
  }

  // Through the tool: accepted, and the rendered review declares finding 2 rather than a position no list holds.
  const rec = recordRefutation(P.runDir, { verdict: "CONDITIONAL", flags: [FLAG] });
  assert.ok(rec.written, String(rec.refused));
  const review = readFileSync(join(P.runDir, REVIEW_FILE), "utf8");
  assert.match(review, /\[on: 2\] narrative\.md rates ZORVA/);
  assert.doesNotMatch(review, /\[positions:/);
});

test("a record on neither list is still refused, by the file and by the tool", (t) => {
  const P = seedRun(t);
  deliverAsFinding2(P);
  writerExclusionBlock(P, { review: "later" });
  const before = "CONDITIONAL\n\nNo flags raised.\n";
  writeFileSync(join(P.runDir, REVIEW_FILE), renderRefutation("CONDITIONAL", [{ ...FLAG, on: [], positions: ["/mark/eu/z9"] }], null));
  const s = settleRecheckSave(P.runDir, { before, stageOk: true, seq0: 1 });
  assert.match(String(s.fail), /^file-save-refused:refutation_flag_position_unlisted:0:\/mark\/eu\/z9/);
  const rec = recordRefutation(P.runDir, { verdict: "CONDITIONAL", flags: [{ ...FLAG, positions: ["/mark/eu/z9"] }] });
  assert.match(String(rec.refused), /^refutation_flag_position_unlisted:0:\/mark\/eu\/z9/);
  // The exclusion that still stands is still a position, as before.
  const kept = recordRefutation(P.runDir, { verdict: "CONDITIONAL", flags: [{ ...FLAG, positions: ["/mark/eu/d1"] }] });
  assert.ok(kept.written, String(kept.refused));
  assert.match(readFileSync(join(P.runDir, REVIEW_FILE), "utf8"), /\[on: -\] \[positions: \/mark\/eu\/d1\]/);
});

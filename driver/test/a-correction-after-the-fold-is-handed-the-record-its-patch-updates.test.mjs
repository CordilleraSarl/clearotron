// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — a correction re-armed after the delivery fold, on invented records
//
// A CORRECTION RE-ARMED AFTER THE DELIVERY FOLD IS HANDED THE RECORD ITS PATCH UPDATES.
//
// From the delivery seam on, findings.json is the folded record: a second filing of one conflict joins the first, and
// the findings renumber. The writer's save patches the writer's own record, in its own numbering, and the review's flags
// name findings in that numbering too. A correction re-armed on a later pass was pointed at findings.json, so the
// finding it read under a number was not the one its patch changed under that number. A new finding numbered after the
// last one it read landed on a finding it never saw: on the pure functions, 2026-11-03, findings 1 to 4, two of which
// fold, read as 1 to 3, the next number was 4, and the merge took that row as a replacement of the fourth finding.
//
// The correction, its re-emit, the recheck and the correction after a repair's review are now handed the writer's own
// record while a fold is in force, and the review's list of findings to profile is read from it. These arms reach the
// folded state as a run does: the writer's record accepted and reviewed, the seam's fold, a repair after the seam, and a
// later pass opened with the correction re-armed. They then follow one correction through: an update and an addition,
// what the recheck reads, the next fold, the cards and the workbook, and the same patch sent again.
import { test } from "node:test";
import { driverSource } from "./driver-source.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordSynthesis, lastAcceptedCall } from "../synthesis-record.mjs";
import { parseFindingsJsonLenient } from "../findings-model.mjs";
import { appendDeclinations } from "../declination-tool.mjs";
import { recordRefutation } from "../narrative-refutation-record.mjs";
import { foldFindingsFile, openPass, readFold, modelRecordPath, UNFOLDED_FILE } from "../record-fold.mjs";
import { buildCorrectionsApplied } from "../corrections-feedforward.mjs";
import { paths } from "../stages.mjs";
import { correctionReading, correctionsExtra, correctionRows, correctiveCycleSettledDecision, snapshotFindingsForCorrections,
  writerExclusions, writerExclusionBlock, projectStageInput, reviewProfileSelection } from "../pipeline.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";
const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
// Five positions. The writer delivered the first four, and the second and third are two filings of one conflict, so the
// seam folds them into one finding. The writer declined the fifth.
const OWNERS = [["Halvorne Works", "TESSARIN"], ["Quillmere Ltd", "ODRAVEL"], ["Quillmere Ltd", "ODRAVEL"], ["Pennick Supply", "MARVETTE"],
  ["Brannick Tooling", "ORVANTE"]];
const uri = (i) => `/mark/us/9500000${i + 1}`;
const DECLINED = uri(4);
const FLAGGED = "MARVETTE";

/** The finding for position `i`, under `ordinal`. */
function finding(i, ordinal = i + 1, band = null) {
  const f = structuredClone(JSON.parse(synthesisFindings(null)).findings[0]);
  f.ordinal = ordinal;
  [f.owner.name, f.mark] = OWNERS[i];
  f.owner.registrations[0].uri = uri(i);
  if (f.meters?.mark_similarity) f.meters.mark_similarity.source = uri(i);
  if (band) f.band = band;
  return f;
}
const canon = (v) => (v === null || typeof v !== "object") ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const read = (file) => parseFindingsJsonLenient(readFileSync(file, "utf8"));
const base = (dir) => lastAcceptedCall(dir)?.findings?.findings ?? [];
const byMark = (list, mark) => list.filter((f) => f.mark === mark);

/**
 * A run as it stands when a later pass re-arms the correction: the writer's record of four findings accepted, the full
 * review's two flags recorded (one on the fourth finding, one on the excluded fifth position), the seam's fold, a
 * narrative repair after the seam, and the next pass opened. The corrective cycle's receipt is the first pass's.
 */
function foldedRun(t, { bands = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "correction-after-fold-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  const P = paths(dir);
  writeFileSync(P.placementModel, JSON.stringify({ schema_version: 1, placements: OWNERS.map(([owner, mark], i) => (
    { mark, owner, jurisdiction: "US", records: [uri(i)], tier: "headline-candidate", reason: "identical and live, for the client's own goods" })) }));
  writeFileSync(P.registerFindings, `## Findings\n\n${OWNERS.map(([, mark], i) => `| ${uri(i)} | ${mark} |`).join("\n")}\n`);
  writeFileSync(P.bandShape, JSON.stringify({ floors: { in_class_identical_or_near: [] } }));
  writeFileSync(driverDir(dir, "declination-spec.json"), JSON.stringify({ schema_version: 1, rows: OWNERS.map(([owner, mark], i) => (
    { uri: uri(i), mark, owner, tier: "headline-candidate" })) }) + "\n");
  appendDeclinations(dir, [{ uri: DECLINED, reason: "unrelated-goods", grounds: "An invented ground for the exclusion." }]);
  const record = { ...JSON.parse(synthesisFindings(null)), findings: [0, 1, 2, 3].map((i) => finding(i, i + 1, bands?.[i] ?? null)) };
  assert.equal(recordSynthesis(dir, { narrative: NARRATIVE, findings: record }).refused, null, "the writer's record was refused");
  // The full review, shown the writer's exclusions, flags the fourth finding and the excluded fifth position.
  writerExclusionBlock(P, { review: "full" });
  const rec = recordRefutation(dir, { verdict: "CONDITIONAL", flags: [
    { kind: "fact", text: `narrative.md misstates the goods of the ${FLAGGED} registration`, on: [4] },
    { kind: "coverage-disposition", text: "narrative.md excludes ORVANTE on goods the registration does not cover", positions: [DECLINED] },
  ] });
  assert.ok(rec.written, `the review was refused: ${rec.refused}`);
  const receipt = { shas: { review: sha(P.seniorEyeReview), narrative: sha(P.narrative) } };
  // The delivery seam folds the record, and a narrative repair after it is saved and folded again.
  const seam = foldFindingsFile(dir, P.findings, null, { seam: true });
  assert.deepEqual(seam.merges.map((m) => [m.kept, m.dropped]), [[2, [3]]], "premise: the seam folds the two filings of one conflict");
  assert.equal(recordSynthesis(dir, { narrative: { verdict: `${NARRATIVE.verdict} Repaired after the seam.` } }).refused, null);
  assert.equal(read(P.findings).findings.length, 3, "premise: the repair after the seam left the record folded");
  // The next pass opens, and the corrective cycle re-arms: the narrative it settled has moved.
  openPass(dir);
  assert.equal(correctiveCycleSettledDecision(receipt, { review: sha(P.seniorEyeReview), narrative: sha(P.narrative) }), false,
    "premise: the correction is not re-armed");
  return P;
}

/** The record the correction's message names for the writer to open, read from the message itself. */
function namedRecord(msg) {
  const m = /your earlier work is in \S+ and (\S+) — open them/.exec(msg);
  assert.ok(m, "the correction's message names no record for the writer to open");
  return m[1];
}

/**
 * The writer's patch, as the correction tells it to write one against the record it opened: the flagged finding,
 * found by the flag's own words and sent under the number that record gives it, with its correction; and a finding for
 * the flagged position, under the next number after the highest in that record.
 */
function writersPatch(opened) {
  const target = opened.findings.find((f) => f.mark === FLAGGED);
  const next = Math.max(...opened.findings.map((f) => f.ordinal)) + 1;
  return {
    narrative: { verdict: `${NARRATIVE.verdict} Corrected.` },
    findings: { corrections: { applied: true, note: `${FLAGGED}: goods corrected; ORVANTE: recorded as a finding` } },
    findings_patch: [{ ...target, legal_position: `The corrected legal position for ${FLAGGED}.` }, finding(4, next)],
  };
}

// ── THE HANDOVER ─────────────────────────────────────────────────────────────────────────────────────────────────

test("a correction re-armed after the fold is handed the writer's record, in the numbering its patch and its flags use", (t) => {
  const P = foldedRun(t);
  const reading = correctionReading(P);
  const msg = correctionsExtra(P, null, null, reading);
  const at = namedRecord(msg);
  assert.equal(at, driverDir(P.runDir, UNFOLDED_FILE), "the correction was pointed at the folded record, not the writer's own");
  assert.ok(!msg.includes(P.findings), "the message still names the folded record");
  // The record it opens is the record its patch updates, finding by finding.
  const opened = read(at).findings, patched = base(P.runDir);
  assert.deepEqual(opened.map((f) => f.ordinal), patched.map((f) => f.ordinal), "the record handed over is not in the numbering the patch updates");
  for (const f of opened) {
    const b = patched.find((x) => x.ordinal === f.ordinal);
    assert.deepEqual([f.mark, f.owner.name, f.owner.registrations.map((r) => r.uri), f.legal_position],
      [b.mark, b.owner.name, b.owner.registrations.map((r) => r.uri), b.legal_position], `finding ${f.ordinal} is another finding in the record the patch updates`);
  }
  // The flag's number names the finding its words are about, in the record handed over.
  assert.deepEqual(reading.scope.ordinals, [4]);
  assert.equal(opened.find((f) => f.ordinal === 4)?.mark, FLAGGED, "the flag's number names another finding in the record the writer opens");
  assert.deepEqual(reading.positions, [DECLINED], "the flagged position does not ride the correction");
  // Why it matters: under the fold, the delivered record's numbers name other findings than the writer's.
  const delivered = read(P.findings).findings;
  assert.equal(delivered.find((f) => f.ordinal === 3)?.mark, FLAGGED);
  assert.equal(patched.find((f) => f.ordinal === 3)?.mark, "ODRAVEL", "premise: the fold renumbered the flagged finding");
  assert.ok(patched.some((f) => f.ordinal === Math.max(...delivered.map((d) => d.ordinal)) + 1), "premise: the delivered record's next number is held in the writer's");
});

test("the writer, following that handover, corrects the flagged finding and adds the position's, and every other finding stays", (t) => {
  const P = foldedRun(t);
  const reading = correctionReading(P);
  const before = base(P.runDir);
  const r = recordSynthesis(P.runDir, writersPatch(read(namedRecord(correctionsExtra(P, null, null, reading)))), { correction: reading.positions });
  assert.equal(r.refused, null, `the correction was refused: ${r.refused}`);
  const after = base(P.runDir);
  assert.deepEqual(after.map((f) => [f.ordinal, f.mark]), [[1, "TESSARIN"], [2, "ODRAVEL"], [3, "ODRAVEL"], [4, FLAGGED], [5, "ORVANTE"]],
    "the update or the addition landed on another finding");
  assert.equal(after[3].legal_position, `The corrected legal position for ${FLAGGED}.`, "the flagged finding was not corrected");
  assert.equal(after[4].owner.registrations[0].uri, DECLINED, "the added finding is not the flagged position's");
  for (const o of [1, 2, 3]) assert.equal(canon(after[o - 1]), canon(before[o - 1]), `finding ${o}, which no flag names, moved`);
  // The save comes before this pass's seam: findings.json is the writer's record again, and no fold is in force.
  assert.equal(readFold(P.runDir)?.map ?? null, null, "a fold is still in force after the save");
  assert.equal(modelRecordPath(P.runDir, P.findings), P.findings);
  assert.deepEqual(read(P.findings).findings.map((f) => f.ordinal), [1, 2, 3, 4, 5]);
});

// ── THE RECHECK ──────────────────────────────────────────────────────────────────────────────────────────────────

test("the recheck reads the corrected record in the flags' numbering, with the position delivered", (t) => {
  const P = foldedRun(t);
  const reading = correctionReading(P);
  const pre = snapshotFindingsForCorrections(P, P.runDir);
  assert.equal(recordSynthesis(P.runDir, writersPatch(read(namedRecord(correctionsExtra(P, null, null, reading)))), { correction: reading.positions }).refused, null);
  const rows = correctionRows(P, readFileSync(P.seniorEyeReview, "utf8"));
  const applied = buildCorrectionsApplied(rows, parseFindingsJsonLenient(pre.model.raw), read(modelRecordPath(P.runDir, P.findings)));
  assert.equal(applied[0].outcome, "findings-changed", `the flag on the fourth finding reads ${applied[0].outcome}`);
  assert.deepEqual(applied[0].targets, [FLAGGED], "the recheck's table names another finding for the flag");
  assert.deepEqual(writerExclusions(P).positions, [], "the recheck still reads the position as excluded");
  assert.ok(writerExclusionBlock(P, { review: "later", named: reading.positions }).lines
    .includes(`- ORVANTE — Brannick Tooling (${DECLINED}): excluded at the full review, now delivered as a finding`),
  "the recheck is not told the exclusion it read ended in a finding");
});

test("a correction that saved nothing leaves the fold in force, and the recheck is still handed the writer's record", (t) => {
  const P = foldedRun(t);
  const pre = snapshotFindingsForCorrections(P, P.runDir);
  const at = modelRecordPath(P.runDir, P.findings);
  assert.equal(at, driverDir(P.runDir, UNFOLDED_FILE));
  assert.equal(read(at).findings.find((f) => f.ordinal === 4)?.mark, FLAGGED, "the record the recheck is handed names another finding under the flag's number");
  const applied = buildCorrectionsApplied(correctionRows(P, readFileSync(P.seniorEyeReview, "utf8")), parseFindingsJsonLenient(pre.model.raw), read(at));
  assert.equal(applied[0].outcome, "findings-unchanged");
  assert.deepEqual(applied[0].targets, [FLAGGED]);
});

// ── THE NEXT FOLD, THE CARDS AND THE WORKBOOK ────────────────────────────────────────────────────────────────────

test("the next fold delivers the corrected record: the cards that moved are the corrected and the added, and the workbook reads the position as delivered", async (t) => {
  const P = foldedRun(t);
  const { setAsideRows } = await import("../publish/index.mjs");
  const cards = (n) => projectStageInput(`report-card:${n}`, P.findings);
  const cardsBefore = [1, 2, 3, 4].map(cards);
  assert.equal(cardsBefore[3], null, "premise: the delivered record had no fourth finding");
  assert.ok(setAsideRows(P.runDir).some((r) => r.area.includes("ORVANTE") || r.area.includes(DECLINED)), "premise: the workbook sets the excluded position aside");
  const reading = correctionReading(P);
  assert.equal(recordSynthesis(P.runDir, writersPatch(read(namedRecord(correctionsExtra(P, null, null, reading)))), { correction: reading.positions }).refused, null);
  const seam = foldFindingsFile(P.runDir, P.findings, null, { seam: true });
  assert.deepEqual(seam.merges.map((m) => [m.kept, m.dropped]), [[2, [3]]], "the two filings of one conflict did not fold again");
  const delivered = read(P.findings).findings;
  assert.deepEqual(delivered.map((f) => [f.ordinal, f.mark]), [[1, "TESSARIN"], [2, "ODRAVEL"], [3, FLAGGED], [4, "ORVANTE"]]);
  assert.equal(delivered[2].legal_position, `The corrected legal position for ${FLAGGED}.`, "the delivered record lost the correction");
  assert.deepEqual(readFold(P.runDir).map.modelToFolded, { 1: 1, 2: 2, 3: 2, 4: 3, 5: 4 }, "the fold's map does not follow the corrected record");
  const cardsAfter = [1, 2, 3, 4].map(cards);
  assert.deepEqual(cardsAfter.slice(0, 2), cardsBefore.slice(0, 2), "a card for a finding the correction did not touch reads stale");
  assert.notEqual(cardsAfter[2], cardsBefore[2], "the corrected finding's card does not read stale");
  assert.ok(cardsAfter[3], "the added finding has no card input");
  assert.ok(!setAsideRows(P.runDir).some((r) => r.area.includes("ORVANTE") || r.area.includes(DECLINED)), "the workbook still sets the delivered position aside");
});

// ── THE SAME PATCH AGAIN ─────────────────────────────────────────────────────────────────────────────────────────

test("the same accepted patch, sent again, adds no finding, before the next seam and on a later pass after it", (t) => {
  const P = foldedRun(t);
  const reading = correctionReading(P);
  const patch = writersPatch(read(namedRecord(correctionsExtra(P, null, null, reading))));
  const opts = { correction: reading.positions };
  assert.equal(recordSynthesis(P.runDir, patch, opts).refused, null);
  const once = base(P.runDir);
  assert.equal(recordSynthesis(P.runDir, patch, opts).refused, null, "the same patch, sent again, was refused");
  assert.equal(canon(base(P.runDir)), canon(once), "the same patch, sent again, changed the record");
  // The seam folds the corrected record, and a later pass re-arms the correction: it is handed the writer's record again.
  foldFindingsFile(P.runDir, P.findings, null, { seam: true });
  openPass(P.runDir);
  const again = correctionReading(P);
  const opened = read(namedRecord(correctionsExtra(P, null, null, again)));
  assert.deepEqual(opened.findings.map((f) => f.ordinal), [1, 2, 3, 4, 5], "a later pass handed the folded record over");
  assert.equal(recordSynthesis(P.runDir, patch, { correction: again.positions }).refused, null);
  assert.deepEqual(base(P.runDir).map((f) => f.ordinal), [1, 2, 3, 4, 5], "the same patch added a finding on a later pass");
  assert.equal(byMark(base(P.runDir), "ORVANTE").length, 1);
  // A finding for the position under the next new number is a second one, and it is refused; the record stands.
  const kept = readFileSync(driverDir(P.runDir, "synthesis-calls", "accepted.json"), "utf8");
  const second = recordSynthesis(P.runDir, { findings_patch: [finding(4, 6)] }, { correction: again.positions });
  assert.match(String(second.refused), /^synthesis_patch_ordinal_unknown:6 — /, "a second finding for the position was taken");
  assert.equal(readFileSync(driverDir(P.runDir, "synthesis-calls", "accepted.json"), "utf8"), kept);
  foldFindingsFile(P.runDir, P.findings, null, { seam: true });
  assert.deepEqual(read(P.findings).findings.map((f) => f.mark), ["TESSARIN", "ODRAVEL", FLAGGED, "ORVANTE"]);
});

// ── THE REVIEW'S OWN LIST, AND THE HANDOVERS NO ARM ABOVE DISPATCHES ─────────────────────────────────────────────

test("the review's list of findings to profile is read in the writer's numbering while a fold is in force", (t) => {
  const P = foldedRun(t, { bands: ["Low", "Low", "Low", "High"] });
  const sel = reviewProfileSelection({ paths: P, framework: { bands: [{ label: "High" }, { label: "Medium" }, { label: "Low" }] }, depth: { profileKeptBandRank: 1 } });
  assert.deepEqual(sel.ordinals, [4], "the review was asked to profile the flagged finding under its delivered number");
});

test("the re-emit, the recheck and the correction after a repair's review are each handed the writer's record", () => {
  const src = driverSource("pipeline.mjs");
  assert.match(src, /repairFollowup\("synthesis:corrective-findings", \{ findings: modelRecordPath\(run\.runDir, P\.findings\),/,
    "the re-emit after a correction is pointed at another record");
  assert.match(src, /repairFollowup\("narrative-refutation:verdict-recheck", \{\s*narrative: P\.narrative, findings: modelRecordPath\(run\.runDir, P\.findings\),/,
    "the recheck is pointed at another record");
  assert.match(src, /repairFollowup\("synthesis:post-repair-corrective", \{\s*narrative: P\.narrative, findings: modelRecordPath\(runDir, P\.findings\),/,
    "the correction after a repair's review is pointed at another record");
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the synthesis transport reading a correction that adds a finding, on invented records
//
// A CORRECTION ADDS THE FINDING ITS FLAGS NAME.
//
// A review may flag a position the writer excluded, and the correction answering it is told to record it as a finding
// or keep its exclusion, in one patch. A row on an ordinal the record did not hold was refused, so the correction could
// not record that finding: on a test run, 2026-10-31, every call carrying the writer's new findings was refused, and the
// recheck flagged the same positions again. The driver now hands the positions the correction's flags name to the
// writer's save with that correction's dispatch, and a row adding a current finding for one of them is added. A call
// handed none adds nothing, whatever review is on disk; one finding is added per position; a withdrawn row adds
// nothing; the exclusion stays in the ledger; and the recheck and the workbook read the position as delivered while the
// finding stands. A patch the record cannot take for its rows is refused for the first such row, and the record stands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordSynthesis, FINDINGS_FILE, NARRATIVE_FILE } from "../synthesis-record.mjs";
import { parseFindingsJson } from "../findings-model.mjs";
import { appendDeclinations } from "../declination-tool.mjs";
import { paths } from "../stages.mjs";
import { writerExclusions, writerExclusionBlock } from "../pipeline.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
// Four positions: the writer delivered the first three and declined the fourth.
const OWNERS = [["Halvorne Works", "TESSARIN"], ["Quillmere Ltd", "ODRAVEL"], ["Pennick Supply", "MARVETTE"], ["Brannick Tooling", "ORVANTE"]];
const uri = (i) => `/mark/us/9400000${i + 1}`;
const DECLINED = uri(3);

/** The finding for position `i`, under `ordinal`. */
function finding(i, ordinal = i + 1) {
  const f = structuredClone(JSON.parse(synthesisFindings(null)).findings[0]);
  f.ordinal = ordinal;
  [f.owner.name, f.mark] = OWNERS[i];
  f.owner.registrations[0].uri = uri(i);
  if (f.meters?.mark_similarity) f.meters.mark_similarity.source = uri(i);
  return f;
}
const record = () => ({ ...JSON.parse(synthesisFindings(null)), findings: [0, 1, 2].map((i) => finding(i)) });

const dirs = [];
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/**
 * A run whose writer delivered three positions and declined the fourth. `entry` makes the fourth an entry of two
 * records; `review` leaves an accepted review on disk flagging the fourth, which grants nothing by itself.
 */
function run({ entry = false, review = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "correction-adds-"));
  dirs.push(dir);
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "declination-spec.json"), JSON.stringify({ schema_version: 1, rows: OWNERS.map(([owner, mark], i) => ({
    uri: uri(i), mark, owner, tier: "headline-candidate", ...(entry && i === 3 ? { uris: [uri(3), uri(4)] } : {}) })) }) + "\n");
  appendDeclinations(dir, [{ uri: DECLINED, reason: "unrelated-goods", grounds: "An invented ground for the exclusion." }]);
  const first = recordSynthesis(dir, { narrative: NARRATIVE, findings: record() });
  assert.equal(first.refused, null, `the writer's record was refused: ${first.refused}`);
  if (review) {
    mkdirSync(driverDir(dir, "refutation-calls"), { recursive: true });
    writeFileSync(driverDir(dir, "refutation-calls", "call-001.json"), JSON.stringify({ seq: 1, accepted: true, params: { verdict: "BLOCKING", flags: [
      { kind: "coverage-disposition", text: "The exclusion of ORVANTE rests on goods the registration does not cover.", positions: [DECLINED] }] } }) + "\n");
  }
  return dir;
}

const onDisk = (dir) => JSON.parse(readFileSync(join(dir, FINDINGS_FILE), "utf8"));
const held = (dir) => ({ findings: readFileSync(join(dir, FINDINGS_FILE), "utf8"), narrative: readFileSync(join(dir, NARRATIVE_FILE), "utf8"),
  accepted: readFileSync(driverDir(dir, "synthesis-calls", "accepted.json"), "utf8"), ledger: readFileSync(driverDir(dir, "declinations.json"), "utf8") });
const corrected = () => ({ ...finding(1), legal_position: "The second, corrected." });
const MARKER = { applied: true, note: "ODRAVEL: corrected; ORVANTE: recorded as a finding" };
const CORRECTION = { correction: [DECLINED] };
const UNKNOWN = (o) => new RegExp(`^synthesis_patch_ordinal_unknown:${o} — this row neither updates an existing finding nor adds a finding allowed by this correction\\. Use the existing finding's ordinal for an update\\. Add a new finding only for an excluded position named in this correction's flags that no current finding delivers\\. The added finding must not be withdrawn and must cite a record from that position\\.$`);

/** Refused with this text, and nothing the run holds was written. */
function refusesUnchanged(dir, call, opts, re, what) {
  const before = held(dir);
  const r = recordSynthesis(dir, call, opts);
  assert.match(String(r.refused), re, `${what}: refused with another text, or accepted`);
  assert.deepEqual(held(dir), before, `${what}: a refused call changed what the run holds`);
}

// The shapes a correction sends, the first as the live writer sent it: changed sections, the marker, a corrected
// finding and a new one numbered after the last.
const SHAPES = [
  ["beside changed sections and the marker", () => ({ narrative: { verdict: `${NARRATIVE.verdict} Corrected.` }, findings: { corrections: MARKER }, findings_patch: [corrected(), finding(3, 4)] })],
  ["beside the marker, with no narrative", () => ({ findings: { corrections: MARKER }, findings_patch: [corrected(), finding(3, 4)] })],
  ["as the call's only rows", () => ({ findings_patch: [finding(3, 4)] })],
  ["inside the findings object", () => ({ findings: { corrections: MARKER, findings_patch: [finding(3, 4)] } })],
];

for (const [what, call] of SHAPES) {
  test(`a correction's patch adds the finding for the excluded position its flags name: ${what}`, () => {
    const dir = run();
    const before = onDisk(dir), ledger = held(dir).ledger;
    const r = recordSynthesis(dir, call(), CORRECTION);
    assert.equal(r.refused, null, `the correction was refused: ${r.refused}`);
    const after = onDisk(dir);
    assert.deepEqual(after.findings.map((f) => f.ordinal), [1, 2, 3, 4], "the added finding is not in ordinal order after the others");
    assert.equal(after.findings[3].owner.registrations[0].uri, DECLINED, "the added finding is not the flagged position's");
    for (const o of [1, 3]) assert.deepEqual(after.findings[o - 1], before.findings[o - 1], `finding ${o}, which the correction did not name, moved`);
    if (call().findings_patch?.length > 1) assert.equal(after.findings[1].legal_position, "The second, corrected.", "the corrected finding was not applied");
    assert.equal(held(dir).ledger, ledger, "the writer's exclusion was rewritten: it stays in the ledger as history");
  });
}

test("a finding naming any record of a flagged entry is added, whichever record the flag and the finding name", () => {
  for (const [named, cited] of [[uri(3), uri(4)], [uri(4), uri(3)]]) {
    const dir = run({ entry: true });
    const row = finding(3, 4);
    row.owner.registrations[0].uri = cited;
    const r = recordSynthesis(dir, { findings_patch: [row] }, { correction: [named] });
    assert.equal(r.refused, null, `named ${named}, cited ${cited}: refused: ${r.refused}`);
    assert.equal(onDisk(dir).findings.length, 4);
  }
});

// ── THE PERMISSION IS THE CORRECTION'S, AND ENDS WITH IT ─────────────────────────────────────────────────────────

test("a call handed no positions adds nothing, though an accepted review flagging the position is still on disk", () => {
  const dir = run({ review: true });
  for (const [what, call] of SHAPES) refusesUnchanged(dir, call(), {}, UNKNOWN(4), `no positions handed, ${what}`);
  refusesUnchanged(dir, { findings_patch: [finding(3, 4)] }, { correction: null }, UNKNOWN(4), "positions handed as null");
  refusesUnchanged(dir, { findings_patch: [finding(3, 4)] }, { correction: [] }, UNKNOWN(4), "an empty list of positions");
});

test("a correction adds only for a position its flags name that the writer excluded", () => {
  const dir = run();
  // The fourth position, named by no flag of this correction.
  refusesUnchanged(dir, { findings_patch: [finding(3, 4)] }, { correction: [uri(0)] }, UNKNOWN(4), "a position the flags did not name");
  // A position the flags name that no ledger entry declines: it is delivered, not excluded.
  refusesUnchanged(dir, { findings_patch: [{ ...finding(0, 4), legal_position: "A second finding for the first position." }] }, { correction: [uri(0)] },
    UNKNOWN(4), "a delivered position the flags name");
  // A row naming a record of no position.
  const stray = finding(3, 4);
  stray.owner.registrations[0].uri = "/mark/us/94000009";
  refusesUnchanged(dir, { findings_patch: [stray] }, CORRECTION, UNKNOWN(4), "a record of no position");
});

test("a withdrawn finding is not an addition: it cannot deliver the position", () => {
  const dir = run();
  const row = { ...finding(3, 4), disposition: "withdrawn", withdrawn_reason: "an invented review flag" };
  refusesUnchanged(dir, { findings_patch: [row] }, CORRECTION, UNKNOWN(4), "a withdrawn row");
});

// ── ONE FINDING PER POSITION, THROUGH RETRIES AND INTERRUPTION ───────────────────────────────────────────────────

test("a retry against the same worklist adds no second finding: the finding it added is changed by its own ordinal", () => {
  const dir = run();
  assert.equal(recordSynthesis(dir, { findings_patch: [finding(3, 4)] }, CORRECTION).refused, null);
  // The same finding again under the next ordinal, as a retry or a resumed correction might send it.
  refusesUnchanged(dir, { findings_patch: [finding(3, 5)] }, CORRECTION, UNKNOWN(5), "the added finding sent again under a new ordinal");
  refusesUnchanged(dir, { narrative: { verdict: `${NARRATIVE.verdict} Again.` }, findings: { corrections: MARKER }, findings_patch: [finding(3, 5)] }, CORRECTION,
    UNKNOWN(5), "the same, beside changed sections and the marker");
  // Sent again under the ordinal it was added at, it replaces itself.
  const again = { ...finding(3, 4), legal_position: "The added finding, corrected on a retry." };
  assert.equal(recordSynthesis(dir, { findings_patch: [again] }, CORRECTION).refused, null);
  const after = onDisk(dir);
  assert.deepEqual(after.findings.map((f) => f.ordinal), [1, 2, 3, 4], "a second finding was added for the position");
  assert.equal(after.findings[3].legal_position, again.legal_position);
});

test("one call adds one finding per position: a second row for it is refused, and nothing is written", () => {
  const dir = run();
  refusesUnchanged(dir, { findings_patch: [finding(3, 4), { ...finding(3, 5), legal_position: "A second finding for the same position." }] }, CORRECTION,
    UNKNOWN(5), "two new findings for one position");
});

test("a position whose only finding is withdrawn is excluded again, and the correction may add for it", () => {
  const dir = run();
  assert.equal(recordSynthesis(dir, { findings_patch: [finding(3, 4)] }, CORRECTION).refused, null);
  const withdrawn = { ...finding(3, 4), disposition: "withdrawn", withdrawn_reason: "an invented review flag" };
  assert.equal(recordSynthesis(dir, { findings_patch: [withdrawn] }, CORRECTION).refused, null, "the added finding could not be withdrawn by its ordinal");
  assert.equal(recordSynthesis(dir, { findings_patch: [finding(3, 5)] }, CORRECTION).refused, null, "the position, excluded again, took no finding");
  assert.deepEqual(onDisk(dir).findings.map((f) => [f.ordinal, f.disposition === "withdrawn"]), [[1, false], [2, false], [3, false], [4, true], [5, false]]);
});

// ── A PATCH THE RECORD CANNOT TAKE FOR ITS ROWS IS REFUSED FOR THE ROW ───────────────────────────────────────────

test("a patch refused for its rows names the row, keeps the record, and counts none of its rows as ignored", () => {
  const dir = run();
  // As the live correction sent it, without the positions: read as a whole call it was refused for a missing spine,
  // and with the run's records owed, for every record the record it corrected delivers.
  refusesUnchanged(dir, SHAPES[0][1](), {}, UNKNOWN(4), "beside changed sections and the marker");
  refusesUnchanged(dir, { narrative: NARRATIVE, findings: { corrections: MARKER }, findings_patch: [corrected(), finding(3, 4)] }, {}, UNKNOWN(4), "beside a whole narrative");
  // With no narrative, the object replaced the record, and the refusal named a finding it holds.
  refusesUnchanged(dir, SHAPES[1][1](), {}, UNKNOWN(4), "beside the marker, with no narrative");
  // Two different rows under one ordinal, in the parser's words for a list carrying them.
  refusesUnchanged(dir, { findings: { corrections: MARKER }, findings_patch: [corrected(), { ...corrected(), legal_position: "Another." }] }, {},
    /^synthesis_findings_invalid: finding_ordinal_duplicate:2 \(each finding's ordinal must be unique\)$/, "two rows for one ordinal");
  const log = (() => { try { return readFileSync(driverDir(dir, "run.jsonl"), "utf8"); } catch { return ""; } })();
  assert.ok(!/"event":"synthesis-call-normalised"[^\n]*"rowsIgnored":[1-9]/.test(log), "a refused patch's rows were logged as ignored");
});

test("the words for two rows under one ordinal are the parser's own for a list carrying them", () => {
  const doc = record();
  doc.findings = [doc.findings[0], doc.findings[1], { ...doc.findings[2], ordinal: 2 }];
  assert.throws(() => parseFindingsJson(JSON.stringify(doc)), (e) => String(e.message) === "finding_ordinal_duplicate:2 (each finding's ordinal must be unique)");
});

// ── THE RECHECK AND THE WORKBOOK READ THE POSITION'S CURRENT FATE ────────────────────────────────────────────────
//
// The finding the transport added, not a hand-built record: while it stands, the later review is told the exclusion
// it read ended in a finding and lists the position as no exclusion, and the workbook's set-aside sheet leaves it out;
// the ledger still holds the exclusion. Withdrawn, the finding delivers nothing, and the position is the writer's
// exclusion again on both.

/** Whether the workbook's set-aside sheet lists the fourth position, by its name or its record. */
const setAside = (rows) => rows.some((r) => r.area.includes("ORVANTE") || r.area.includes(DECLINED));

function reviewedRun(t) {
  const dir = mkdtempSync(join(tmpdir(), "correction-adds-fate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  const P = paths(dir);
  writeFileSync(P.placementModel, JSON.stringify({ schema_version: 1, placements: OWNERS.map(([owner, mark], i) => (
    { mark, owner, jurisdiction: "US", records: [uri(i)], tier: "headline-candidate", reason: "identical and live, for the client's own goods" })) }));
  writeFileSync(P.registerFindings, `## Findings\n\n${OWNERS.map(([, mark], i) => `| ${uri(i)} | ${mark} |`).join("\n")}\n`);
  writeFileSync(P.bandShape, JSON.stringify({ floors: { in_class_identical_or_near: [] } }));
  writeFileSync(driverDir(dir, "declination-spec.json"), JSON.stringify({ schema_version: 1, rows: OWNERS.map(([owner, mark], i) => ({ uri: uri(i), mark, owner, tier: "headline-candidate" })) }) + "\n");
  appendDeclinations(dir, [{ uri: DECLINED, reason: "unrelated-goods", grounds: "An invented ground for the exclusion." }]);
  assert.equal(recordSynthesis(dir, { narrative: NARRATIVE, findings: record() }).refused, null);
  assert.deepEqual(writerExclusions(P).positions.map((p) => p.uri), [DECLINED], "premise: the full review reads the fourth position as excluded");
  writerExclusionBlock(P, { review: "full" });
  return P;
}

test("while the added finding stands, the recheck and the workbook read the position as delivered, and the ledger keeps the exclusion", async (t) => {
  const P = reviewedRun(t);
  const { setAsideRows } = await import("../publish/index.mjs");
  const ledger = readFileSync(driverDir(P.runDir, "declinations.json"), "utf8");
  assert.ok(setAside(setAsideRows(P.runDir)), "premise: the workbook sets the excluded position aside");
  assert.equal(recordSynthesis(P.runDir, { findings: { corrections: MARKER }, findings_patch: [finding(3, 4)] }, CORRECTION).refused, null);
  assert.deepEqual(writerExclusions(P).positions, [], "the recheck still reads the position as excluded");
  assert.ok(writerExclusionBlock(P, { review: "later" }).lines.includes(`- ORVANTE — Brannick Tooling (${DECLINED}): excluded at the full review, now delivered as a finding`),
    "the recheck is not told the exclusion it read ended in a finding");
  assert.ok(!setAside(setAsideRows(P.runDir)), "the workbook still sets the delivered position aside");
  assert.equal(readFileSync(driverDir(P.runDir, "declinations.json"), "utf8"), ledger, "the exclusion was rewritten as though it never happened");
});

test("a refused addition changes nothing, and a withdrawn finding leaves the position the writer's exclusion", async (t) => {
  const P = reviewedRun(t);
  const { setAsideRows } = await import("../publish/index.mjs");
  const before = readFileSync(join(P.runDir, FINDINGS_FILE), "utf8");
  assert.match(String(recordSynthesis(P.runDir, { findings_patch: [finding(3, 4)] }).refused), UNKNOWN(4), "an addition with no positions handed was taken");
  assert.equal(readFileSync(join(P.runDir, FINDINGS_FILE), "utf8"), before);
  assert.deepEqual(writerExclusions(P).positions.map((p) => p.uri), [DECLINED]);
  assert.equal(recordSynthesis(P.runDir, { findings_patch: [finding(3, 4)] }, CORRECTION).refused, null);
  const withdrawn = { ...finding(3, 4), disposition: "withdrawn", withdrawn_reason: "an invented review flag" };
  assert.equal(recordSynthesis(P.runDir, { findings_patch: [withdrawn] }, CORRECTION).refused, null);
  assert.deepEqual(writerExclusions(P).positions.map((p) => p.uri), [DECLINED], "a withdrawn finding delivered the position to the recheck");
  assert.ok(setAside(setAsideRows(P.runDir)), "a withdrawn finding took the position off the workbook's set-aside sheet");
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FINDING WRITTEN ON GOODS THE REGISTER CUT IS HANDED THE WHOLE TEXT.
//
// A writer reads a record's goods as the band holds them, and the register's search answer can hold a long statement
// cut. The record's whole body can arrive after the writer wrote, during doubt closure or at the record closure just
// before the pre-delivery check. Measured 2026-11-03 on both engines: findings said a class was "cut and unread" while
// the run went on to fetch it whole, and nothing read the finding again. The check names each such finding, with the
// whole statements, for the writer's one repair at that check. Every name here is invented.
import { test } from "node:test";
import { driverSource } from "./driver-source.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { goodsHeldWholeChecks, claimsGoodsCut, goodsRepairLine } from "../predelivery-lint.mjs";
import { citingModelOrdinal, keptModelOrdinal, foldFindingsFile, readFold, modelRecordPath } from "../record-fold.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
const URI = "/mark/us/tm_invented-velquarin";
const OTHER = "/mark/us/tm_invented-other";
const C42 = "Providing scientific research in the field of invented compounds; providing information about invented compounds";
const C44 = "Providing information about invented treatments; providing health information";

const body = ({ truncated = false } = {}) => ({ _uri: URI, _raw: { classifications: [
  { nice_class: 42, goods_services_text: C42, goods_services_text_truncated: truncated },
  { nice_class: 44, goods_services_text: C44, goods_services_text_truncated: truncated },
] } });
const CUT = "Its research clauses are limited to invented uses. A further clause after the limit is cut and unread.";
const finding = (ordinal, uri = URI, extra = {}) => ({ ordinal, mark: "VELQUARIN", owner: { name: "Invented Labs Inc.", registrations: [{ uri }] },
  legal_position: CUT, ...extra });
const asWritten = (state, uri = URI, source = "search-row") => ({ records: [{ uri, state, source, basis: "register-flag" }] });
const run = (over = {}) => goodsHeldWholeChecks({ findings: [finding(7)], goodsEvidence: asWritten("cut"),
  recordsByUri: new Map([[URI, body()]]), ...over });

test("a finding on a record the writer had cut, whose whole body the run holds now, is named with the whole text", () => {
  const [c, ...rest] = run();
  assert.deepEqual(rest.map((x) => [x.id, x.pass]), [["goods-held-whole", true]], "one named finding, then the check's own summary row");
  assert.equal(c.pass, false);
  assert.equal(c.surface, "narrative", "the writer's one repair at the check takes it");
  assert.equal(c.ordinal, 7);
  assert.equal(c.uri, URI);
  // The words design approved for this line (1165), with the delivered number; the repair renders it in the writer's.
  assert.equal(c.detail, `Finding 7 cites ${URI}. Its earlier goods evidence was cut by the register. `
    + `The run now holds these complete goods statements from the register record: Class 42: "${C42}". Class 44: "${C44}". `
    + "Reassess this finding's goods comparison on those statements, and correct any claim that they remain cut or unread. Change its rating only if the evidence requires it.");
  assert.equal(c.finding, undefined, "the line opens with its own finding number, so the repair's list adds none");
  const [unknown] = run({ goodsEvidence: asWritten("unknown") });
  assert.match(unknown.detail, /^Finding 7 cites \S+\. Its earlier goods evidence was of unestablished completeness\. /);
});

test("nothing is named where the held body is still cut, where the run holds none, or where the writer had the goods whole", () => {
  for (const [why, over] of [
    ["the held body says cut", { recordsByUri: new Map([[URI, body({ truncated: true })]]) }],
    ["no body is held", { recordsByUri: new Map() }],
    ["the writer had them whole", { goodsEvidence: asWritten("complete") }],
    ["the writer had an official record", { goodsEvidence: asWritten("complete", URI, "record-body") }],
    ["the finding cites another record", { findings: [finding(7, OTHER)] }],
    ["the finding is withdrawn", { findings: [finding(7, URI, { disposition: "withdrawn" })] }],
    ["the finding says nothing of its goods being cut", { findings: [finding(7, URI, { legal_position: "The owner is likely to lose on the wording." })] }],
  ]) {
    const checks = run(over);
    assert.equal(checks.length, 1, why);
    assert.equal(checks[0].pass, true, why);
    assert.equal(checks[0].detail, "no delivered finding says its goods are cut or unread while the run holds them complete", why);
  }
});

test("a record handed to the repair is not handed again, and its outcome is kept, whatever the numbering", () => {
  // THE WRITER LEFT THE FINDING UNCHANGED: still saying its goods are cut. Unresolved, and no repair takes the row.
  const left = run({ findings: [finding(9)], handed: new Set([URI]) });
  const unresolved = left.find((c) => c.id.startsWith("goods-held-whole-unresolved:"));
  assert.equal(unresolved?.pass, false);
  assert.equal(unresolved.structural, true, "the one repair is not run again for it");
  assert.equal(unresolved.id, `goods-held-whole-unresolved:9:${URI}`);
  assert.equal(left.some((c) => c.id.startsWith("goods-held-whole:")), false, "the record is not handed a second time");
  assert.match(left.at(-1).detail, /^0 finding\(s\) given complete goods statements by the delivery repair no longer say their goods are cut or unread; 1 still do$/);
  // THE WRITER CORRECTED IT: the finding no longer says its goods are cut.
  const fixed = run({ findings: [finding(9, URI, { legal_position: "The owner's class 44 statement covers medical information." })], handed: new Set([URI]) });
  assert.equal(fixed.length, 1);
  assert.equal(fixed[0].pass, true);
  assert.match(fixed[0].detail, /^1 finding\(s\) given complete goods statements by the delivery repair no longer say their goods are cut or unread; 0 still do$/);
  // NO OUTCOME: the record handed is cited by no delivered finding now.
  const gone = run({ findings: [finding(9, OTHER)], handed: new Set([URI]) });
  assert.match(gone.at(-1).detail, /; 1 record\(s\) given to it are cited by no delivered finding, so no outcome is established for them$/);
});

test("the delivery check is given what the writer had and what was handed, and its repair names the writer's numbering", () => {
  // The lint is called inline in pipeline.mjs, so its wiring is pinned in the source.
  const src = driverSource("pipeline.mjs");
  assert.match(src, /goodsEvidence: readGoodsEvidenceAsWritten\(run\.runDir\) \?\? readGoodsEvidence\(run\.runDir\), goodsHanded: readGoodsHanded\(run\.runDir\),/,
    "the check is not given the goods evidence as the writer had it");
  assert.match(src, /const foldUnreadable = fold == null && existsSync\(driverDir\(run\.runDir, FOLD_FILE\)\);/);
  assert.match(src, /const shown = foldUnreadable \? null : keptModelOrdinal\(fold, f\.ordinal\);/);
  assert.match(src, /const citing = shown == null \? null : citingModelOrdinal\(fold, f\.ordinal, f\.uri, writersRecord\(\), citesRecord\);/);
  assert.match(src, /const detail = goodsRepairLine\(\{ shown, citing, uri: f\.uri, goods: f\.goods, state: f\.state \}\);/);
  assert.match(src, /\.map\(inWritersNumbering\)\.filter\(Boolean\)/, "a finding whose line could not be composed was handed anyway");
  assert.match(src, /runLog\(run\.runDir, \{ event: "goods-held-whole-not-handed", unhanded: goodsUnhanded \}\)/);
  assert.match(src, /if \(goodsHandedNow\.length && repaired\.includes\("synthesis"\)\) \{/);
});

test("under a fold, the line names the writer's finding that cites the record, which need not be the member the fold kept", () => {
  // Delivered 7 merges the writer's 8, 9 and 10, and the fold kept 8; delivered 12 merges 14 and 15, and kept 14.
  // Each record is cited, in the writer's record, by one member only. Delivered 3 is the writer's 3, folded with none.
  const fold = { map: { modelToFolded: { 3: 3, 8: 7, 9: 7, 10: 7, 14: 12, 15: 12 }, foldedToModel: { 3: [3], 7: [8, 9, 10], 12: [14, 15] } },
    merges: [{ kept: 8, dropped: [9, 10] }, { kept: 14, dropped: [15] }] };
  const writers = [[3, "/mark/us/tm_invented-a"], [8, "/mark/us/tm_invented-b"], [9, "/mark/us/tm_invented-c"],
    [10, "/mark/us/tm_invented-d"], [14, "/mark/us/tm_invented-e"], [15, "/mark/us/tm_invented-f"]].map(([o, uri]) => finding(o, uri));
  const cites = (wf, uri) => (wf?.owner?.registrations ?? []).some((r) => (r?.uri ?? r) === uri);
  const target = (ordinal, uri) => citingModelOrdinal(fold, ordinal, uri, writers, cites);
  assert.equal(target(7, "/mark/us/tm_invented-c"), 9, "a record a merged member cites names that member");
  assert.equal(target(7, "/mark/us/tm_invented-d"), 10);
  assert.equal(target(12, "/mark/us/tm_invented-f"), 15);
  assert.equal(target(7, "/mark/us/tm_invented-b"), 8, "a record the kept member cites names the kept member");
  assert.equal(target(12, "/mark/us/tm_invented-e"), 14);
  assert.equal(target(3, "/mark/us/tm_invented-a"), 3, "a finding folded with none is its own");
  assert.equal(target(7, "/mark/us/tm_invented-none"), null, "a record no member is read citing was attributed to a member anyway");
  assert.equal(citingModelOrdinal(fold, 7, "/mark/us/tm_invented-c", [], cites), null, "an unread writer's record was taken to show a citation");
  // Both members citing it: the kept member first.
  const both = writers.map((w) => (w.ordinal === 9 ? finding(9, "/mark/us/tm_invented-b") : w));
  assert.equal(citingModelOrdinal(fold, 7, "/mark/us/tm_invented-b", both, cites), 8);
  assert.equal(citingModelOrdinal(null, 7, "/mark/us/tm_invented-c", writers, cites), 7, "no fold in force: the ordinal is its own");
});

test("the finding's own text decides whether it reasoned on a cut statement, read a sentence at a time", () => {
  for (const said of ["The consultancy list is cut, leaving its scope unresolved.", "Class 42 lists a clause before a cut tail.",
    "The end of the wording is cut.", "The cut specification does not establish a narrower boundary."])
    assert.equal(claimsGoodsCut({ legal_position: said }), true, said);
  for (const said of ["US sales were not verified, international designations are unread, and no record was found.",
    "Other lines in the family were not read one by one.", "Prices were cut in 2024.", "The goods overlap in class 5."])
    assert.equal(claimsGoodsCut({ practical_position: said }), false, said);
  assert.equal(claimsGoodsCut({ owner: { name: "Cut Goods Ltd", note: "the list is cut" } }), false, "the owner's own fields are not the finding's reasoning");
});

// ── UNDER A FOLD, THE LINE NAMES THE MEMBER WHOSE TEXT THE REPORT DISPLAYS, AND THE MEMBER THAT CITES THE RECORD ──────
//
// A folded finding is the object of the member the fold kept, carrying every member's citations, so the report displays
// the kept member's text. When another member cites the record, a line naming only that member is answered by a
// correction the report never shows: the next save folds again, and the displayed text still says cut. The line names
// both (design, 2026-11-04), the single-finding line stays where they are one member, and no line is handed where
// either member is not established.
const GOODS = [{ classes: ["42"], text: C42 }, { classes: ["44"], text: C44 }];

test("where the displayed text and the citation come from different members, the line names both, in the approved words", () => {
  assert.equal(goodsRepairLine({ shown: 8, citing: 9, uri: URI, goods: GOODS, state: "cut" }),
    `The displayed goods-text claim comes from finding 8. The grouped finding cites ${URI} through finding 9. `
    + `The run now holds these complete goods statements from that register record: Class 42: "${C42}". Class 44: "${C44}". `
    + "Correct the claim in finding 8 where these statements resolve it. Reassess finding 9's goods comparison only where those statements affect it. "
    + "Change a rating only if the evidence requires it. Preserve unrelated findings and update only conclusions that depend on these changes.");
  assert.equal(goodsRepairLine({ shown: 8, citing: 8, uri: URI, goods: GOODS, state: "cut" }),
    `Finding 8 cites ${URI}. Its earlier goods evidence was cut by the register. `
    + `The run now holds these complete goods statements from the register record: Class 42: "${C42}". Class 44: "${C44}". `
    + "Reassess this finding's goods comparison on those statements, and correct any claim that they remain cut or unread. Change its rating only if the evidence requires it.",
    "one member's line changed");
  for (const [shown, citing] of [[null, 9], [8, null], [null, null], [undefined, 9]])
    assert.equal(goodsRepairLine({ shown, citing, uri: URI, goods: GOODS, state: "cut" }), null, `a line was composed with ${shown}/${citing}`);
});

test("no member is named where the fold's map does not name the finding", () => {
  const fold = { map: { modelToFolded: { 8: 7, 9: 7 }, foldedToModel: { 7: [8, 9] } }, merges: [{ kept: 8, dropped: [9] }] };
  assert.equal(keptModelOrdinal(fold, 12), null, "a finding the map does not name was given a member");
  assert.equal(keptModelOrdinal({ ...fold, merges: [] }, 7), null, "a fold whose kept member is not recorded was given one");
  assert.equal(citingModelOrdinal(fold, 12, URI, [finding(12)], (wf, u) => wf.owner.registrations.some((r) => r.uri === u)), null);
});

// The writer's record, as the mock writer writes it: finding 1 and finding 2 are two filings of one conflict, which the
// seam folds into delivered finding 1 under finding 1's text; finding 3 is another conflict. Finding 1 says its goods
// are cut. `cited` is the member each record belongs to.
const R = { 1: "/mark/us/tm_invented-first-filing", 2: "/mark/us/tm_invented-second-filing", 3: "/mark/us/tm_invented-other-conflict" };
function writersRecord({ twins = [2], cutIn = 1 } = {}) {
  const doc = JSON.parse(synthesisFindings(null));
  const base = doc.findings[0];
  const n = Math.max(3, ...twins);
  doc.findings = Array.from({ length: n }, (_, i) => {
    const f = structuredClone(base);
    f.ordinal = i + 1;
    if (i + 1 !== 1 && !twins.includes(i + 1)) { f.mark = `${base.mark} OTHER`; f.owner.name = `${base.owner.name} Other`; }
    f.owner.registrations = [{ ...base.owner.registrations[0], uri: R[i + 1] ?? `/mark/us/tm_invented-filing-${i + 1}` }];
    if (f.meters?.mark_similarity) f.meters.mark_similarity.source = f.owner.registrations[0].uri;
    if (i + 1 === cutIn) f.legal_position = `${f.legal_position} ${CUT}`;
    return f;
  });
  return doc;
}
const cites = (wf, uri) => (wf?.owner?.registrations ?? []).some((r) => (r?.uri ?? r) === uri);
const withoutCut = (f) => ({ ...f, legal_position: f.legal_position.replace(` ${CUT}`, "") });

/** The seam's fold of the writer's record, the check over the delivered record, and the line in the writer's numbering. */
function atTheSeam(doc, uri) {
  const runDir = mkdtempSync(join(tmpdir(), "goods-fold-"));
  const findingsPath = join(runDir, "findings.json");
  mkdirSync(dirname(driverDir(runDir, "fold.json")), { recursive: true });   // a run has its driver folder before the seam
  writeFileSync(findingsPath, JSON.stringify(doc, null, 2));
  assert.ok(foldFindingsFile(runDir, findingsPath, null, { seam: true }).merges.length > 0, "the seam folded nothing: the scenario is not the one described");
  const delivered = JSON.parse(readFileSync(findingsPath, "utf8")).findings;
  const check = (handed = null) => goodsHeldWholeChecks({ findings: JSON.parse(readFileSync(findingsPath, "utf8")).findings,
    goodsEvidence: asWritten("cut", uri), recordsByUri: new Map([[uri, body()]]), handed });
  const [named] = check();
  const fold = readFold(runDir);
  const writers = JSON.parse(readFileSync(modelRecordPath(runDir, findingsPath), "utf8")).findings;
  const shown = keptModelOrdinal(fold, named.ordinal);
  const line = goodsRepairLine({ shown, citing: citingModelOrdinal(fold, named.ordinal, uri, writers, cites), uri, goods: named.goods, state: named.state });
  /** The writer's save: its record with `edit` applied, written back and folded again, as every save after the seam is. */
  const save = (edit) => {
    writeFileSync(findingsPath, JSON.stringify({ ...doc, findings: writers.map(edit) }, null, 2));
    foldFindingsFile(runDir, findingsPath, null);
    return JSON.parse(readFileSync(findingsPath, "utf8")).findings;
  };
  return { runDir, delivered, named, line, writers, check, save };
}

test("a correction of the member the line names for the claim is what the refolded record delivers, and nothing else moves", () => {
  const s = atTheSeam(writersRecord(), R[2]);
  try {
    assert.deepEqual([s.delivered.length, s.named.id], [2, `goods-held-whole:1:${R[2]}`], "the folded finding was not named for the record");
    assert.ok(s.delivered[0].owner.registrations.some((r) => r.uri === R[2]), "the folded finding does not carry the second filing's record");
    assert.match(s.line, /^The displayed goods-text claim comes from finding 1\. The grouped finding cites \S+ through finding 2\. /);
    assert.match(s.line, /Correct the claim in finding 1 where these statements resolve it\. Reassess finding 2's goods comparison/);
    // THE WRITER CORRECTS FINDING 1, as the line asks.
    const before = structuredClone(s.delivered[1]);
    const after = s.save((f) => (f.ordinal === 1 ? withoutCut(f) : f));
    assert.equal(after.length, 2, "the save did not fold again");
    assert.equal(claimsGoodsCut(after[0]), false, "the delivered finding still says its goods are cut");
    assert.ok(after[0].owner.registrations.some((r) => r.uri === R[2]), "the refolded finding lost the record's citation");
    assert.deepEqual(after[1], before, "a finding the line did not name changed");
    const outcome = s.check(new Set([R[2]]));
    assert.equal(outcome.some((c) => /^goods-held-whole(-unresolved)?:/.test(c.id)), false, "the record was handed again, or left unresolved");
    assert.match(outcome.at(-1).detail, /^1 finding\(s\) given complete goods statements .*; 0 still do$/);
    // THE OLD LINE'S TARGET: a correction of finding 2 alone is not one the report shows, and stays recorded as unresolved.
    const missed = s.save((f) => (f.ordinal === 2 ? { ...f, practical_position: `${f.practical_position ?? ""} Reassessed on the whole statements.` } : f));
    assert.equal(claimsGoodsCut(missed[0]), true);
    assert.deepEqual(s.check(new Set([R[2]])).filter((c) => !c.pass).map((c) => [c.id, c.structural]), [[`goods-held-whole-unresolved:1:${R[2]}`, true]]);
  } finally { rmSync(s.runDir, { recursive: true, force: true }); }
});

test("where the kept member cites the record itself, or several members cite it, the line attributes it truthfully", () => {
  const own = atTheSeam(writersRecord(), R[1]);
  try {
    assert.match(own.line, new RegExp(`^Finding 1 cites ${R[1]}\\. Its earlier goods evidence was cut by the register\\. `), "one member's own record did not get one member's line");
  } finally { rmSync(own.runDir, { recursive: true, force: true }); }
  // Three filings of one conflict, and the record is the second and third filings' own: the first that cites it is named.
  const doc = writersRecord({ twins: [2, 3] });
  for (const f of doc.findings) if (f.ordinal === 3) f.owner.registrations = [{ ...f.owner.registrations[0], uri: R[2] }];
  const many = atTheSeam(doc, R[2]);
  try {
    assert.equal(many.delivered.length, 1, "the three filings did not fold into one finding");
    assert.match(many.line, /^The displayed goods-text claim comes from finding 1\. The grouped finding cites \S+ through finding 2\. /);
    assert.ok(cites(many.writers.find((f) => f.ordinal === 2), R[2]), "the member named does not cite the record");
  } finally { rmSync(many.runDir, { recursive: true, force: true }); }
});

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
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { goodsHeldWholeChecks, claimsGoodsCut } from "../predelivery-lint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
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
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  assert.match(src, /goodsEvidence: readGoodsEvidence\(run\.runDir\), goodsHanded: readGoodsHanded\(run\.runDir\),/);
  assert.match(src, /\? \{ \.\.\.f, detail: goodsHeldWholeDetail\(keptModelOrdinal\(fold, f\.ordinal\), f\.uri, f\.goods, f\.state\) \} : f\)/);
  assert.match(src, /if \(goodsHandedNow\.length && repaired\.includes\("synthesis"\)\) \{/);
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

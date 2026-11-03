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
  assert.equal(rest.length, 0);
  assert.equal(c.pass, false);
  assert.equal(c.surface, "narrative", "the writer's one repair at the check takes it");
  assert.equal(c.ordinal, 7);
  assert.equal(c.uri, URI);
  assert.equal(c.detail, `rests on ${URI}, whose goods you read as the register's search answer cut them. `
    + `The run now holds the register's whole record: Class 42: "${C42}". Class 44: "${C44}". `
    + "Read this finding's goods comparison again on the whole text, and change its rating only if the whole text requires it.");
  const [unknown] = run({ goodsEvidence: asWritten("unknown") });
  assert.match(unknown.detail, /whose goods you read as the register's search answer gave them, not established whole\./);
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
  }
});

test("a record whose whole text was handed to the delivery repair is not named again, whatever the numbering", () => {
  const checks = run({ findings: [finding(9)], handed: new Set([URI]) });
  assert.equal(checks.length, 1);
  assert.equal(checks[0].pass, true);
  assert.match(checks[0].detail, /^1 record\(s\) whose goods the writer had cut had their whole text handed to the delivery repair$/);
});

test("the delivery check is given what the writer had and what was handed, and its repair names the writer's numbering", () => {
  // The lint is called inline in pipeline.mjs, so its wiring is pinned in the source.
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  assert.match(src, /goodsEvidence: readGoodsEvidence\(run\.runDir\), goodsHanded: readGoodsHanded\(run\.runDir\),/);
  assert.match(src, /startsWith\("goods-held-whole:"\) \? \{ \.\.\.f, finding: keptModelOrdinal\(fold, f\.ordinal\) \} : f\)/);
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

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT CITATION THE RUN DOES NOT HOLD IS LEFT OUT AND NAMED IN THE TURN, NOT REFUSED AFTER IT.
//
// A rating that cited something the validator would refuse passed the record tool, finished the chunk, and only then met the
// stage's validator, so the model never heard why and its one retry failed the same way. The record tool now applies the rule to
// every such row at once and keeps the rest of the call, so the chunk is not lost and is not sent again. A filing held under a
// sibling name is held: it may bear on more than one name. All names are invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordKnockoutAssess, knockoutAssessChunkFile } from "../knockout-assess-record.mjs";
import { heldCitationsOnly } from "../verify-knockout.mjs";

const TEMP = [];
const tempRun = () => { const d = mkdtempSync(join(tmpdir(), "knockout-citation-")); TEMP.push(d); mkdirSync(driverDir(d), { recursive: true }); return d; };
after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });

const OWN = "/mark/us/invented-own", SIBLING = "/mark/us/invented-sibling", NOWHERE = "/mark/us/nowhere";
const SIBLING_URL = "https://register.example.test/invented-sibling";
const heldRun = () => {
  const run = tempRun();
  writeFileSync(driverDir(run, "register-records.json"), JSON.stringify({ marks: [
    { name: "LANTERNWICK", records: [{ recordId: OWN }] },
    { name: "ODRAVEL", records: [{ recordId: SIBLING, url: SIBLING_URL }] },
  ] }));
  return run;
};
const mark = (extra = {}) => ({ name: "LANTERNWICK", rating: "High", bullets: ["An invented bullet."], basis: "An invented basis.",
  factors: ["An invented factor.", "Another invented factor."], counterFactors: ["An invented counter."], mitigation: "", contextFraming: "An invented use.",
  assessment: "An invented opening read.", findings: [], ...extra });
const call = (m) => ({ schema_version: 1, framework: { source: "risk-framework-triage.md", ladder: ["High", "Low"] },
  batch: { productContext: "An invented batch.", standardCaveats: "Triage only." }, chunkSummary: "An invented summary.", marks: [m] });
const send = (run, m) => recordKnockoutAssess(run, call(m), { boundOrdinal: 0 });
const NOT_HELD = (id) => `mark "LANTERNWICK": registerReads cites "${id}", which is not a record this run holds. The id must be copied from the filings you were handed — the driver joins it against the store and never takes your word for it`;

const NOT_WEIGHED = (id) => `mark "LANTERNWICK": finding "An invented conflict" lists weighedFilings "${id}", which is not a record this run holds. The source chip is derived from this list, so an id the driver cannot join would put a Register label on a finding with no register evidence`;
const finding = (ids) => ({ ordinal: 1, name: "An invented conflict", owner: "Invented Ltd", band: "High", net: "An invented net.", type: "identical", evidence: [], basis: "An invented basis.", weighedFilings: ids });
const stored = (run) => JSON.parse(readFileSync(knockoutAssessChunkFile(run, 0), "utf8")).marks[0];

test("every row citing what the run does not hold is left out and named at once, and the rest of the call is written", () => {
  const run = heldRun();
  const r = send(run, mark({ registerReads: [{ recordId: NOWHERE, read: "x" }, { recordId: OWN, read: "A kept read." }, { recordId: SIBLING, read: "A sibling's filing, weighed for this name." }],
    findings: [finding([OWN, SIBLING, NOWHERE])] }));
  assert.equal(r.refused, null, r.refused);
  assert.ok(r.written, "the rest of the call was not written");
  assert.deepEqual(r.not_kept, [NOT_HELD(NOWHERE), NOT_WEIGHED(NOWHERE)]);
  const m = stored(run);
  assert.deepEqual(m.registerReads.map((x) => x.recordId), [OWN, SIBLING], "a filing held under a sibling is held");
  assert.deepEqual(m.findings[0].weighedFilings, [OWN, SIBLING]);
  assert.equal(m.basis, "An invented basis.", "the rest of the mark was not kept");
  assert.deepEqual(JSON.parse(readFileSync(r.captured, "utf8")).params?.marks?.[0]?.registerReads?.length, 3, "the call as sent is not on record");
});

test("a finding's source is held the same way: a held filing's own URL under any name, and nothing held nowhere", () => {
  const run = heldRun();
  mkdirSync(join(run, "research"), { recursive: true });
  writeFileSync(join(run, "research", "lanternwick.md"), "A page: https://shop.example.test/own");
  writeFileSync(join(run, "research", "odravel.md"), "A page: https://shop.example.test/sibling-web");
  const r = send(run, mark({ findings: [{ ...finding([]), evidence: ["https://shop.example.test/own", SIBLING_URL, "https://shop.example.test/sibling-web", "https://shop.example.test/nowhere"] }] }));
  assert.deepEqual(stored(run).findings[0].evidence, ["https://shop.example.test/own", SIBLING_URL]);
  assert.equal(r.not_kept.length, 2, "another name's web result traces to no filing, and an address held nowhere is held by no one");
  assert.match(r.not_kept[0], /"https:\/\/shop\.example\.test\/sibling-web", which this run does not hold\./);
});

test("what is stored then passes the stage's own check, so the stage cannot fail on it", () => {
  const run = heldRun();
  send(run, mark({ registerReads: [{ recordId: NOWHERE, read: "An invented read." }] }));
  assert.deepEqual(heldCitationsOnly(run, stored(run)).notKept, [], "a row the rule refuses is still stored");
});

test("a later call sends only what it corrects: the refused row does not come back, and a corrected one is kept", () => {
  const run = heldRun();
  assert.ok(send(run, mark({ registerReads: [{ recordId: NOWHERE, read: "An invented read." }] })).not_kept, "premise: left out first");
  const r = recordKnockoutAssess(run, { marks: [{ name: "LANTERNWICK", registerReads: [{ recordId: OWN, read: "The corrected read." }] }] }, { boundOrdinal: 0 });
  assert.equal(r.refused, null, r.refused);
  assert.equal(r.not_kept, undefined, "the row left out earlier came back");
  const m = stored(run);
  assert.deepEqual(m.registerReads, [{ recordId: OWN, read: "The corrected read." }]);
  assert.equal(m.basis, "An invented basis.", "the first call's values were lost");
});

test("citing nothing costs nothing, and a call with nothing to leave out is unchanged", () => {
  const run = heldRun();
  const clean = mark({ registerReads: [{ recordId: OWN, read: "x" }] });
  const out = heldCitationsOnly(run, clean);
  assert.equal(out.mark, clean);
  assert.deepEqual(out.notKept, []);
  const r = send(tempRun(), mark());
  assert.equal(r.refused, null, r.refused);
  assert.equal(r.not_kept, undefined);
});

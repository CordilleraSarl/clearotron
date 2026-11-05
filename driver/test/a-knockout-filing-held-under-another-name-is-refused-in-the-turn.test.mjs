// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT FILING HELD UNDER ANOTHER NAME IS REFUSED IN THE TURN, NOT AFTER IT.
//
// A rating that cited a filing held under a sibling name passed the record tool, finished the chunk, and only then met the
// stage's validator, so the model never heard why and its one retry failed the same way. The rule stays, in the same words: a
// report is delivered per name. The record tool now applies it while the model can still correct the call. All names are invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordKnockoutAssess, knockoutAssessChunkFile } from "../knockout-assess-record.mjs";
import { registerCitationRefusal } from "../verify-knockout.mjs";

const TEMP = [];
const tempRun = () => { const d = mkdtempSync(join(tmpdir(), "knockout-citation-")); TEMP.push(d); mkdirSync(driverDir(d), { recursive: true }); return d; };
after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });

const OWN = "/mark/us/invented-own", SIBLING = "/mark/us/invented-sibling";
const heldRun = () => {
  const run = tempRun();
  writeFileSync(driverDir(run, "register-records.json"), JSON.stringify({ marks: [
    { name: "LANTERNWICK", records: [{ recordId: OWN }] },
    { name: "ODRAVEL", records: [{ recordId: SIBLING }] },
  ] }));
  return run;
};
const mark = (extra = {}) => ({ name: "LANTERNWICK", rating: "High", bullets: ["An invented bullet."], basis: "An invented basis.",
  factors: ["An invented factor.", "Another invented factor."], counterFactors: ["An invented counter."], mitigation: "", contextFraming: "An invented use.",
  assessment: "An invented opening read.", findings: [], ...extra });
const call = (m) => ({ schema_version: 1, framework: { source: "risk-framework-triage.md", ladder: ["High", "Low"] },
  batch: { productContext: "An invented batch.", standardCaveats: "Triage only." }, chunkSummary: "An invented summary.", marks: [m] });
const send = (run, m) => recordKnockoutAssess(run, call(m), { boundOrdinal: 0 });
const NOT_HELD = (id) => `mark "LANTERNWICK": registerReads cites "${id}", which is not a record this run holds for that mark. The id must be copied from the filings you were handed — the driver joins it against the store and never takes your word for it`;

test("a read of a filing held under another name is refused at the call, nothing is written, and the model is told why", () => {
  const run = heldRun();
  const r = send(run, mark({ registerReads: [{ recordId: SIBLING, read: "An invented read." }] }));
  assert.equal(r.written, null);
  assert.equal(r.refused, NOT_HELD(SIBLING));
  assert.ok(!existsSync(knockoutAssessChunkFile(run, 0)), "a refused call was written");
  assert.ok(r.captured && JSON.parse(readFileSync(r.captured, "utf8")).verdict?.ok !== true, "the capture does not record the refusal");
});

test("a finding that weighed a filing held under another name is refused the same way", () => {
  const run = heldRun();
  const finding = { ordinal: 1, name: "An invented conflict", owner: "Invented Ltd", band: "High", net: "An invented net.", type: "identical", evidence: [], basis: "An invented basis.", weighedFilings: [SIBLING] };
  const r = send(run, mark({ findings: [finding] }));
  assert.match(r.refused ?? "", /finding "An invented conflict" lists weighedFilings "\/mark\/us\/invented-sibling", which is not a record this run holds for that mark/);
});

test("corrected in the same turn, the call is written", () => {
  const run = heldRun();
  assert.ok(send(run, mark({ registerReads: [{ recordId: SIBLING, read: "An invented read." }] })).refused, "premise: refused first");
  const r = send(run, mark({ registerReads: [{ recordId: OWN, read: "An invented read." }] }));
  assert.equal(r.refused, null, r.refused);
  assert.ok(r.written, "the corrected call was not written");
  assert.ok(existsSync(knockoutAssessChunkFile(run, 0)));
});

test("an id held nowhere is refused, citing nothing is free, and a run with no filings refuses only what is cited", () => {
  const run = heldRun();
  assert.equal(registerCitationRefusal(run, mark({ registerReads: [{ recordId: "/mark/us/nowhere", read: "x" }] })), NOT_HELD("/mark/us/nowhere"));
  assert.equal(registerCitationRefusal(run, mark()), null);
  assert.equal(registerCitationRefusal(run, mark({ registerReads: [{ recordId: OWN, read: "x" }] })), null);
  const none = tempRun();
  assert.equal(send(none, mark()).refused, null, "citing nothing on a run with no filings was refused");
  assert.equal(registerCitationRefusal(none, mark({ registerReads: [{ recordId: OWN, read: "x" }] })), NOT_HELD(OWN));
});

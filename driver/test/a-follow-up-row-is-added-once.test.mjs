// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-follow-up-row-is-added-once.test.mjs — the driver's "Follow-up / …" row for a directive the reopen pass left
// open is added once, and not at all where the writer's own coverage already carries the directive.
//
// The guard read the raw directive, whose axis prefix ("source:") no row carries, so it never matched: each seam
// pass added the row again, a record held it twice, and a save that removed it was undone at the next pass. The
// audit workbook then listed one search twice, in the writer's words and in the driver's. Measured on two test
// runs, 2026-11-03: 9 of 9 directives carried the prefix.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { deferralCoverageRow, injectDeferralCoverage } from "../pipeline.mjs";

const COMPANIES = "source:company registers (zefix, edgar, companies house, us state)";
const MEDICINES = "source:medicine-name registers (swissmedic refdata, drugs@fda, purple book, inn)";
const REASON = "source-not-swept";

function run(deferrals, coverage) {
  const dir = mkdtempSync(join(tmpdir(), "follow-up-once-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(driverDir(dir, "frame-reopen.json"), JSON.stringify({ deferrals }));
  const P = { findings: join(dir, "findings.json") };
  writeFileSync(P.findings, JSON.stringify({ schema_version: 2, findings: [], coverage }));
  const pass = () => { injectDeferralCoverage(P, dir, () => {}); return JSON.parse(readFileSync(P.findings, "utf8")).coverage; };
  const save = (rows) => writeFileSync(P.findings, JSON.stringify({ schema_version: 2, findings: [], coverage: rows }));
  return { dir, pass, save };
}
const followUps = (cov) => cov.filter((c) => String(c.area).startsWith("Follow-up / "));

test("a prefixed directive gets its row once, however many passes run", () => {
  const r = run([{ directive: COMPANIES, reason: REASON }], []);
  try {
    assert.equal(followUps(r.pass()).length, 1, "the first pass adds the row");
    const cov = r.pass();
    assert.equal(followUps(cov).length, 1, `a second pass added the row again: ${followUps(cov).length} rows`);
    assert.deepEqual(followUps(cov)[0], deferralCoverageRow(COMPANIES, REASON), "the row is the shipped row, word for word");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("a directive the writer's own row already carries adds no row", () => {
  const writer = [
    { area: "Company registers (Zefix, EDGAR, Companies House, US state registers)", state: "open", note: "Not searched this run." },
    { area: "Medicine-name registers (Swissmedic Refdata, Drugs@FDA, Purple Book, INN)", state: "open", note: "Not searched this run." },
  ];
  const r = run([{ directive: COMPANIES, reason: REASON }, { directive: MEDICINES, reason: REASON }], writer);
  try {
    const cov = r.pass();
    assert.equal(followUps(cov).length, 0, `the writer's rows already disclose both searches, and ${followUps(cov).length} follow-up row(s) were added`);
    assert.deepEqual(cov, writer, "the writer's rows are left as written");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("a removed row comes back once where nothing else discloses the search", () => {
  const r = run([{ directive: COMPANIES, reason: REASON }], []);
  try {
    r.pass();
    r.save([{ area: "Common-law web search", state: "confirmed-clean", note: "Searched." }]);   // a save that drops it
    const cov = r.pass();
    assert.equal(followUps(cov).length, 1, "an undisclosed open search must stay disclosed after a save drops its row");
    assert.equal(followUps(r.pass()).length, 1, "and is not added twice");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

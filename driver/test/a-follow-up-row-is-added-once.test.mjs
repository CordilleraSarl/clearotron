// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-follow-up-row-is-added-once.test.mjs — the driver's "Follow-up / …" row for a directive the reopen pass left
// open is added once, and not at all where the writer's own coverage already carries the directive.
//
// The guard looked for the raw directive's first four long words as one phrase. The axis prefix ("source:") was the
// first of them, and a short word between two others ("eu", "and") broke the phrase anyway, so no row matched, not
// even the driver's own: each seam pass added the row again, a record held it twice, and a save that removed it was
// undone at the next pass. The audit workbook then listed one search twice, in the writer's words and in the
// driver's. Measured on two test runs, 2026-11-03: 9 of 9 directives carried the prefix, and 4 of one run's 7 a short
// word between their long ones. Both shapes are below.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { deferralCoverageRow, injectDeferralCoverage } from "../pipeline.mjs";

const COMPANIES = "source:company registers (zefix, edgar, companies house, us state)";
const MEDICINES = "source:medicine-name registers (swissmedic refdata, drugs@fda, purple book, inn)";
// A short word between the long ones, which a phrase match never finds again.
const SHORT_WORDS = ["source:eu national trademark registers", "source:fda purple book and eu national medicine databases",
  "source:us state trademark registers"];
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

test("a prefixed directive gets its row once, however many passes run, short words between its long ones or not", () => {
  const all = [COMPANIES, MEDICINES, ...SHORT_WORDS];
  const r = run(all.map((directive) => ({ directive, reason: REASON })), []);
  try {
    assert.equal(followUps(r.pass()).length, all.length, "the first pass adds one row for each directive");
    const cov = r.pass();
    assert.equal(followUps(cov).length, all.length, `a second pass added rows again: ${followUps(cov).length} rows for ${all.length} directives`);
    assert.deepEqual(followUps(cov), all.map((d) => deferralCoverageRow(d, REASON)), "the rows are the shipped rows, word for word");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("a directive the writer's own row already carries adds no row", () => {
  const writer = [
    { area: "Company registers (Zefix, EDGAR, Companies House, US state registers)", state: "open", note: "Not searched this run." },
    { area: "Medicine-name registers (Swissmedic Refdata, Drugs@FDA, Purple Book, INN)", state: "open", note: "Not searched this run." },
    { area: "EU national registers", state: "open", note: "The national trademark registers of the member states were not searched." },
  ];
  const r = run([COMPANIES, MEDICINES, SHORT_WORDS[0]].map((directive) => ({ directive, reason: REASON })), writer);
  try {
    const cov = r.pass();
    assert.equal(followUps(cov).length, 0, `the writer's rows already disclose all three searches, and ${followUps(cov).length} follow-up row(s) were added`);
    assert.deepEqual(cov, writer, "the writer's rows are left as written");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("a searched-clean row or a plan unit carrying the words does not stand in for the row", () => {
  // The page's rule (dedupeFollowUps): a completed search never stands in for an uncompleted one, and an
  // axis-labelled plan unit may share the words without restating the gap.
  const writer = [
    { area: "Company registers (Zefix, EDGAR, Companies House, US state)", state: "confirmed-clean", note: "Searched; nothing found." },
    { area: "Register / EU national trademark registers", state: "coverage-limited", note: "Regional rights only." },
  ];
  const r = run([COMPANIES, SHORT_WORDS[0]].map((directive) => ({ directive, reason: REASON })), writer);
  try {
    const cov = r.pass();
    assert.equal(followUps(cov).length, 2, `the open searches lost their disclosure: ${followUps(cov).length} of 2 follow-up rows`);
    assert.equal(followUps(r.pass()).length, 2, "and a second pass adds them again");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("a removed row comes back once where nothing else discloses the search", () => {
  const r = run([{ directive: SHORT_WORDS[1], reason: REASON }], []);
  try {
    r.pass();
    r.save([{ area: "Common-law web search", state: "confirmed-clean", note: "Searched." }]);   // a save that drops it
    const cov = r.pass();
    assert.equal(followUps(cov).length, 1, "an undisclosed open search must stay disclosed after a save drops its row");
    assert.equal(followUps(r.pass()).length, 1, "and is not added twice");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

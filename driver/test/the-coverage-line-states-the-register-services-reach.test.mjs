// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE COVERAGE LINE STATES THE REGISTER SERVICE'S REACH, AND CODE NAMES EVERY MARKET OUTSIDE IT.
//
// A worldwide order's line read "registers: worldwide (Signa)" while the service searches 15 offices, and whether a
// market outside them was named depended on the writer. The line now states the service and its office count and
// names the order's markets outside it, and code writes a "Not searched" row for each of those markets. Both read one
// answer, register-reach.mjs. Every mark, owner and market list here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerReach, NOT_COVERED_REASON } from "../register-reach.mjs";
import { deriveScopeFacts } from "../scope-facts.mjs";
import { injectUncoveredMarketCoverage } from "../pipeline.mjs";
import { paths } from "../run-record.mjs";
import { ensureDriverDir } from "../../shared/driver-dir.mjs";

const MARKETS = ["US", "EU", "GB", "JP", "PH", "ID", "VN"];
const plan = (over = {}) => ({ plan_version: 1, provider: "signa", scope_basis: "worldwide", regions: [], nice_classes: ["9"],
  entries: [{ qid: "q-1", axis: "primary-sweep", predicate: "default", term: "TARNELLO", nice_classes: ["9"], regions: [] }], ...over });
const line = (p, markets) => deriveScopeFacts({ instructedScope: { marks: ["TARNELLO"], classes: [9], jurisdictions: ["worldwide"] }, plan: p,
  planExecution: { executed: [{ qid: "q-1", state: "complete", total_hits: 0 }] }, coverageRows: [], markets });

test("the reach is the service's own office list, and a market is outside it when the list has no office for it", () => {
  assert.deepEqual(registerReach("signa", MARKETS), { service: "Signa", offices: 15, uncovered: ["JP", "PH", "ID", "VN"] });
  assert.deepEqual(registerReach("signa", ["uk", "EM", "Japan", "JP"]).uncovered, ["JP"], "markets fold to one code each, in order");
  assert.equal(registerReach("corsearch", MARKETS), null, "a service that declares no office list has no reach to state");
  assert.equal(registerReach(null, MARKETS), null);
  assert.equal(registerReach("no-such-register", MARKETS), null);
});

test("a worldwide order's line states the service, its office count and the markets outside it", () => {
  const facts = line(plan(), MARKETS);
  assert.match(facts.coverage_line, / · registers: Signa, 15 offices; Japan, Philippines, Indonesia and Vietnam not covered$/);
  assert.deepEqual(facts.register_reach, { service: "Signa", offices: 15, uncovered: ["JP", "PH", "ID", "VN"] }, "the run record keeps the answer");
  assert.match(line(plan(), ["US", "EU"]).coverage_line, / · registers: Signa, 15 offices$/, "every market covered: the line ends after the count");
  assert.match(line(plan({ provider: "corsearch" }), MARKETS).coverage_line, / · registers: worldwide \(Corsearch\)$/, "no office list: the line it had");
  assert.match(line(plan({ provider: "euipo" }), ["EU"]).coverage_line, / · registers: EUIPO, 1 office$/, "one office is one office");
  const named = deriveScopeFacts({ instructedScope: { marks: ["TARNELLO"], classes: [9], jurisdictions: ["us"] },
    plan: plan({ scope_basis: null, regions: ["us"] }), planExecution: { executed: [{ qid: "q-1", state: "complete", total_hits: 0 }] }, coverageRows: [], markets: MARKETS });
  assert.match(named.coverage_line, / · registers: US$/, "a named list keeps its line");
  assert.equal(named.register_reach, undefined);
});

test("code writes one Not searched row per market outside the reach, once, beside whatever the writer wrote", (t) => {
  const runDir = mkdtempSync(join(tmpdir(), "register-reach-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  ensureDriverDir(runDir);
  const demo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "demo", "multi-country-focus-search", "run", "findings.json");
  cpSync(demo, join(runDir, "findings.json"));
  const P = paths(runDir);
  const before = JSON.parse(readFileSync(P.findings, "utf8")).coverage.length;
  writeFileSync(P.registerPlan, JSON.stringify(plan()));
  const ctx = { paths: P, job: { geography: { mode: "worldwide" } }, profile: { defaultJurisdictions: MARKETS } };
  const notes = [];
  injectUncoveredMarketCoverage(P, runDir, (n) => notes.push(n), ctx);
  const rows = JSON.parse(readFileSync(P.findings, "utf8")).coverage;
  const added = rows.slice(before);
  assert.deepEqual(added, ["Japan", "Philippines", "Indonesia", "Vietnam"].map((area) => ({ area, state: "not-searched", note: NOT_COVERED_REASON })));
  injectUncoveredMarketCoverage(P, runDir, (n) => notes.push(n), ctx);
  assert.equal(JSON.parse(readFileSync(P.findings, "utf8")).coverage.length, before + 4, "a second pass doubled a row");
  // Every market covered: nothing is written.
  const covered = { ...ctx, profile: { defaultJurisdictions: ["US", "EU"] } };
  const bytes = readFileSync(P.findings, "utf8");
  injectUncoveredMarketCoverage(P, runDir, () => {}, covered);
  assert.equal(readFileSync(P.findings, "utf8"), bytes);
});

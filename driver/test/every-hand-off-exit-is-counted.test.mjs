// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Every record, and every page the web notes marked as a candidate or conflict, that leaves a clearance
// hand-off with no ground is counted — and a hand-off with no trace says so instead of counting zero. A page
// the web step only read is not owed a ground, and the knockout is outside the check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as exitsModule from "../hand-off-exits.mjs";

const { pickingExits, notesExits, notesMarkedPages, exitsForLog } = exitsModule;
const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

const carryRow = (uri, owner, stopped_at, reason_source, reason) => ({ uri, owner, mark: "SAMPLE", stopped_at, reason_source, reason });

test("the picking step counts a record that left with no ground, and the owners those records belong to", () => {
  const rc = { rows: [
    carryRow("/mark/jp/1", "Owner A", "placement", "step-silent", "placement:not-selected"),
    carryRow("/mark/us/2", "Owner A", "placement", "step-silent", "placement:not-selected"),
    carryRow("/mark/us/3", "Owner B", "placement", "absent", "placement:not-selected"),
    carryRow("/mark/eu/4", "Owner C", "placement", "step-structural", "placement:stage-incomplete"),
    carryRow("/mark/eu/5", "Owner D", "digest", "step-stated", "digest:reasoned-negative"),
    { uri: "/mark/eu/6", owner: "Owner E", reach: "finding" },
  ] };
  const e = pickingExits(rc);
  assert.equal(e.computable, true);
  assert.equal(e.exits, 3, "silent and absent exits at placement; a structural stop states its cause");
  assert.equal(e.owners, 2, "one ground may cover an owner's set, so owners are the grounds owed");
  assert.deepEqual(e.rows.map((r) => r.uri), ["/mark/jp/1", "/mark/us/2", "/mark/us/3"]);
});

test("a missing trace is not computable, never zero", () => {
  for (const [name, e] of [["picking", pickingExits(null)], ["notes", notesExits(null, [])],
    ["notes without findings", notesExits("## Findings\n| a | https://a.example/p |", null)]]) {
    assert.equal(e.computable, false, `${name} read a missing trace as computed`);
    assert.match(e.reason, /^no \w.* — /, `${name} does not say what is missing`);
  }
  assert.deepEqual(exitsForLog({ picking: pickingExits(null) }).picking.computable, false);
});

test("the run-log line carries counts and reasons, never a row", () => {
  const line = exitsForLog({ picking: pickingExits({ rows: [carryRow("/mark/jp/1", "A", "placement", "step-silent")] }),
    notes: notesExits(null, []) });
  assert.deepEqual(line, { picking: { computable: true, exits: 1, owners: 1 },
    notes: { computable: false, reason: line.notes.reason } });
  assert.ok(!JSON.stringify(line).includes("/mark/"), "a record reached the run-log line");
});

// The notes as the manual's template lays them out, anchors included: a summary, the findings section with
// its four categories, then the sections that record what was read.
const ANCHORED = [
  "# Common-law findings — SAMPLE (2026-09-25)",
  "## Summary",
  "- Grid: 3 variants × 2 platforms; see https://summary.example/run",
  "## Findings — Mark: SAMPLE",
  "<!-- clearotron:section=findings -->",
  "### Consumer-confusion risks (gaming-industry overlap)",
  "| Finding | Source / Platform | URL | developer_of_record | publisher_of_record | Type | Notes |",
  "|---|---|---|---|---|---|---|",
  "| Near title | store.example | https://store.example/app/12/Near_Title/ | North Studio | not extracted | Direct conflict — similar title | active |",
  "| Publisher | store.example | https://store.example/publisher/north | North Studio | North Studio | Direct conflict — publisher | indie |",
  "### Commercial awareness (identical/similar in unrelated fields)",
  "| Finding | Source / Platform | URL | Notes |",
  "|---|---|---|---|",
  "| Same word, snacks | shop.example | https://shop.example/p/3 | unrelated goods |",
  "### PR / reputational risk",
  "The word reads benign in every form the sweep surfaced: https://dict.example/word/sample.",
  "### Negative results (per-platform per-variant)",
  "<!-- clearotron:section=negative-results -->",
  "| Variant | Platform | Result |",
  "|---|---|---|",
  "| SAMPLE | store.example | Similar listing(s) found — see Findings (2 candidates) https://store.example/search?q=sample |",
  "### Coverage ledger",
  "<!-- clearotron:section=coverage-ledger -->",
  "| Coverage unit | Status | Reason |",
  "|---|---|---|",
  "| store.example | confirmed-clean | https://store.example/search?q=sampel |",
  "### Cross-checks suggested",
  "- North Studio → register owner sweep (https://north.example/about)",
  "### Audit trail",
  "<!-- clearotron:section=audit-trail -->",
  "| 1 | Grid (sandbox) | https://grid.example/log | 6 cells |",
  "### Open verification flags",
  "- https://gone.example/404 returned 404",
  "## PR / reputational risk — meaning-sweep dispositions (driver-rendered)",
  "| Query | Receipt | Source | Ruling | Note |",
  "|---|---|---|---|---|",
  "| sample meaning | Sample | https://dict.example/word/sample-2 | benign | — |",
].join("\n");

const MARKED = ["store.example/app/12/Near_Title", "store.example/publisher/north", "shop.example/p/3"];

test("the pages the web notes marked are the findings section's rows, found by its anchor", () => {
  const pages = [...notesMarkedPages(ANCHORED).keys()].map((p) => p.replace(/\/$/, ""));
  assert.deepEqual(pages, MARKED,
    "only the candidates and conflicts the notes wrote as findings; never the summary, the matrix, the ledger, "
    + "the cross-checks, the call log, the open flags or a meaning reading that already carries its ruling");
});

test("notes with no anchor, as every archived run has, are read by their headings to the same pages", () => {
  const unanchored = ANCHORED.split("\n").filter((l) => !l.startsWith("<!--")).join("\n");
  assert.deepEqual([...notesMarkedPages(unanchored).keys()].map((p) => p.replace(/\/$/, "")), MARKED);
  const noFindings = "## Summary\n- https://summary.example/run\n### Negative results\n| A | b | https://store.example/s |";
  assert.equal(notesMarkedPages(noFindings).size, 0, "notes with no findings section mark no page");
});

test("a page the web notes marked and no delivered finding cites is an exit; a page only read is not", () => {
  const findings = [{ ordinal: 1, mark: "KEPT", source: { source_type: "common-law", url: "https://www.shop.example/p/3?ref=x" } }];
  const e = notesExits(ANCHORED, findings);
  assert.equal(e.computable, true);
  assert.equal(e.marked, 3);
  assert.equal(e.exits, 2, "the two marked pages the findings left out, and not the one a finding cites");
  assert.deepEqual(e.rows.map((r) => r.url), ["https://store.example/app/12/Near_Title/", "https://store.example/publisher/north"]);
  const declined = new Set(["store.example/publisher/north"]);
  const d = notesExits(ANCHORED, findings, declined);
  assert.deepEqual([d.exits, d.declined], [1, 1], "a page synthesis declined with a ground left by a stated decision");
  assert.equal(notesExits(ANCHORED, [...findings, { source: { url: "https://store.example/app/12/Near_Title" } },
    { source: { url: "https://store.example/publisher/north" } }]).exits, 0, "every marked page cited, no exit");
});

test("the clearance pipeline calls the check where its traces are written; the knockout lane keeps no page trace", () => {
  const clearance = readFileSync(join(DRIVER, "pipeline.mjs"), "utf8");
  for (const call of ["pickingExits(safeReadJson(P.recordCarry))", "notesExits(existsSync(P.commonLaw)"]) {
    assert.ok(clearance.includes(call), `the clearance pipeline no longer calls ${call}`);
  }
  assert.match(clearance, /event: "reasonless-exits", lane: "clearance"/);
  assert.ok(clearance.indexOf("pickingExits(") > clearance.indexOf('deriveCommonLawCarry(ctx, "publish");'),
    "the check runs before the traces it reads are written");
  assert.equal(Object.keys(exitsModule).some((k) => /web|knockout|payload/i.test(k)), false,
    "a count of the grid's rows or the knockout's pages is back: neither is owed a ground");
  const knockout = readFileSync(join(DRIVER, "pipeline-knockout.mjs"), "utf8");
  assert.ok(knockout.includes("knockoutReviewingPass("), "guard: the knockout pipeline was read");
  assert.doesNotMatch(knockout, /hand-off-exits|knockoutCarry|reasonless-exits/);
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Every record, page or hit that leaves a hand-off with no ground is counted, at the picking step, the web
// hand-off (both hops) and the knockout's notes — and a hand-off with no trace says so instead of counting zero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pickingExits, webExits, notesExits, payloadPages, knockoutCarry, knockoutExits, exitsForLog } from "../hand-off-exits.mjs";

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
  for (const [name, e] of [["picking", pickingExits(null)], ["web", webExits([])], ["knockout", knockoutExits(undefined)],
    ["notes", notesExits(null, [])], ["notes without findings", notesExits("| a | https://a.example/p |", null)]]) {
    assert.equal(e.computable, false, `${name} read a missing trace as computed`);
    assert.match(e.reason, /^no \w.* — /, `${name} does not say what is missing`);
  }
  assert.deepEqual(exitsForLog({ picking: pickingExits(null) }).picking.computable, false);
});

test("the web hand-off counts silent drops across both carries, by row, page and cell", () => {
  const row = (url, cell, stopped_at, reason_source) => ({ url, cell, platform: "store.example", stopped_at, reason_source });
  const main = { rows: [
    row("https://store.example/app/1?ref=x", { term: "A", platform: "store.example" }, "findings", "absent"),
    row("https://store.example/app/1/", { term: "A", platform: "store.example" }, "findings", "absent"),
    row("https://store.example/app/2", { term: "B", platform: "store.example" }, "findings", "step-stated"),
  ] };
  const zh = { rows: [row("https://shop.example/p/9", { term: "C", platform: "shop.example" }, "findings", "absent")] };
  const e = webExits([main, zh]);
  assert.equal(e.exits, 3, "a row with a stated reason is not an exit with no reason");
  assert.equal(e.pages, 2, "the same page with a query string or trailing slash is one page");
  assert.equal(e.cells, 2);
});

test("the knockout trace follows every page a payload named to a finding, or counts it as an exit", () => {
  const payloads = {
    ONE: "- **Near name** — URL: https://www.example.com/near/ — a shop.\n- **Other** https://apps.example.org/app/7.\n"
      + "- Searched **https://shop.example.net/s?q=near** with nothing on point.\n",
    TWO: null,
  };
  const marks = [
    { name: "ONE", findings: [{ ordinal: 1, name: "Near name", evidence: ["https://example.com/near"] }],
      negatives: [{ term: "NEAR", source: "https://shop.example.net/s", note: "no use on point" }] },
    { name: "TWO", findings: [] },
  ];
  const carry = knockoutCarry(marks, (n) => payloads[n]);
  assert.deepEqual(carry.rows.map((r) => [r.page, r.reach]),
    [["example.com/near", "finding"], ["apps.example.org/app/7", "named"], ["shop.example.net/s", "finding"]],
    "a page a scoped absence names as its source was used, not dropped");
  assert.deepEqual(carry.marks_without_payload, ["TWO"], "a mark with no payload named no page, and is listed");
  assert.deepEqual(carry.totals, { marks: 2, pages: 3, filings: 0, finding: 2, set_aside: 0, unreasoned: 1 });
  const e = knockoutExits(carry);
  assert.equal(e.exits, 1);
  assert.deepEqual(e.rows, [{ mark: "ONE", url: "https://apps.example.org/app/7" }]);
});

test("a payload's pages are read once each, without the punctuation that ends a sentence or the emphasis around it", () => {
  assert.deepEqual(payloadPages("See https://a.example/x. And https://a.example/x/ again; https://b.example. **https://b.example**"),
    [{ page: "a.example/x", url: "https://a.example/x" }, { page: "b.example", url: "https://b.example" }]);
  assert.deepEqual(payloadPages(""), []);
});

test("the run-log line carries counts and reasons, never a row", () => {
  const line = exitsForLog({ picking: pickingExits({ rows: [carryRow("/mark/jp/1", "A", "placement", "step-silent")] }),
    web: webExits(null) });
  assert.deepEqual(line, { picking: { computable: true, exits: 1, owners: 1 },
    web: { computable: false, reason: line.web.reason } });
  assert.ok(!JSON.stringify(line).includes("/mark/"), "a record reached the run-log line");
});

test("a page the web notes surfaced and no delivered finding cites is an exit, whoever reached the notes", () => {
  const notes = [
    "## Findings",
    "| Finding | Source / Platform | URL | Notes |",
    "|---|---|---|---|",
    "| Near title | store.example | https://store.example/app/12/Near_Title/ | direct conflict |",
    "| Publisher | store.example | https://store.example/publisher/north | indie publisher |",
    "| Kept | shop.example | https://shop.example/p/3 | same goods |",
  ].join("\n");
  const findings = [{ ordinal: 1, mark: "KEPT", source: { source_type: "common-law", url: "https://www.shop.example/p/3?ref=x" } }];
  const e = notesExits(notes, findings);
  assert.equal(e.computable, true);
  assert.equal(e.surfaced, 3);
  assert.equal(e.exits, 2, "the two pages the findings left out, and not the one a finding cites");
  assert.deepEqual(e.rows.map((r) => r.url), ["https://store.example/app/12/Near_Title/", "https://store.example/publisher/north"]);
  assert.equal(notesExits(notes, [...findings, { source: { url: "https://store.example/app/12/Near_Title" } },
    { source: { url: "https://store.example/publisher/north" } }]).exits, 0, "every surfaced page cited, no exit");
});

test("both pipelines call the check where their traces are written, and log it", () => {
  const clearance = readFileSync(join(DRIVER, "pipeline.mjs"), "utf8");
  for (const call of ["pickingExits(safeReadJson(P.recordCarry))", "webExits([P.commonLawCarry, P.jxZhCarry]", "notesExits(existsSync(P.commonLaw)"]) {
    assert.ok(clearance.includes(call), `the clearance pipeline no longer calls ${call}`);
  }
  assert.match(clearance, /event: "reasonless-exits", lane: "clearance"/);
  assert.ok(clearance.indexOf("pickingExits(") > clearance.indexOf('deriveCommonLawCarry(ctx, "publish");'),
    "the check runs before the traces it reads are written");
  const knockout = readFileSync(join(DRIVER, "pipeline-knockout.mjs"), "utf8");
  assert.match(knockout, /atomicWrite\(K\.knockoutCarry, /, "the knockout lane no longer writes its carry trace");
  assert.match(knockout, /event: "reasonless-exits", lane: "knockout"/);
  assert.ok(knockout.indexOf("knockoutCarry(merged.marks") > knockout.indexOf("merged = await knockoutReviewingPass("),
    "the knockout trace describes the record before its reviewing pass, not the one that ships");
});

test("a knockout page or filing set aside with a ground is a stated exit; a filing nobody weighed, read or set aside is not", () => {
  const payload = "- **Near** https://apps.example.org/app/7 and https://dict.example/word/near.\n";
  const marks = [{
    name: "ONE",
    findings: [{ ordinal: 1, name: "Near", evidence: ["https://apps.example.org/app/7"], weighedFilings: ["R-1"] }],
    registerReads: [{ recordId: "R-2", read: "a stationery registration; nothing electronic" }],
    setAside: [
      { page: "https://dict.example/word/near", ground: "a dictionary entry for the word's meaning, not a use" },
      { recordId: "R-3", ground: "class 16 paper goods only" },
      { recordId: "R-9", ground: "a filing this mark was never handed" },
      { recordId: "R-4", ground: "   " },
    ],
  }];
  const carry = knockoutCarry(marks, () => payload, () => ["R-1", "R-2", "R-3", "R-4"]);
  assert.deepEqual(carry.rows.map((r) => [r.kind, r.page ?? r.recordId, r.reach, r.reason_source]), [
    ["page", "apps.example.org/app/7", "finding", null],
    ["page", "dict.example/word/near", "set-aside", "step-stated"],
    ["filing", "R-1", "finding", null],
    ["filing", "R-2", "finding", null],
    ["filing", "R-3", "set-aside", "step-stated"],
    ["filing", "R-4", "handed", "absent"],
  ], "a blank ground grounds nothing, and a set-aside row for a filing not handed matches nothing");
  assert.deepEqual(carry.totals, { marks: 1, pages: 2, filings: 4, finding: 3, set_aside: 2, unreasoned: 1 });
  assert.deepEqual(knockoutExits(carry).rows, [{ mark: "ONE", recordId: "R-4" }]);
  const noPayload = knockoutCarry([{ name: "TWO", findings: [] }], () => null, () => ["R-7"]);
  assert.deepEqual(noPayload.rows.map((r) => [r.kind, r.recordId, r.reach]), [["filing", "R-7", "handed"]],
    "a mark with no research still owes its filings a ground");
});

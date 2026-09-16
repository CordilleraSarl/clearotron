// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ── THE NEGATIVE EVIDENCE, AS FIELDS A RENDERER CAN READ ────────────────────────────────────────────
//
// A run that read 1,455 register records and cleared 432 near-names delivered a page showing 13 findings
// and nothing of the work behind them. `search-depth.mjs` derives that body of evidence from artifacts
// the run already wrote — counts, tokens and facts copied from records, no sentence composed anywhere.
//
// THE GROUP ARMS ARE THE POINT. Each cleared name is grouped by why it was cleared, and the only honest
// source is the providers' closed screening vocabulary plus the record's own status. The arms below
// drive a row whose REASONING PROSE says one thing and whose verdict says another, because classifying
// on the prose is the failure this key exists to avoid and it cannot be caught by a row where the two
// agree.
//
// BREAK MATRIX:
//   · a dead status groups as dead-filing           → break: drop the status arm, arm 1 red
//   · an out-of-class verdict groups as goods       → break: map it to other, arm 2 red
//   · an in-scope live name groups as other         → break: classify on the prose, arm 3 red
//   · parsing reads the audit's own note fields     → break: change the note key, arm 4 red
//   · counts name every country READ               → break: count only countries with a finding, arm 5 red
//   · four court states stay four                  → break: collapse none-found into not-checked, arm 6 red
import { test } from "node:test";
process.env.CLEAROTRON_MCP_URL ||= "https://mcp.test/mcp";
import assert from "node:assert/strict";
import { CLEARED_GROUPS, groupForCleared, clearedNames, recordsByCountry, sweepCounts, courtDecisionsState, localScriptSearched, searchDepthRecord } from "../publish/search-depth.mjs";

// Invented ground throughout. No client content reaches a fixture.
const AUDIT = `# Negative Results

## NR1
- source_layer: Register
- search_term: VOLTARIS
- result: the filing lapsed and cannot be revived
- notes: URI /mark/jp/aaa-111; screen_verdict=drop:dead; class=9; status=CANCELLED

## NR2
- source_layer: Register
- search_term: VOLTARIS
- result: a live registration covering unrelated goods, nothing in common with this specification
- notes: URI /mark/kr/bbb-222; screen_verdict=surface:in-scope-live; class=42; status=REGISTERED

## NR3
- source_layer: Register
- search_term: VOLTARIS
- notes: URI /mark/us/ccc-333; screen_verdict=drop:out-of-class; class=5; status=REGISTERED

## A trading name on a marketplace
- source_layer: Common-law
- url: https://example.com/shop/voltaris
- type: storefront

## (none found on this platform)
- source_layer: Common-law
`;

test("a dead filing is grouped from its status, not its prose", () => {
  assert.equal(groupForCleared({ screenVerdict: "drop:dead", status: "CANCELLED" }), "dead-filing");
  assert.equal(groupForCleared({ screenVerdict: "surface:in-scope-live", status: "EXPIRED" }), "dead-filing",
    "a record the register calls expired was grouped as live — the status arm is not reached");
});

test("an out-of-class verdict is the only thing that means different goods", () => {
  assert.equal(groupForCleared({ screenVerdict: "drop:out-of-class", status: "REGISTERED" }), "different-goods");
});

test("a live in-scope name is read and cleared, whatever its reasoning says", () => {
  // NR2's prose reads "unrelated goods, nothing in common". A classifier reading that would call this
  // different-goods. The verdict says the record was a real in-scope candidate, and the verdict is the
  // fact. This arm is what stops the prose being consulted.
  const { register } = clearedNames(AUDIT);
  const live = register.find((r) => r.uri === "/mark/kr/bbb-222");
  assert.equal(live.group, "other",
    "a cleared name was grouped from the engine's reasoning paragraph rather than from its screening verdict");
});

test("the audit's own note fields are what the parse reads", () => {
  const { register, web } = clearedNames(AUDIT);
  assert.equal(register.length, 3, `3 register rows in the fixture, ${register.length} parsed`);
  assert.deepEqual(register.map((r) => r.group), ["dead-filing", "other", "different-goods"]);
  assert.deepEqual(register.map((r) => r.country), ["JP", "KR", "US"]);
  assert.equal(register[0].status, "CANCELLED");
  assert.ok(register.every((r) => !("result" in r)), "a cleared row carries the engine's sentence — the owner ruled it out");
  assert.equal(web.length, 1, "the empty-platform heading was counted as a named web result");
  assert.equal(web[0].url, "https://example.com/shop/voltaris");
});

test("the counts name every country read, including the clean ones", () => {
  // A country with no finding is the whole point: a report that lists only countries with a conflict
  // cannot show that the rest came back clean.
  const by = recordsByCountry(["jp-1.json", "jp-2.json", "kr-1.json", "wo-9.json", "notacountry.json"]);
  assert.deepEqual(by, { JP: 2, KR: 1, WO: 1 });
  assert.ok(Object.keys(by).length >= 3, "the fixture is too small for this to mean anything");
});

test("court decisions keeps its four states apart", () => {
  assert.equal(courtDecisionsState(""), "not-in-scope");
  assert.equal(courtDecisionsState("The source could not be reached this session."), "not-checked");
  assert.equal(courtDecisionsState("No on-point precedent found in the searched corpus."), "none-found");
  assert.equal(courtDecisionsState("### 1\n- ord: 1\nA decision on point, with a citation."), "found");
});

test("the sweep and local-script counts come from the machine record", () => {
  const grid = { cells: [{ term: "a", platform: "p1" }, { term: "b", platform: "p1" }, { term: "a", platform: "p2" }], extras: { pr_risk: [1, 2] } };
  assert.deepEqual(sweepCounts(grid), { checks: 3, platforms: 2, spellings: 2, reputation: 2 });
  assert.equal(localScriptSearched({ entries: [{ term: "VOLTARIS" }, { term: "ボルタリス" }] }), true);
  assert.equal(localScriptSearched({ entries: [{ term: "VOLTARIS" }] }), false);
});

test("the whole record carries a group tally over the closed set only", () => {
  const rec = searchDepthRecord({ auditMd: AUDIT, recordFileNames: ["jp-1.json"], commonLawGrid: null, caseLawText: "", registerPlan: null });
  assert.deepEqual(Object.keys(rec.cleared.groups).sort(), [...CLEARED_GROUPS].sort());
  assert.equal(rec.cleared.groups["dead-filing"] + rec.cleared.groups["different-goods"] + rec.cleared.groups.other,
    rec.cleared.register.length, "the tally and the rows disagree");
  assert.equal(rec.counts.courtDecisions, "not-in-scope");
});

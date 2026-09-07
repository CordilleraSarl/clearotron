// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The scoped owner lookup a Knockout search owes a promoted register filing (tracker issue 276).
//
// THE DEFECT. Nothing ever searched the owner of an identical live registration. The assessment inferred
// what the owner sold from the owner's NAME and its class numbers, then deferred the real question to a
// document the run did not hold. On the run that produced the issue the owner was known 48 seconds before
// the sweep and never searched; the conclusion was right by luck. The reviewing lawyer settled it in one
// web search.
//
// TWO PROPERTIES CARRY THIS FIX AND NEITHER IS THE HAPPY PATH:
//
//   1. THE BOUND. One promoted filing on the issue's own run means ONE extra query on a 5–10 minute
//      product. A bound that silently widens turns a screen into a per-filing billing surface, and the
//      widening is invisible in a green test that only checks a query happened.
//   2. THE OUTAGE. Owner ruling A, 2026-09-07: the report still delivers with an honest "no result" on
//      any row the lookup could not answer; the cite is enforced, its absence never refuses delivery.
//      A happy-path-only test passes on a change that refuses on outage, which is the one outcome the
//      owner ruled against.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ownersOwedACheck, composeOwnerQuery, runOwnerChecks, firstSourceUrl,
  NO_RESULT, OWNER_CHECK_CAP,
} from "../owner-use-check.mjs";
import { renderKnockoutHtml, knockoutReportData } from "../publish/render-knockout.mjs";

const FW = {
  framework_key: "house-triage",
  bands: [{ label: "Blocking", tone: "severe" }, { label: "Medium", tone: "medium" },
    { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }],
};

const rec = (over = {}) => ({
  recordId: "R-LUMENREED", mark: "IRONWHISK", owner: "Lumenreed GmbH", status: "Valid",
  classes: [5, 9], territory: "DE", matchedForm: "IRONWHISK", matchedBasis: "identical",
  url: null, provider: "fixture", ...over,
});

const doc = (records, over = {}) => ({
  provider: "fixture", providerLabel: "the fixture register",
  marks: [{ name: "IRONWHISK", classes: [9, 41], records, ...over }],
});

// ── the bound, which is what the ruling is about ─────────────────────────────────────────────────────

test("276: the issue's own run owes exactly ONE query", () => {
  const owed = ownersOwedACheck(doc([rec()]));
  assert.equal(owed.length, 1, "one promoted filing, one owner, one query");
  assert.equal(owed[0].owner, "Lumenreed GmbH");
  assert.deepEqual(owed[0].recordIds, ["R-LUMENREED"]);
});

// A portfolio holder with nine filings is ONE question, not nine. Without this the bound is per-filing
// and the cost scales with the register rather than with the assessment.
test("276: many filings by one owner are one query, and the join still reaches every filing", () => {
  const many = Array.from({ length: 9 }, (_, i) => rec({ recordId: `R-${i}` }));
  const owed = ownersOwedACheck(doc(many));
  assert.equal(owed.length, 1, "nine filings, one owner, one query");
  assert.equal(owed[0].recordIds.length, 9, "and the answer is joined to all nine");
});

// The ruled trigger: a PROMOTED record only — not dead, in an instructed class. A dead filing is not a
// live right and does not justify the spend.
test("276: a dead filing and an out-of-class filing owe nothing", () => {
  assert.equal(ownersOwedACheck(doc([rec({ status: "Expired", owner: "Dead Co" })])).length, 0,
    "a dead filing is not a live right");
  assert.equal(ownersOwedACheck(doc([rec({ classes: [30], owner: "Elsewhere Ltd" })])).length, 0,
    "a filing outside the searched classes is out of the screen's scope");
  assert.equal(ownersOwedACheck(doc([rec({ owner: "  " })])).length, 0,
    "a filing with no proprietor on the record cannot be searched by owner");
  assert.deepEqual(ownersOwedACheck(null), [], "no register lane, no queries");
  assert.deepEqual(ownersOwedACheck({ unavailable: "provider down" }), [], "an unavailable register owes none");
});

test("276: the number of queries is capped whatever the register returns", () => {
  const owners = Array.from({ length: 12 }, (_, i) => rec({ recordId: `R-${i}`, owner: `Owner ${i} Ltd` }));
  assert.equal(ownersOwedACheck(doc(owners)).length, OWNER_CHECK_CAP,
    "the page shows at most this many promoted filings, so querying past it buys nothing a reader sees");
});

// ── the query itself ─────────────────────────────────────────────────────────────────────────────────

test("276: the query is scoped to owner + mark + field, and asks what the owner SELLS", () => {
  const q = composeOwnerQuery({ owner: "Lumenreed GmbH", mark: "IRONWHISK", classes: [5, 9] });
  assert.match(q, /Lumenreed GmbH/);
  assert.match(q, /IRONWHISK/);
  assert.match(q, /classes 5, 9/);
  // The question is about the owner's TRADE, not about their use of the mark. That is the question the
  // reviewing lawyer answered in one search, and no question phrased about the mark returns it.
  assert.match(q, /goods or services|actually sell/i);
});

// ── the outage path — the arm the owner's ruling turns on ────────────────────────────────────────────

test("276 acceptance 5: a provider outage yields rows saying so, and NEVER throws", async () => {
  const owed = ownersOwedACheck(doc([rec()]));
  const throwing = async () => { throw new Error("429 Too Many Requests"); };

  const rows = await runOwnerChecks({ owners: owed, exec: throwing, runDir: null });
  assert.equal(rows.length, 1, "a row is written for an owner whose lookup failed");
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].source, NO_RESULT, "the clearance lane's own honest literal");
  assert.match(rows[0].cause, /429|threw/, "and the cause is recorded rather than swallowed");
});

test("276: an executor that resolves not-ok is the same story, and still no throw", async () => {
  const owed = ownersOwedACheck(doc([rec()]));
  const rows = await runOwnerChecks({ owners: owed, exec: async () => ({ ok: false, cause: "provider unreachable", outage: true }), runDir: null });
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].source, NO_RESULT);
  assert.equal(rows[0].outage, true, "an outage is flagged so the lane can tell it from a bad key");
});

// A ROW EXISTS FOR EVERY OWNER OWED A CHECK, answered or not. An owner with no row would be
// indistinguishable from an owner nobody owed a check to — the absence-reads-as-a-pass shape.
test("276: every owner owed a check gets a row, so a gap can never read as a clean result", async () => {
  const owed = ownersOwedACheck(doc([rec({ recordId: "R-A", owner: "A Ltd" }), rec({ recordId: "R-B", owner: "B Ltd" })]));
  assert.equal(owed.length, 2);
  let n = 0;
  const flaky = async () => (++n === 1 ? { ok: true, text: "A Ltd sells valves. https://a.example/about" } : { ok: false, cause: "timeout" });
  const rows = await runOwnerChecks({ owners: owed, exec: flaky, runDir: null });
  assert.equal(rows.length, 2, "both owners are on the record");
  assert.equal(rows[0].source, "https://a.example/about", "the answered one cites where the answer came from");
  assert.equal(rows[1].source, NO_RESULT, "the unanswered one says so, in the clearance lane's words");
});

test("276: the source is the first URL in the payload, and a payload with none is not a clean negative", async () => {
  assert.equal(firstSourceUrl("see https://x.example/page, and more"), "https://x.example/page");
  assert.equal(firstSourceUrl("no links here at all"), null);
  const owed = ownersOwedACheck(doc([rec()]));
  const rows = await runOwnerChecks({ owners: owed, exec: async () => ({ ok: true, text: "Some prose with no link." }), runDir: null });
  assert.equal(rows[0].source, NO_RESULT,
    "an answer we cannot point at is reported as no result rather than as an uncited finding");
});

test("276: the payload is saved beside the mark payloads so the assess stage can read it", async () => {
  const d = mkdtempSync(join(tmpdir(), "ko-owner-"));
  mkdirSync(join(d, "research"), { recursive: true });
  const owed = ownersOwedACheck(doc([rec()]));
  const rows = await runOwnerChecks({
    owners: owed, runDir: d,
    exec: async () => ({ ok: true, text: "Lumenreed GmbH sells irrigation valves. https://lumenreed.example/about" }),
  });
  assert.ok(rows[0].payloadFile, "the payload is named on the row");
  const p = join(d, "research", rows[0].payloadFile);
  assert.ok(existsSync(p), "and it is on disk where the dispatch points");
  assert.match(readFileSync(p, "utf8"), /irrigation valves/);
  assert.equal(rows[0].source, "https://lumenreed.example/about");
});

// ── the report ───────────────────────────────────────────────────────────────────────────────────────

const findingsDoc = (over = {}) => ({
  schema_version: 1,
  batch: { executiveSummary: "A summary.", standardCaveats: [] },
  marks: [{
    name: "IRONWHISK", rating: "Manageable", classesSearched: [9, 41], classesDriving: [9],
    findings: [], bullets: ["b"], ...over,
  }],
});

const CHECK = {
  mark: "IRONWHISK", owner: "Lumenreed GmbH", recordIds: ["R-LUMENREED"], classes: [5, 9],
  query: "q", ok: true, source: "https://lumenreed.example/about", payloadFile: "owner-lumenreed-gmbh.md",
};

const html = (ownerChecks) => renderKnockoutHtml(findingsDoc(), FW, {
  runId: "tmp1-fixture", overall: "Manageable", registerRecords: doc([rec()]), ownerChecks,
});

test("276 acceptance 2: the card cites where the owner's trade was looked up", () => {
  const out = html([CHECK]);
  assert.match(out, /Use-check source:/, "the clearance lane's own label, not a second wording");
  assert.match(out, /lumenreed\.example\/about/, "and the source the driver actually got");
});

test("276: an unanswered lookup prints the honest literal, not a silent omission", () => {
  const out = html([{ ...CHECK, ok: false, source: NO_RESULT, payloadFile: null }]);
  assert.match(out, /Use-check source:/);
  assert.match(out, /perplexity_research — no result/, "the clearance lane's wording for an honest non-answer");
});

// THE THIRD STATE, and it is the one a two-state test misses. A run that owed no check must print NO
// line at all: a "no result" line on a filing nobody was asked about would claim a search that never ran,
// which is precisely the defect this issue exists to remove.
test("276: a filing this run owed no check prints no source line at all", () => {
  const out = html([]);
  assert.doesNotMatch(out, /Use-check source:/,
    "silence, because a no-result line here would assert a search that was never made");
  const other = html([{ ...CHECK, recordIds: ["R-SOMEONE-ELSE"] }]);
  assert.doesNotMatch(other, /Use-check source:/, "and the join is by recordId, not by position");
});

test("276: report-data carries the source, in the same three states as the card", () => {
  const withCheck = knockoutReportData(findingsDoc(), FW, {
    runId: "r", overall: "Manageable", identity: {}, registerCounts: null,
    registerRecords: doc([rec()]), ownerChecks: [CHECK], matter: "r",
  });
  const card = withCheck.marks[0].findings.find((f) => f.shape === "register");
  assert.equal(card.useCheckSource, "https://lumenreed.example/about");

  const without = knockoutReportData(findingsDoc(), FW, {
    runId: "r", overall: "Manageable", identity: {}, registerCounts: null,
    registerRecords: doc([rec()]), ownerChecks: [], matter: "r",
  });
  assert.equal(without.marks[0].findings.find((f) => f.shape === "register").useCheckSource, null,
    "null where no check was owed — never an empty string, which reads as a checked blank");
});

// An archived run predating this lane must republish byte-identically: no store, no line, no change.
test("276: an archived run with no owner-check store renders exactly as it was delivered", () => {
  assert.equal(html(undefined), html([]), "undefined and empty behave the same");
  assert.doesNotMatch(html(undefined), /Use-check source:/);
});

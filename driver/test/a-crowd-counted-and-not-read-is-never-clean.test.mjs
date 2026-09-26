// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT WAS COUNTED AND NOT READ IS SET ASIDE WITH ITS COUNT, AND NEVER MARKED CLEAN.
//
// Measured 2026-09-25 on a worldwide order: the identical-mark question came back a crowd, the reading
// step narrowed it to seven offices, and the coverage record called every other office clean. Three of
// the reference answer's register marks sat at offices whose identical name was never read. A single
// crowded question never opened a row of its own, so nothing refused the clean claim.
//
// Driven through the real skeleton, the real form builder, the real gate and the archived-run gate, on
// the shape of that run with invented names: a worldwide crowd narrowed to seven offices by a proposal
// that names it (`narrows`), the narrowed question read in full.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCoverageSkeleton, findUnverifiedIncompleteCleanClaims } from "../register-plan.mjs";
import { coverageFormRows, rowIsSettled, findCoverageFormViolations } from "../coverage-form.mjs";

const CROWD = { qid: "primary-sweep:exact:lanternwick", axis: "primary-sweep", predicate: "exact",
  term: "LANTERNWICK", nice_classes: ["9"], regions: [], expected_kind: "enumerate" };
const SEVEN = ["US", "EU", "GB", "CN", "JP", "CH", "WO"];
const NARROWED = { qid: "sup:exact:lanternwick+seven", axis: "primary-sweep", predicate: "exact",
  term: "LANTERNWICK", nice_classes: ["9"], regions: SEVEN, expected_kind: "enumerate", narrows: CROWD.qid };
const PLAN = { plan_version: 2, regions: [], entries: [CROWD, NARROWED] };
const BANDS = { "primary-sweep": [
  { state: "incomplete", qid: CROWD.qid, total_hits: 5412,
    reason: "total_hits 5412 exceeds the enumerate ceiling 600 — this is a CROWD" },
  { state: "enumerated", qid: NARROWED.qid, total_hits: 40, count: 40, records: [] },
] };
const SKELETON = deriveCoverageSkeleton(PLAN, { missing: [], skipped: [], deferred: [],
  executed: [{ qid: CROWD.qid, state: "incomplete" }, { qid: NARROWED.qid, state: "enumerated" }] });
const form = () => coverageFormRows({ skeleton: SKELETON, plan: PLAN, bandBlocksByAxis: BANDS }).rows;
const crowdRow = () => form().find((r) => r.kind === "block" && r.qid === CROWD.qid);

test("the crowd a narrowing answered in part gets its own row, carrying the count and what was read in its place", () => {
  assert.equal(SKELETON[0].state, "incomplete", "the fixture's axis is the crowded shape");
  const r = crowdRow();
  assert.ok(r, "a single crowded question opened no row, so a clean claim over it had nothing to refuse");
  assert.equal(r.open, true);
  assert.equal(r.total_hits, 5412);
  assert.match(r.open_because, /\(5412 counted\)/);
  assert.match(r.open_because, /read in its place: "LANTERNWICK" in class 9 in US, EU, GB, CN, JP, CH, WO/);
  assert.match(r.open_because, /set aside, never clean/);
  assert.equal(form().filter((x) => x.kind === "block").length, 1, "the narrowed question was read in full and opens nothing");
});

test("that row cannot be claimed clean, and settles only as what it is: counted and not read", () => {
  const r = crowdRow();
  assert.equal(rowIsSettled({ ...r, status: "confirmed-clean", reason: "the rest is outside the order" }, r), false);
  assert.equal(rowIsSettled({ ...r, status: "coverage-limited",
    reason: "5,412 filings of the identical name were counted worldwide; the name was read in class 9 in seven markets, and the rest was set aside" }, r), true);
});

test("the digest calling the whole search clean is refused on that row", () => {
  const rows = form().map((x) => ({ ...x, status: "confirmed-clean", reason: "judged" }));
  const v = findCoverageFormViolations(rows).filter((x) => x.row === crowdRow().row_id);
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /counted more than it read/);
});

test("an archived run that called the same crowd clean is refused by the prose gate too", () => {
  const claimed = [{ axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / worldwide",
    reason: "read in the seven markets that matter; every other office is outside the order" }];
  const v = findUnverifiedIncompleteCleanClaims(claimed, SKELETON, BANDS, PLAN);
  assert.deepEqual(v.map((x) => x.token), ["coverage_clean_unverified_incomplete:primary-sweep"]);
  assert.deepEqual(v[0].blocks.map((b) => b.qid), [CROWD.qid]);
});

test("a crowd nobody narrowed opens too and names no narrowing; a count-kind entry, a measurement, never opens", () => {
  const bare = { entries: [CROWD] };
  const bareRows = coverageFormRows({ skeleton: deriveCoverageSkeleton(bare, { missing: [], skipped: [], deferred: [],
    executed: [{ qid: CROWD.qid, state: "incomplete" }] }), plan: bare, bandBlocksByAxis: { "primary-sweep": [BANDS["primary-sweep"][0]] } }).rows;
  const b = bareRows.find((x) => x.kind === "block");
  assert.ok(b && !/read in its place/.test(b.open_because), "with no narrowing, the row names none");
  const count = { entries: [{ ...CROWD, expected_kind: "count" }] };
  const countRows = coverageFormRows({ skeleton: deriveCoverageSkeleton(count, { missing: [], skipped: [], deferred: [],
    executed: [{ qid: CROWD.qid, state: "incomplete" }] }), plan: count, bandBlocksByAxis: { "primary-sweep": [BANDS["primary-sweep"][0]] } }).rows;
  assert.equal(countRows.filter((x) => x.kind === "block").length, 0);
});

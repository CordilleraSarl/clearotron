// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-quote.mjs — the one derivation every door quotes through.
//
// The effort MATH is pinned by portal-ui/test/effortModelParity.test.ts. That test cannot catch what
// these do: it compares two implementations given identical inputs, and the bug this module exists for
// was two doors feeding the model DIFFERENT inputs and both computing correctly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { quoteForJob, reconcileTurnaround } from "../run-quote.mjs";
import { logTurnaroundReconciliation } from "../pipeline.mjs";

const CLEARANCE = { pipeline: "clearance", components: { commonLawGrid: true, jxLanes: false, registerProbe: false } };
const KNOCKOUT = { pipeline: "knockout", components: { commonLawGrid: false, jxLanes: false, registerProbe: false } };

const ACCOUNT = {
  key: "acme",
  defaultJurisdictions: ["United States"],
  defaultClasses: [9, 41],
  platforms: ["amazon.com", "ebay.com"],
  marketplaceDensity: null,
};

// THE REGRESSION (2026-07-28). The plan doors sized a request from the EFFECTIVE scope — account
// defaults folded in — while the pipeline sized it from the RAW job. A request naming no territories was
// therefore a one-territory search on screen and a no-territory search on the run, so `W.oneTerritory`
// (9 — the largest single term) fired on one side only and the stamped quote came in a whole unit under
// the quoted one. A ledger row pairing "what we quoted" against "what it consumed" is worthless if the
// two halves answered different questions.
test("quoteForJob: an unstated territory resolves to the account default, so every door quotes the same", () => {
  const job = { markName: "Zesty Otter", marks: [{ name: "Zesty Otter" }], classes: [9, 41] };
  const stated = { ...job, jurisdictions: ["United States"] };

  const unstated = quoteForJob({ job, profile: ACCOUNT, searchPolicy: CLEARANCE });
  const explicit = quoteForJob({ job: stated, profile: ACCOUNT, searchPolicy: CLEARANCE });

  assert.equal(unstated.raw, explicit.raw,
    "naming the account's own default territory must not change the size of the search");
  assert.equal(unstated.units, explicit.units);
});

test("quoteForJob: passing a pre-resolved scope yields the same quote as resolving it here", () => {
  const job = { markName: "Zesty Otter", marks: [{ name: "Zesty Otter" }], classes: [9, 41] };
  const a = quoteForJob({ job, profile: ACCOUNT, searchPolicy: CLEARANCE });
  // what the plan doors pass, having already resolved it for the summary beside the quote
  const b = quoteForJob({
    job, profile: ACCOUNT, searchPolicy: CLEARANCE,
    scope: { jurisdictions: ["United States"], classes: [9, 41], platforms: ACCOUNT.platforms },
  });
  assert.deepEqual(a, b, "the door that resolved first and the door that did not must agree");
});

test("quoteForJob: the levers come from the resolved POLICY, not from what the caller typed", () => {
  const job = { markName: "Zesty Otter", marks: [{ name: "Zesty Otter" }], classes: [9] };
  const clearance = quoteForJob({ job, profile: ACCOUNT, searchPolicy: CLEARANCE });
  const knockout = quoteForJob({ job, profile: ACCOUNT, searchPolicy: KNOCKOUT });
  assert.equal(clearance.pipeline, "clearance");
  assert.equal(knockout.pipeline, "knockout");
  assert.ok(knockout.raw < clearance.raw, "a quick screen is smaller than a clearance");
});

test("quoteForJob: a 20-name knockout is ONE search; a clearance is one search per name", () => {
  const marks = Array.from({ length: 20 }, (_, i) => ({ name: `Mark ${i}` }));
  const ko = quoteForJob({ job: { marks, classes: [9] }, profile: ACCOUNT, searchPolicy: KNOCKOUT });
  const cl = quoteForJob({ job: { marks, classes: [9] }, profile: ACCOUNT, searchPolicy: CLEARANCE });
  assert.equal(ko.searches, 1);
  assert.equal(cl.searches, 20);
});

test("quoteForJob: every quote carries the weight-set version that produced it", () => {
  const q = quoteForJob({ job: { markName: "A", marks: [{ name: "A" }] }, profile: ACCOUNT, searchPolicy: CLEARANCE });
  assert.ok(Number.isInteger(q.unitsVersion), "a quote is only interpretable against its version");
  assert.doesNotMatch(JSON.stringify(q), /usd|price|[$]/i, "units are not money");
});

// Two previews and a run terminal call this; a throw at any of them costs more than a missing number.
// But a WRONG number costs more than either: with no pipeline resolved, the lever mapping reads absent
// components as "registers on, marketplace off" and returns a confident register-only quote for a search
// nobody described. Unsizable must mean null.
test("quoteForJob: never throws, and never invents a quote it could not resolve", () => {
  assert.equal(quoteForJob({}), null);
  assert.equal(quoteForJob({ job: null, profile: null, searchPolicy: null }), null);
  assert.equal(quoteForJob({ job: { markName: "A" }, searchPolicy: { components: { commonLawGrid: true } } }), null,
    "components without a pipeline is not a resolved policy");
  // a malformed job against a REAL policy still quotes — the policy is what makes it sizable
  assert.equal(quoteForJob({ job: { marks: "not-an-array" }, searchPolicy: CLEARANCE })?.searches, 1);
});

// ── AD-4 (2026-07-30 addendum): quoted-vs-actual turnaround reconciliation ──────────────────────────
// The consumption row pairs quote + wallSec on one line; this is the comparison nothing ever computed
// ("quoted 1.5h, took 5.68h" was a forensic discovery). Hours only — no currency, ever. Every field is
// present on every return, so a missing side is a recorded fact, never an omitted key.

test("reconcileTurnaround: both sides present → hours + ratio", () => {
  const start = "2026-07-30T10:00:00.000Z";
  const now = new Date("2026-07-30T15:40:48.000Z").getTime();   // 5.68h later — the R2 evidence shape
  const r = reconcileTurnaround({ quote: { turnaroundHours: 1.5 }, startedAt: start, now });
  assert.equal(r.quotedHours, 1.5);
  assert.equal(r.actualHours, 5.68);
  assert.equal(r.ratio, 3.79);
  assert.doesNotMatch(JSON.stringify(r), /usd|price|[$]/i, "hours are not money");
});

const MEASURED = { actualHoursBasis: "wall:status.startedAt→terminal", actualHoursIncludesParked: true };
const UNMEASURED = { actualHoursBasis: null, actualHoursIncludesParked: null };

test("reconcileTurnaround: no quote → quotedHours null (the run was never sized), actual still measured", () => {
  const r = reconcileTurnaround({ quote: null, startedAt: "2026-07-30T10:00:00.000Z", now: new Date("2026-07-30T11:00:00.000Z").getTime() });
  assert.deepEqual(r, { quotedHours: null, actualHours: 1, ratio: null, ...MEASURED });
});

test("reconcileTurnaround: garbled/missing startedAt → actualHours null, never a guess, never a throw", () => {
  assert.deepEqual(reconcileTurnaround({ quote: { turnaroundHours: 2 }, startedAt: "not-a-date" }),
    { quotedHours: 2, actualHours: null, ratio: null, ...UNMEASURED });
  assert.deepEqual(reconcileTurnaround({ quote: { turnaroundHours: 2 }, startedAt: null }),
    { quotedHours: 2, actualHours: null, ratio: null, ...UNMEASURED });
  assert.deepEqual(reconcileTurnaround(), { quotedHours: null, actualHours: null, ratio: null, ...UNMEASURED });
});

// post-merge audit, problem 8 — the wall figure is labelled, not silently re-interpreted. It spans
// rate-limit postpones and auto-recovery parks (a resume never rewrites status.startedAt), so a run that sat
// waiting out a cap and one that ground for the same hours produce the same actualHours. The row must say so,
// and must say NOTHING when there was nothing to measure.
test("reconcileTurnaround: the wall basis is stated on the row, and is null when actualHours is null", () => {
  const measured = reconcileTurnaround({ quote: { turnaroundHours: 2 }, startedAt: "2026-07-29T16:58:39.467Z", now: new Date("2026-07-30T00:38:17.807Z").getTime() });
  assert.equal(measured.actualHours, 7.66, "the real 2026-07-29 delivered run's wall");
  assert.equal(measured.ratio, 3.83, "…against its quoted 2h");
  assert.equal(measured.actualHoursBasis, "wall:status.startedAt→terminal");
  assert.equal(measured.actualHoursIncludesParked, true, "that run parked for auto-recovery 3× — the wall includes it");
  assert.doesNotMatch(JSON.stringify(measured), /usd|price|[$]/i, "hours are not money");

  const unmeasured = reconcileTurnaround({ quote: { turnaroundHours: 2 }, startedAt: null });
  assert.equal(unmeasured.actualHoursBasis, null, "no measurement ⇒ no basis claimed");
  assert.equal(unmeasured.actualHoursIncludesParked, null, "…and no claim about what it includes");
});

test("reconcileTurnaround: a zero/absent turnaroundHours quote cannot produce a divide-by-zero ratio", () => {
  const r = reconcileTurnaround({ quote: { turnaroundHours: 0 }, startedAt: "2026-07-30T10:00:00.000Z", now: new Date("2026-07-30T11:00:00.000Z").getTime() });
  assert.equal(r.quotedHours, 0);
  assert.equal(r.actualHours, 1);
  assert.equal(r.ratio, null, "0-quoted has no meaningful multiple");
});

// ── post-merge audit, problem 8: EVERY terminal, not just the delivered one ────────────────────
// AD-4 wrote this row only where a run delivered, so a failed / parked / postponed / cancelled run left no
// row at all — and "we never measured this run" was byte-identical to "this run did not deliver". That is
// the exact three-valuedness the package exists to enforce, missing from the package's own newest field.
const TERMINAL_STATES = ["delivered", "failed", "recovery-parked", "rate-limit-postponed", "cancelled"];

test("AUDIT #172/8 — the turnaround row is written at every terminal, stamped with WHICH terminal", () => {
  const dir = mkdtempSync(join(tmpdir(), "turnaround-terminals-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(join(dir, "status.json"), JSON.stringify({ startedAt: "2026-07-29T16:58:39.467Z" }));
    for (const state of TERMINAL_STATES) logTurnaroundReconciliation(dir, { turnaroundHours: 2 }, state);
    const rows = readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n")
      .map((l) => JSON.parse(l)).filter((e) => e.event === "turnaround-reconciliation");
    assert.deepEqual(rows.map((r) => r.state), TERMINAL_STATES, "one row per terminal, each naming itself");
    for (const r of rows) {
      assert.equal(r.quotedHours, 2);
      assert.ok(Number.isFinite(r.actualHours), "…and each carries a real measurement");
      assert.equal(r.actualHoursBasis, "wall:status.startedAt→terminal");
    }
    assert.doesNotMatch(JSON.stringify(rows), /usd|price|[$]/i, "hours and a ratio — no currency, on any terminal");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AUDIT #172/8 — a run with no status.json still leaves a row: 'not measured' is written down, never silence", () => {
  const dir = mkdtempSync(join(tmpdir(), "turnaround-nostatus-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    const ta = logTurnaroundReconciliation(dir, null, "failed");   // failed before status.json existed
    assert.equal(ta.quotedHours, null, "never sized");
    assert.equal(ta.actualHours, null, "never measurable");
    const rows = readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(rows.length, 1, "the row exists even when both sides are null");
    assert.equal(rows[0].state, "failed");
    assert.equal(rows[0].actualHoursIncludesParked, null, "no measurement ⇒ no claim about what it spans");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The behavioural tests above prove the writer. This one proves the CALL SITES exist — the finding was
// never that the row was wrong, it was that four of the five terminals never reached it.
test("AUDIT #172/8 — every terminal in pipeline.mjs actually calls the writer", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const called = [...src.matchAll(/logTurnaroundReconciliation\([^)]*?"([a-z-]+)"\)/g)].map((m) => m[1]);
  for (const state of TERMINAL_STATES)
    assert.ok(called.includes(state), `the ${state} terminal must write a turnaround row (found: ${called.join(", ")})`);
});

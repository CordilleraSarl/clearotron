// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SLICE THE RUN TOOK OUT OF THE BAND IS OPEN FOR ITS OWN REASON, NEVER BECAUSE THE PROVIDER CANNOT EXPRESS IT.
//
// The searches not completed take a slice out of the band when a check cannot prove it ran: a band with no register call
// behind it, a planned question that never reached the register, a collapsed slice. Each becomes the executor's deferred
// block, so the coverage form gave it the one reason a deferral carried, that the active provider cannot express the
// query. That was wrong for these: the provider could express them. The write-up now reads the slice's own reason, the
// line the reader gets for it (ruled 2026-10-27), and a collapsed slice with no qid, which no plan row defers, gets a row
// of its own on its query. Every mark is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coverageFormRows, DEFERRED_OPEN_BECAUSE } from "../coverage-form.mjs";
import { coverageFormInput } from "../coverage-form-io.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";

const AXIS = "primary-sweep";
const NOT_PROVEN = plainDeferralReason("not-verified-closed");
const NOT_REACHED = plainDeferralReason("slice-not-landed");
const NOT_COMPLETED = "it could not be completed this run, so it is left open here rather than reported as clean";
const Q = { unproven: `${AXIS}:exact:velmorax-eu`, unreached: `${AXIS}:exact:velmorax-us`, collapsed: `${AXIS}:contains:velmor-ch`, gap: `${AXIS}:exact:velmorax-ru` };
const block = (qid, reason) => ({ qid, state: "incomplete", total_hits: 0, fetched: 0, sample: [], error: true, deferred: true, reason });
const TAKEN = [
  { axis: AXIS, qid: Q.unproven, reason: NOT_PROVEN },
  { axis: AXIS, qid: Q.unreached, reason: NOT_REACHED },
  { axis: AXIS, qid: Q.collapsed, reason: NOT_COMPLETED },
  { axis: AXIS, query: "VELMOR*", reason: NOT_COMPLETED },
];
const input = (takenOut) => ({
  skeleton: [{ axis: AXIS, state: "deferred", deferred: [Q.unproven, Q.unreached, Q.collapsed, Q.gap], missing: [] }],
  plan: { entries: Object.values(Q).map((qid) => ({ qid, axis: AXIS, predicate: "exact", term: "VELMORAX" })) },
  bandBlocksByAxis: { [AXIS]: [block(Q.unproven, NOT_PROVEN), block(Q.unreached, NOT_REACHED), block(Q.collapsed, NOT_COMPLETED),
    { state: "incomplete", query: "VELMOR*", total_hits: 0, fetched: 0, sample: [], error: true, deferred: true, reason: NOT_COMPLETED },
    block(Q.gap, "capability-gap: office outside the register's vocabulary")] },
  deferredReasons: { [Q.gap]: "capability-gap: office outside the register's vocabulary" },
  activeAxes: [AXIS],
  ...(takenOut ? { takenOut } : {}),
});
const deferred = (takenOut) => coverageFormRows(input(takenOut)).rows.filter((r) => r.kind === "deferred");

test("each slice taken out reads its own reason, the line the reader gets for it", () => {
  const rows = deferred({ [AXIS]: TAKEN });
  const because = (qid) => rows.find((r) => r.qid === qid)?.open_because;
  assert.equal(because(Q.unproven), NOT_PROVEN, "a band with no register call behind it");
  assert.equal(because(Q.unreached), NOT_REACHED, "a planned question that never reached the register");
  assert.equal(because(Q.collapsed), NOT_COMPLETED, "a collapsed slice");
  assert.equal(because(Q.gap), DEFERRED_OPEN_BECAUSE.capability, "a slice the provider cannot express keeps its words");
});

test("a collapsed slice with no qid has a row of its own, keyed on its query, with the same line", () => {
  const rows = deferred({ [AXIS]: TAKEN });
  const own = rows.filter((r) => r.query === "VELMOR*");
  assert.equal(own.length, 1, "the slice no plan row defers has no row, so the write-up is never told it is open");
  assert.equal(own[0].qid, null);
  assert.equal(own[0].open, true);
  assert.equal(own[0].open_because, NOT_COMPLETED);
  assert.equal(new Set(rows.map((r) => r.row_id)).size, rows.length, "two rows share an id");
});

test("with no slice taken out, every deferral reads as before", () => {
  const rows = deferred(null);
  assert.equal(rows.length, 4);
  assert.deepEqual([...new Set(rows.map((r) => r.open_because))], [DEFERRED_OPEN_BECAUSE.capability]);
});

const DIRS = [];
after(() => { for (const d of DIRS) rmSync(d, { recursive: true, force: true }); });
test("the form's input carries the slices the run's searches record took out", () => {
  const dir = mkdtempSync(join(tmpdir(), "clearotron-taken-out-")); DIRS.push(dir);
  mkdirSync(join(dir, "_driver", "not-completed"), { recursive: true });
  mkdirSync(join(dir, "register-units"), { recursive: true });
  writeFileSync(join(dir, "_driver", "plan-execution.json"), JSON.stringify({ skeleton: [{ axis: AXIS, state: "deferred", deferred: [Q.unproven] }], deferred: [] }));
  writeFileSync(join(dir, "_driver", "register-plan.json"), JSON.stringify({ entries: [{ qid: Q.unproven, axis: AXIS }] }));
  writeFileSync(join(dir, "register-units", `${AXIS}-band.json`), JSON.stringify([block(Q.unproven, NOT_PROVEN)]));
  writeFileSync(join(dir, "_driver", "not-completed", "searches.json"), JSON.stringify({ part: "searches", slices: TAKEN }));
  const { input: got } = coverageFormInput(dir);
  assert.deepEqual(got?.takenOut?.[AXIS]?.map((s) => s.reason), TAKEN.map((s) => s.reason), "the record's slices did not reach the form");
});

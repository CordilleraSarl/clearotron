// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE MACHINE COVERAGE LEDGER CARRIES THE COUNT ITS OWN SOURCE ROW HOLDS.
//
// The coverage form is the source, and the prose table and the JSON are both renders of it — the renderer's
// own doctrine says they "agree by construction and neither can be the thing that drifts". They did not
// agree. A form row carries `total_hits`, the table prints it as "N hits", and the JSON dropped it.
//
// Measured on R18 of 2026-09-27: fifty rows of four fields, and not one of the forty-nine coverage-limited
// rows carried a count — so a reader of the machine ledger could not tell a slice holding 200 records from
// one holding 300,000. Ruling 551 puts the count on the row in as many words, and the count was already in
// the room.
//
// `qid` RIDES WITH IT because it is what joins a row to the plan's question. Without it the count can only
// be re-attached by matching prose, which is the two-derived-sides-agreeing-about-nothing shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCoverageLedgerJsonFromForm } from "../coverage-form.mjs";
import { parseCoverageLedgerJson, classTokensFromScopeText } from "../coverage-ledger.mjs";

// A driver-built row (it has a qid and a count) and a seat-added row (it has neither), which is the whole
// population this render sees.
const ROWS = [
  { kind: "crowd", axis: "primary-sweep", unit: "primary-sweep / the substring band [cl 9]",
    status: "coverage-limited", reason: "returned more records than could be listed in full",
    qid: "primary-sweep:substring:mc", total_hits: 288_411 },
  { kind: "seat", axis: "incumbent-class", unit: "incumbent-class / one proprietor's portfolio",
    status: "confirmed-clean", reason: "read in full", qid: null },
];

const rows = () => JSON.parse(renderCoverageLedgerJsonFromForm(ROWS, classTokensFromScopeText));

test("a row whose source holds a count and a question key carries both", () => {
  const [banded] = rows();
  assert.equal(banded.total_hits, 288_411,
    "the count is dropped on the way to the JSON, so the machine ledger cannot say how big the slice was");
  assert.equal(banded.qid, "primary-sweep:substring:mc",
    "without the question key the count can only be re-attached to the plan by matching prose");
  // The four fields that were always there are untouched — this adds columns, it does not restate a row.
  assert.equal(banded.axis, "primary-sweep");
  assert.equal(banded.status, "coverage-limited");
  assert.match(banded.reason, /more records than could be listed/);
});

test("a row whose source holds neither emits neither, rather than a zero or a null", () => {
  // A SEAT ROW HAS NO COUNT AND THAT IS A FACT ABOUT THE ROW. `total_hits: 0` would say the slice was
  // empty and `total_hits: null` would say the count was lost here; omitting the key says the row never
  // had one, which is what an optional column means in this contract.
  const [, seat] = rows();
  assert.equal("total_hits" in seat, false, "a seat row claims a count it was never given");
  assert.equal("qid" in seat, false, "a seat row claims a plan question it does not belong to");
  assert.equal(seat.status, "confirmed-clean", "precondition: the seat row rendered at all");
});

test("the strict contract admits the two columns and still refuses an unknown one", () => {
  // The parser is `additionalProperties:false` by hand, so widening the render without widening the
  // contract would throw at every read and silently degrade every coverage gate for the whole run.
  const out = renderCoverageLedgerJsonFromForm(ROWS, classTokensFromScopeText);
  assert.doesNotThrow(() => parseCoverageLedgerJson(out), "the derived JSON no longer round-trips");
  // And the guard is still a guard: one genuinely unknown key on an otherwise valid row still fails, with
  // the offending token first so the corrective hint can key on it.
  const withStray = JSON.stringify([{ ...JSON.parse(out)[0], invented_column: 1 }]);
  assert.throws(() => parseCoverageLedgerJson(withStray), /^Error: coverage_key_unknown:invented_column/,
    "widening the contract widened it to anything");
});

test("an archived ledger with neither column parses exactly as before", () => {
  const archived = JSON.stringify([
    { axis: "primary-sweep", scope: "the substring band", status: "coverage-limited", reason: "a crowd" },
  ]);
  assert.doesNotThrow(() => parseCoverageLedgerJson(archived),
    "rows written before these columns existed now fail the contract, which would fail every archived run");
});

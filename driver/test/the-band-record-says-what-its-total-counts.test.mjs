// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the band's record of what a register total counts, on invented names
//
// THE BAND'S RECORD SAYS WHAT ITS TOTAL COUNTS (ruled 2026-10-02: record only).
//
// When the register answered a question one row per record (a mark counted once per country it covers),
// the answer says `total_counts: "records"`. That statement has to survive every place the run keeps the
// question: the execution receipt row and the merged band's crowd. Each of those copies named fields, so
// each would drop a new one silently. The number itself is untouched. (The judges' pile that also carries
// it belongs to the engine rework and lives on that branch, not on this line.)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { joinPlanToBands } from "../register-plan.mjs";
import { parseNamedBand } from "../named-band.mjs";

const DIR = mkdtempSync(join(tmpdir(), "band-total-counts-"));
after(() => rmSync(DIR, { recursive: true, force: true }));

const PLAN = { plan_version: 1, regions: ["US"], entries: [
  { qid: "q-crowd", predicate: "contains", term: "QZXV", nice_classes: ["9"], goods_text: ["software"] },
  { qid: "q-listed", predicate: "exact", term: "QZXV", nice_classes: ["9"] },
] };
const BLOCKS = [
  { qid: "q-crowd", state: "incomplete", total_hits: 1756, fetched: 100, sample: [], reason: "a crowd", total_counts: "records",
    class_counts: { 9: { total_hits: 1756, disposition: "crowd", total_counts: "records" } } },
  { qid: "q-listed", state: "enumerated", records: [{ record_id: "/mark/us/1", mark_text: "QZXV" }], total_hits: 1 },
];

test("the receipt row keeps what the total counts, and only where the register said", () => {
  const { executed } = joinPlanToBands(PLAN, { "primary-sweep": BLOCKS });
  const row = (qid) => executed.find((x) => x.qid === qid);
  assert.equal(row("q-crowd").total_counts, "records");
  assert.equal(row("q-crowd").total_hits, 1756, "the register's own number, unchanged");
  assert.equal("total_counts" in row("q-listed"), false, "a statement the register never made");
});

test("the merged band's crowd keeps it, with its per-class counts", () => {
  const { crowds } = parseNamedBand(BLOCKS);
  assert.equal(crowds.length, 1);
  assert.equal(crowds[0].total_counts, "records");
  assert.equal(crowds[0].class_counts[9].total_counts, "records");
});


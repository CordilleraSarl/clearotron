// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-record-asked-for-and-never-delivered.test.mjs —.
//
// `band_record` logs every miss with its record id, the requesting session and the reason, and the audit
// already renders each one as a `MISS (not-fetched)` line. What nothing stated was the COVERAGE FACT: how
// many documents a judgment stage requested and the run never delivered. A judgment stage that asked for
// a document and did not get it reasoned on partial evidence, and that fact lived only in a log nothing
// consults.
//
// THE NUMBER THAT MEASURES HARM IS THE SMALL ONE. Measured over 36 preserved runs: 125 failed opens, 108
// distinct (run, record) pairs, and 66 of those recovered on a later open INSIDE THE SAME RUN. 42 is the
// count where a stage genuinely proceeded without the body. So a record is listed here only when EVERY
// open for it failed — one success anywhere clears it, because the stage got the document. Reporting the
// raw miss count would overstate the harm roughly threefold, which is its own kind of wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
// DYNAMIC, not a named static import. An ES module throws at LINK time for a missing named export, so a
// static `import { recordsNeverDelivered }` would stop this file loading against the pre-fix tree — the
// revert check would then report one dead file instead of which arms discriminate. A `??` fallback does
// not help: the link failure happens before any expression runs.
const AUDIT = await import("../publish/audit-from-spine.mjs");
const { buildAuditMd } = AUDIT;
const recordsNeverDelivered = AUDIT.recordsNeverDelivered ?? (() => null);

const open = (id, ok, extra = {}) => ({ tool: "band_record", args: { record_id: id }, ok,
  session: "prelim-x-y-placement-inquiry", ...extra });

// Minimal spine the builder needs; the reading audit is what these arms are about.
const SPINE = "## Findings\n\n| # | Mark | Owner | Band |\n|---|---|---|---|\n| 1 | ZEPHYR | Verrit Instruments Ltd | High |\n";
const build = (readingLog) => buildAuditMd(SPINE, "", { readingLog });

test("#1498 a record asked for and never delivered is named and counted", () => {
  const log = [open("/mark/ch/AAA", false, { reason: "not-fetched" }), open("/mark/ch/AAA", false, { reason: "not-fetched" })];
  const rows = recordsNeverDelivered(log);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].record_id, "/mark/ch/AAA");
  assert.equal(rows[0].misses, 2);
  assert.deepEqual(rows[0].reasons, ["not-fetched"]);

  const { md, counts } = build(log);
  assert.equal(counts.recordsNeverDelivered, 1, "the count must reach run.jsonl, not only the prose");
  assert.match(md, /Requested and never delivered — 1 record\(s\)/);
  assert.match(md, /\/mark\/ch\/AAA/);
  assert.match(md, /2 failed open\(s\)/);
  // The sentence has to say what it COSTS, or a reader treats it as retrieval noise.
  assert.match(md, /rested on the band row alone, not on the document/);
});

test("#1498 THE OTHER DIRECTION — a record that recovered in the same run is NOT listed", () => {
  // Criterion 3's second half, and the arm that keeps the number honest. Two thirds of real misses
  // recover on a later open; listing them would report 125 where the truth is 42.
  const log = [open("/mark/ch/AAA", false, { reason: "not-fetched" }), open("/mark/ch/AAA", true, { bytes: 7849 })];
  assert.deepEqual(recordsNeverDelivered(log), [], "a record the stage eventually got was reported as never delivered");

  const { md, counts } = build(log);
  assert.equal(counts.recordsNeverDelivered, 0);
  assert.doesNotMatch(md, /Requested and never delivered/);
  // The miss itself still shows in the lookup list — it is a retrieval fact, just not a coverage gap.
  assert.match(md, /MISS \(not-fetched\)/);
});

test("#1498 order does not matter — a success BEFORE the miss also clears it", () => {
  // The real shape from the artifacts is miss-then-success, but nothing guarantees ordering, and a rule
  // that only looked backwards would count a record the run demonstrably holds.
  const log = [open("/mark/ch/AAA", true, { bytes: 10 }), open("/mark/ch/AAA", false, { reason: "not-fetched" })];
  assert.deepEqual(recordsNeverDelivered(log), []);
});

test("#1498 the zero is PRINTED when every record was delivered", () => {
  // An absent section reads as "nobody checked". This is the only form in which the zero means anything.
  const { md, counts } = build([open("/mark/ch/AAA", true, { bytes: 10 })]);
  assert.equal(counts.recordsNeverDelivered, 0);
  assert.match(md, /every record a judgment stage asked for was delivered at least once this run/);
});

test("#1498 only band_record opens count, and a malformed row cannot invent one", () => {
  // `band_lookup` and `band_shape` rows carry no record id and are a different question; a row with no
  // id at all must not become a phantom entry, which is how a disclosure starts overstating itself.
  const log = [
    { tool: "band_lookup", args: { text: "ZEPHYR" }, ok: false, reason: "not-fetched" },
    { tool: "band_record", args: {}, ok: false, reason: "not-fetched" },
    { tool: "band_record", ok: false },
    open("/mark/ch/AAA", false, { reason: "not-fetched" }),
  ];
  const rows = recordsNeverDelivered(log);
  assert.equal(rows.length, 1, `a non-record row became a never-delivered entry: ${JSON.stringify(rows)}`);
  assert.equal(rows[0].record_id, "/mark/ch/AAA");
});

test("#1498 no reading log at all leaves the audit byte-identical", () => {
  // Legacy and replay callers pass nothing. They must gain no section and no count — a disclosure that
  // appears on runs which recorded nothing is a disclosure about nothing.
  const { md, counts } = buildAuditMd(SPINE, "", {});
  assert.equal(recordsNeverDelivered(undefined), null);
  assert.equal(counts.recordsNeverDelivered, 0);
  assert.doesNotMatch(md, /Requested and never delivered/);
  assert.doesNotMatch(md, /# Reading audit/);
});

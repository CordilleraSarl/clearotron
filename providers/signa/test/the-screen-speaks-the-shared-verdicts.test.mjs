// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-screen-speaks-the-shared-verdicts.test.mjs — this register's screen writes the closed set of verdicts
// every other register writes, so the checks that key on them fire here too.
//
// THE DEFECT. The search-row screen wrote its own words: keep, keep-dead, out-of-class, unscoped, unknown.
// No check reads them. The gate that refuses dropping a live, in-class record nobody opened acts only on
// `surface:*`, so on this register a live filing could be dropped on its goods unread. A dead or
// out-of-class drop must match `drop:dead` or `drop:out-of-class`, so every drop on the screen's own
// ground was refused.
//
// NO VENDOR MEASUREMENTS AND NO REAL MARK OR OWNER live here. The strings are invented.
import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeSearchResponse, rowScreen } from "../src/core.js";
import { SCREEN_VERDICTS } from "../../_shared/result-shape.mjs";
import { findScreenGateViolations } from "../../../driver/screen-gate.mjs";

const vendorRow = (status, classes) => ({
  id: "a1", mark_text: "VELTRANO", jurisdiction_code: "US", office_code: "US",
  status, classifications: classes.map((c) => ({ nice_class: c })), owners: [],
  filing_date: "2019-03-04",
});
const screenOf = (status, classes, scope) => rowScreen(
  normalizeSearchResponse({ data: [vendorRow(status, classes)], pagination: { total_count: 1, has_more: false } }, "veltrano").results[0],
  scope);
const LIVE = { primary: "active", stage: "registered" };

test("every verdict is one of the shared set, landing where the other registers put the same record", () => {
  const cases = [
    [LIVE, [9], [9], "surface:in-scope-live"],
    [{ primary: "cancelled" }, [9], [9], "drop:dead"],
    [{ primary: "", stage: "", raw_label: "odd" }, [9], [9], "deepfetch:ambiguous"],
    [LIVE, [25], [9], "drop:out-of-class"],
    [LIVE, [9], [], "surface:in-scope-live"],     // no scope asked: still a candidate
    [LIVE, [], [9], "surface:in-scope-live"],     // no classes on the row: still a candidate
  ];
  for (const [status, classes, scope, want] of cases) {
    const v = screenOf(status, classes, scope).screen_verdict;
    assert.ok(SCREEN_VERDICTS.includes(v), `${v} is outside the shared set`);
    assert.equal(v, want, JSON.stringify({ status, classes, scope }));
  }
});

test("a live in-class record dropped on its goods, never opened, is caught by the gate on this register", () => {
  const verdict = screenOf(LIVE, [9], [9]).screen_verdict;
  const findings = [
    "### Negative results",
    "| Mark | Source | Result | Notes |",
    "|---|---|---|---|",
    `| VELTRANO | register | off-field | /mark/us/a1 screen_verdict=${verdict} |`,
  ].join("\n");
  const violations = findScreenGateViolations(findings, new Set());
  assert.equal(violations.length, 1, `the gate let the drop through with screen_verdict=${verdict}`);
  assert.equal(violations[0].uri, "/mark/us/a1");
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WORKBOOK SAYS EACH DRIVER'S EVIDENCE AS THE PAGE DOES. The audit workbook's driver cells tagged every value
// "from source" or "our read", and claimed more than the report: a Use value read from a website was said to be
// checked against the register record, which the page does not say (2026-08-31). Each cell now carries the
// report's own evidence word for the meter's joined status (publish/evidence-words.mjs): "verified", "not yet
// verified", "inferred" or "not checked"; none under Similarity; only "inferred" or "not checked" on Use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { meterCell } from "../publish/xlsx.mjs";

test("a known value carries the report's word for its joined status", () => {
  for (const driver of ["goods_proximity", "enforcer"]) {
    assert.equal(meterCell({ token: "high", _status: "confirmed" }, driver), "high · verified", driver);
    assert.equal(meterCell({ token: "high", _status: "assumed" }, driver), "high · not yet verified", driver);
    assert.equal(meterCell({ token: "medium", _status: "inferred" }, driver), "medium · inferred", driver);
  }
  // Without a joined status the enforcer falls back to its basis, as the page does; goods proximity says nothing.
  assert.equal(meterCell({ token: "medium", basis: "inferred-from-signal" }, "enforcer"), "medium · inferred");
  assert.equal(meterCell({ token: "medium", basis: "inferred-from-signal" }, "goods_proximity"), "medium");
});

test("Use carries no verification word, and keeps 'inferred' and 'not checked'", () => {
  assert.equal(meterCell({ token: "confirmed", _status: "confirmed" }, "use"), "confirmed");
  assert.equal(meterCell({ token: "confirmed", _status: "inferred" }, "use"), "confirmed · inferred");
  assert.equal(meterCell({ token: "unknown", _status: "not-checked" }, "use"), "unknown · not checked");
});

test("Similarity carries no evidence word at all", () => {
  assert.equal(meterCell({ token: "high", _status: "confirmed" }, "mark_similarity"), "high");
  assert.equal(meterCell({ token: "unknown" }, "mark_similarity"), "unknown");
});

test("an unknown value nobody checked reads 'not checked' where the page has no word for it", () => {
  for (const driver of ["goods_proximity", "use", "enforcer"]) assert.equal(meterCell({ token: "unknown" }, driver), "unknown · not checked", driver);
  assert.equal(meterCell(null, "use"), "");
});

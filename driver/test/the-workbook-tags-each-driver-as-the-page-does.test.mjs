// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WORKBOOK TAGS EACH DRIVER AS THE PAGE DOES. The audit workbook's four driver cells each said how their
// value was evidenced, "from source" or "our read", and claimed more than the report: a Use value read from a
// website was said to be checked against the register record, which the page does not say (2026-08-31), and an
// unknown value was "our read" where the page says "not checked". The four cases, one at a time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { meterCell } from "../publish/xlsx.mjs";

test("an unknown value reads 'not checked' on every driver, whatever its basis says", () => {
  for (const driver of ["mark_similarity", "goods_proximity", "use", "enforcer"]) {
    for (const basis of ["verified-from-record", "inferred-from-signal", undefined]) {
      assert.equal(meterCell({ token: "unknown", basis }, driver), "unknown · not checked", `${driver}, ${basis}`);
    }
  }
});

test("a known Use value read from the record carries no verification word; an inferred one keeps 'our read'", () => {
  assert.equal(meterCell({ token: "confirmed", basis: "verified-from-record" }, "use"), "confirmed");
  assert.equal(meterCell({ token: "confirmed", basis: "inferred-from-signal" }, "use"), "confirmed · our read");
});

test("a known value on the other three drivers keeps 'from source' and 'our read', which the legend explains", () => {
  for (const driver of ["mark_similarity", "goods_proximity", "enforcer"]) {
    assert.equal(meterCell({ token: "high", basis: "verified-from-record" }, driver), "high · from source", driver);
    assert.equal(meterCell({ token: "medium", basis: "inferred-from-signal" }, driver), "medium · our read", driver);
  }
});

test("no value, no cell", () => {
  assert.equal(meterCell(null, "use"), "");
  assert.equal(meterCell({ basis: "verified-from-record" }, "enforcer"), "");
});

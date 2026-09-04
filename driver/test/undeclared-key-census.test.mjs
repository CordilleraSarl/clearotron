// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the predicate behind scripts/undeclared-key-census.mjs
// — a legitimate field sent to the wrong object is accepted and dropped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { undeclaredKeys } from "../../shared/undeclared-keys.mjs";

const SCHEMA = Object.freeze({
  type: "object",
  properties: {
    narrative: { type: "object", properties: { spine: {}, verdict: {} } },
    rows: { type: "array", items: { type: "object", properties: { ordinal: {} } } },
    open: {},
  },
});

test("1998: a key inside an ALREADY-TYPED object is reported, with its path", () => {
  // The shape the issue is named for: `corrections` is a legitimate field of the findings document, sent
  // inside `narrative`, which declares four keys and not that one. Accepted, and dropped.
  assert.deepEqual(undeclaredKeys(SCHEMA, { narrative: { spine: "…", corrections: { applied: true } } }),
    ["narrative.corrections"],
    "an undeclared key nested inside a declared object was not reported — that is the whole defect: a "
    + "seat that puts a legitimate field in the wrong place is told the call was well-formed");
});

test("1998: array items are walked, and the path names WHICH row", () => {
  assert.deepEqual(undeclaredKeys(SCHEMA, { rows: [{ ordinal: 1 }, { ordinal: 2, mark: "X" }] }),
    ["rows[1].mark"],
    "a row index is the difference between a reader who can find the key and one who cannot");
});

test("1998: a clean call reports nothing, so the census is not satisfied by always firing", () => {
  assert.deepEqual(undeclaredKeys(SCHEMA, { narrative: { spine: "…", verdict: "…" }, rows: [{ ordinal: 1 }] }), []);
});

test("1998: an object the schema declares WITHOUT properties reports nothing — stated, not hidden", () => {
  // `findings.items` on record_synthesis is exactly this: declared, with no properties, so nothing inside
  // it can ever be flagged. That is honest behaviour for a schema that says "any object", and it is also
  // why a clean census is not by itself evidence that a transport is fully declared. Recorded here so the
  // next reader does not take an empty report for a complete one.
  assert.deepEqual(undeclaredKeys(SCHEMA, { open: { anything: 1, at: { any: "depth" } } }), [],
    "an open object must not be reported — but this arm exists so that silence is a KNOWN property "
    + "rather than a surprise");
});

test("1998: a non-object where the schema wants one is not walked into and does not throw", () => {
  assert.deepEqual(undeclaredKeys(SCHEMA, { narrative: null }), []);
  assert.deepEqual(undeclaredKeys(SCHEMA, { rows: "not an array" }), []);
  assert.deepEqual(undeclaredKeys(SCHEMA, null), []);
  assert.deepEqual(undeclaredKeys(null, { anything: 1 }), []);
});

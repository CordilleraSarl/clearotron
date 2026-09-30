// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN EXPIRY DATE THIS CONNECTOR CANNOT FIND READS AS A RECORD THAT NEVER HAD ONE.
//
// Signa's 27 September release split what an office published from what Signa computes. `expiry_date`
// now carries only the published date, and is empty on USPTO records; the computed one is under
// `derived.expiry_date`. This connector read one place, so the field went quietly null.
//
// MEASURED ON THE RECORD BODIES OF THE RUN THAT STRADDLED THE RELEASE, not inferred from the note: of
// nine US records, four carried an expiry only under `derived` and all four normalised to null here.
// Every non-US office on that run carried it where it always was. Where both places are present they
// agree — 12 of 12 — which is why the published date can come first at no cost.
//
// WHY IT IS WORTH AN ARM RATHER THAN A ONE-LINE FIX. The field's whole purpose is stated where it is
// read: a year cannot say whether a registration lapses this month. A null does not say "not published";
// it removes the line from the card, so a reader cannot tell a record with no expiry from one whose
// expiry the connector could not find. That is the same absence-as-a-pass this repository's checks exist
// to refuse, one field wide.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRecord } from "../src/core.js";

const base = { id: "tm_1", mark_text: "INVENTEDMARK", jurisdiction_code: "us" };

test("an expiry only under derived is read, not dropped", () => {
  const r = normalizeRecord({ ...base, derived: { expiry_date: "2031-04-18" } }, "us");
  assert.equal(r.expiryDate, "2031-04-18",
    "a US record whose expiry moved under derived normalised to null, which reads as a record that never had one");
});

test("the office's own date comes first where both are present", () => {
  const r = normalizeRecord({ ...base, expiry_date: "2030-01-02", derived: { expiry_date: "2031-04-18" } }, "us");
  assert.equal(r.expiryDate, "2030-01-02",
    "the published date must win: it is the office's, and the other is a computation");
});

test("neither place is still null — a record with no expiry has none", () => {
  assert.equal(normalizeRecord({ ...base }, "us").expiryDate, null);
  assert.equal(normalizeRecord({ ...base, derived: {} }, "us").expiryDate, null);
  assert.equal(normalizeRecord({ ...base, derived: { expiry_date: null } }, "us").expiryDate, null,
    "an explicit null under derived is an absence, not a value");
});

test("a record with no derived object at all does not throw", () => {
  // Every pre-release body carried one, but a connector that assumes it is a connector that breaks on
  // the first response that does not.
  assert.doesNotThrow(() => normalizeRecord({ ...base, expiry_date: "2030-01-02" }, "us"));
  assert.equal(normalizeRecord({ ...base, expiry_date: "2030-01-02" }, "us").expiryDate, "2030-01-02");
});

test("CONTROL — the fallback reaches no other date", () => {
  // A fallback written once tends to be written twice. Filing and registration dates are the office's
  // alone, and a derived twin must not reach them by accident.
  const r = normalizeRecord({ ...base,
    derived: { filing_date: "2019-01-01", registration_date: "2020-01-01", expiry_date: "2031-04-18" } }, "us");
  assert.equal(r.applicationDate, null, "a derived filing date reached applicationDate");
  assert.equal(r.registrationDate, null, "a derived registration date reached registrationDate");
  assert.equal(r.expiryDate, "2031-04-18");
});

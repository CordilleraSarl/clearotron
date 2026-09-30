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

// ── THE OTHER TWO FIELDS THE SAME RELEASE MOVED ───────────────────────────────────────────────────

test("the opposition window is read from the computed object, as the OBJECT it is", () => {
  // Not a path swap: the window used to be a scalar and is now a shape. An arm that only checked for
  // non-null would pass on a connector that put an object where a caller expects a date.
  const w = { supported: true, window_opens: "2026-01-05", window_closes: "2026-04-05" };
  assert.deepEqual(normalizeRecord({ ...base, derived: { opposition_window: w } }, "us").oppositionWindow, w);
  // The not-opposable shape is a real answer and must survive intact rather than flatten to null.
  const no = { supported: false, reason: "stage_not_opposable", rule_id: "eu_opposition" };
  assert.deepEqual(normalizeRecord({ ...base, derived: { opposition_window: no } }, "us").oppositionWindow, no,
    "a stage that cannot be opposed is a stated answer, not an absence");
  assert.equal(normalizeRecord({ ...base }, "us").oppositionWindow, null,
    "no window in either place is an absence");
});

test("a top-level opposition window still wins, if the register ever sends one again", () => {
  const top = { supported: true, window_opens: "2025-01-01" };
  const der = { supported: false, reason: "stage_not_opposable" };
  assert.deepEqual(normalizeRecord({ ...base, opposition_window: top, derived: { opposition_window: der } }, "us")
    .oppositionWindow, top);
});

test("SYNTHETIC — the renewal fallback, which the data we hold never exercises", () => {
  // Stated as synthetic on purpose. Of the 22 bodies from the run that straddled the release, none
  // carried a renewal date in either place, so nothing here reproduces a recovery we have observed. The
  // fallback exists because the register names this field as moving with expiry, and reading one place is
  // exactly how the expiry loss happened.
  assert.equal(normalizeRecord({ ...base, derived: { renewal_due_date: "2032-06-01" } }, "us").renewalDueDate,
    "2032-06-01");
  assert.equal(normalizeRecord({ ...base, renewal_due_date: "2031-06-01", derived: { renewal_due_date: "2032-06-01" } }, "us")
    .renewalDueDate, "2031-06-01", "the office's own date comes first here too");
  assert.equal(normalizeRecord({ ...base }, "us").renewalDueDate, null);
});

test("CONTROL — the IR number format change needs nothing, and the fallbacks did not reach it", () => {
  // The register dropped the WO prefix from an international registration's number, so it now equals
  // `ir_number`. This connector already read `registration_number ?? ir_number`, so both forms land the
  // same; measured on the run's four WO records, the two fields agree. Asserted here so a later edit to
  // the lines above cannot quietly add a derived fallback to a field that needs none.
  assert.equal(normalizeRecord({ ...base, jurisdiction_code: "wo", registration_number: "1508624", ir_number: "1508624" }, "wo")
    .registrationNumber, "1508624");
  assert.equal(normalizeRecord({ ...base, jurisdiction_code: "wo", ir_number: "1508624" }, "wo").registrationNumber, "1508624");
  assert.equal(normalizeRecord({ ...base, derived: { registration_number: "9999999" } }, "us").registrationNumber, null,
    "a computed registration number reached the field that carries the office's own");
});

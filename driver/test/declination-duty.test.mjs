// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// declination-duty.test.mjs — every record synthesis was handed left by a named exit, or the run says
// which ones did not. ('s missing half; is the incident.)
//
// WHAT THESE ARMS ARE FOR. The rule is already dictated — synthesis's contract says a record leaves as
// a finding or as a declination and there is no third way out — and nothing checked it. So the arms
// that matter are not "does the happy path work"; they are the ones that separate the four states a
// count cannot tell apart:
//
//   · accounted   delivered, or declined
//   · unaccounted handed over and neither — the defect
//   · UNORDERED   no spec, so the seat was never told to decline: NOT a defect, and not a pass either
//   · unreadable  a side of the join could not be read: could-not-look, never zero
//
// The last two are why every input is three-valued and `null` is never treated as empty. A zero here
// would read as "everything was accounted for", which is the exact inversion this check exists to stop.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconcileDeclinationDuty, declinationDutyRefusal, declinationDutyEvent,
  DECLINATION_DUTY_SCHEMA_VERSION,
} from "../declination-duty.mjs";

const row = (uri, extra = {}) => ({ uri, mark: `MARK ${uri.slice(-3)}`, owner: "Someone GmbH", ...extra });
const OWED3 = [row("/mark/eu/1"), row("/mark/eu/2"), row("/mark/eu/3")];

// ── the join ────────────────────────────────────────────────────────────────────────────────────────

test("a record delivered as a finding is accounted for", () => {
  const r = reconcileDeclinationDuty({ owed: [row("/mark/eu/1")], deliveredUris: ["/mark/eu/1"], declinedUris: [] });
  assert.equal(r.computable, true);
  assert.equal(r.totals.unaccounted, 0);
  assert.equal(r.totals.delivered, 1);
  assert.equal(declinationDutyRefusal(r), null, "a clean call meets no refusal");
});

test("a record DECLINED is accounted for — declining is a complete answer, not a failure", () => {
  // The single most important arm in the file. If declining did not discharge the duty, the rule would
  // order the seat to deliver everything, which is the opposite of what the doctrine says.
  const r = reconcileDeclinationDuty({ owed: [row("/mark/eu/1")], deliveredUris: [], declinedUris: ["/mark/eu/1"] });
  assert.equal(r.totals.unaccounted, 0);
  assert.equal(r.totals.declined, 1);
  assert.equal(declinationDutyRefusal(r), null);
});

test("a record handed over and neither delivered nor declined is the defect, NAMED", () => {
  const r = reconcileDeclinationDuty({ owed: OWED3, deliveredUris: ["/mark/eu/1"], declinedUris: ["/mark/eu/2"] });
  assert.equal(r.totals.unaccounted, 1);
  assert.deepEqual(r.unaccounted.map((u) => u.uri), ["/mark/eu/3"]);
  const refusal = declinationDutyRefusal(r);
  assert.match(refusal, /^synthesis_unaccounted_records:1 of 3/, "token first, then the count");
  assert.match(refusal, /\/mark\/eu\/3/, "and it NAMES the record — a seat handed a number cannot act on it");
  assert.match(refusal, /DECLINING IS A COMPLETE ANSWER/,
    "…and says both exits are open, so declining does not read as an admission of failure");
});

test("the count comes before the records, so one lost and ninety lost do not read alike", () => {
  const many = Array.from({ length: 90 }, (_, i) => row(`/mark/eu/${i + 100}`));
  const r = reconcileDeclinationDuty({ owed: many, deliveredUris: [], declinedUris: [] });
  const refusal = declinationDutyRefusal(r);
  assert.match(refusal, /^synthesis_unaccounted_records:90 of 90/);
  assert.match(refusal, /\(\+78 more\)/, "the remainder is COUNTED, never trailed off with an ellipsis");
});

// ── the states a count cannot tell apart ────────────────────────────────────────────────────────────

test("NO SPEC is not a pass and not a defect — the seat was never ordered", () => {
  // The spec is written only when there are rows, and its write is non-fatal by design, so an absent
  // spec has two causes and NEITHER is a seat defect. What it must never do is report zero unaccounted.
  const r = reconcileDeclinationDuty({ owed: null, deliveredUris: [], declinedUris: [] });
  assert.equal(r.computable, false);
  assert.equal(r.totals, undefined, "computable:false carries NO counts — a zero would read as 'all accounted for'");
  assert.match(r.reason, /never ordered/);
  assert.equal(declinationDutyRefusal(r), null, "and it cannot refuse a seat for an order it never got");
});

test("an unreadable SIDE of the join is could-not-look, per side, with its own reason", () => {
  for (const [what, args] of [
    ["the findings", { owed: OWED3, deliveredUris: null, declinedUris: [] }],
    ["the ledger", { owed: OWED3, deliveredUris: [], declinedUris: null }],
  ]) {
    const r = reconcileDeclinationDuty(args);
    assert.equal(r.computable, false, `${what} unreadable must not compute`);
    assert.equal(r.totals, undefined);
    assert.equal(declinationDutyRefusal(r), null);
  }
  // NEGATIVE CONTROL: an EMPTY ledger is a real answer — nothing was declined — and must still compute,
  // or a run that legitimately declined nothing would report as unreadable forever.
  const empty = reconcileDeclinationDuty({ owed: OWED3, deliveredUris: [], declinedUris: [] });
  assert.equal(empty.computable, true);
  assert.equal(empty.totals.unaccounted, 3);
});

test("an EMPTY owed list computes and reconciles at 0 — nothing was carried, nothing is owed", () => {
  const r = reconcileDeclinationDuty({ owed: [], deliveredUris: [], declinedUris: [] });
  assert.equal(r.computable, true);
  assert.equal(r.totals.owed, 0);
  assert.equal(r.reconciles, true);
  assert.equal(declinationDutyRefusal(r), null);
});

// ── the join's own failure modes ────────────────────────────────────────────────────────────────────

test("one normaliser: the three sides join across spelling differences, not by luck", () => {
  // Two spellings of one uri is how a join like this reports a loss that never happened — and then gets
  // switched off for crying wolf. Every side is normalised HERE, so a caller that forgets cannot make
  // the join lie.
  const r = reconcileDeclinationDuty({
    owed: [row("/mark/EU/1"), row("https://example.test/mark/eu/2")],
    deliveredUris: ["/mark/eu/1"],
    declinedUris: ["/mark/eu/2"],
  });
  assert.equal(r.totals.unaccounted, 0, "case and host differences must not read as two lost records");
});

test("a record listed twice is ONE duty, and the totals still reconcile", () => {
  const r = reconcileDeclinationDuty({
    owed: [row("/mark/eu/1"), row("/mark/eu/1")], deliveredUris: [], declinedUris: [],
  });
  assert.equal(r.totals.owed, 1);
  assert.equal(r.totals.unaccounted, 1);
  assert.equal(r.reconciles, true);
});

test("a spec row with no uri is not blamed on the seat — it cannot be cited either", () => {
  // The decline tool addresses records BY POSITION in this list, so a row the driver could not identify
  // is unaddressable at both ends. Counting it as a seat failure would send the seat looking for a
  // record it was never given.
  const r = reconcileDeclinationDuty({ owed: [row("/mark/eu/1"), { mark: "NO URI" }], deliveredUris: ["/mark/eu/1"], declinedUris: [] });
  assert.equal(r.totals.owed, 1);
  assert.equal(r.totals.unaccounted, 0);
  assert.equal(declinationDutyRefusal(r), null);
});

test("delivered AND declined is counted and reported, and is NOT refused", () => {
  // No ruling covers it and it can be honest — a finding names several registrations and one may be
  // separately declined. Refusing here would be this module inventing a second, unruled obligation.
  const r = reconcileDeclinationDuty({ owed: [row("/mark/eu/1")], deliveredUris: ["/mark/eu/1"], declinedUris: ["/mark/eu/1"] });
  assert.equal(r.totals.both, 1);
  assert.equal(r.totals.unaccounted, 0);
  assert.equal(declinationDutyRefusal(r), null);
});

// ── the run-log row ─────────────────────────────────────────────────────────────────────────────────

test("the event carries counts only when it computed, and a reason when it did not", () => {
  const ok = declinationDutyEvent({ trigger: "t", artifact: reconcileDeclinationDuty({ owed: OWED3, deliveredUris: ["/mark/eu/1"], declinedUris: [] }) });
  assert.equal(ok.computable, true);
  assert.equal(ok.owed, 3);
  assert.equal(ok.unaccounted, 2);
  const no = declinationDutyEvent({ trigger: "t", artifact: reconcileDeclinationDuty({ owed: null }) });
  assert.equal(no.computable, false);
  assert.equal(no.owed, undefined, "no counts on a could-not-look — that is the whole point of the field");
  assert.match(no.reason, /never ordered/);
});

test("the schema version is stated on the artifact", () => {
  assert.equal(reconcileDeclinationDuty({ owed: [] }).schema_version, DECLINATION_DUTY_SCHEMA_VERSION);
  assert.equal(reconcileDeclinationDuty({ owed: null }).schema_version, DECLINATION_DUTY_SCHEMA_VERSION);
});

test("malformed inputs do not throw — this reads three artifacts written by other code", () => {
  for (const args of [{}, { owed: [null] , deliveredUris: [null], declinedUris: [undefined] },
                      { owed: [{}], deliveredUris: [{}], declinedUris: [{}] }]) {
    const r = reconcileDeclinationDuty(args);
    assert.equal(typeof r.schema_version, "number");
  }
});

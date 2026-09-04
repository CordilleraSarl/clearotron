// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e-mark-provenance.test.mjs — pins the answer to "did this round enter the register HIT path?"
//
// Why this file exists: every mark in the E2E scenario corpus was invented, so every register call
// returned zero rows, and zero rows is the one input on which screening, close-variation matching,
// record hydration and citation fidelity all do nothing. A whole round could be green while the most
// breakable half of the register path was never entered, and nothing said so.
//
// The three things pinned here are the three ways that finding could quietly come back:
//   1. an unstated label defaulting to "synthetic" — a guess presented as a fact;
//   2. a floor op comparing an UNTAKEN count as if it were a small one, so a dead credential would
//      read as a register that had emptied out;
//   3. a records floor reading a structural REFUSAL as an empty list.
//
// FIXTURES ARE REAL SHAPES. The count and record documents below carry the field names and nesting
// that driver/register-count.mjs and driver/register-records.mjs actually write, including the
// `total: null` + `unavailable` pair and the per-term `ok`/`reason` pair. The mark names are the
// corpus's own or plainly invented; no production matter appears here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { driverDir } from "../../shared/driver-dir.mjs";

import { evalAssertion, markProvenanceOf, registerCountsWitness, MARK_PROVENANCE } from "../../scripts/e2e.mjs";

const runDirWith = (files) => {
  const d = mkdtempSync(join(tmpdir(), "e2e-markprov-"));
  mkdirSync(driverDir(d, ""), { recursive: true });
  for (const [name, doc] of Object.entries(files)) writeFileSync(driverDir(d, name), JSON.stringify(doc, null, 2));
  return d;
};

const counts = (marks) => ({ schema: 1, provider: "clarivate", takenAt: "2026-08-25T00:00:00.000Z", marks });
const records = (extra) => ({ schema: 1, provider: "clarivate", takenAt: "2026-08-25T00:00:00.000Z", ...extra });

// ── the label, and its third state ───────────────────────────────────────────────────────────────────

test("a stated label is read as stated", () => {
  assert.equal(markProvenanceOf({ markProvenance: "live" }).state, MARK_PROVENANCE.LIVE);
  assert.equal(markProvenanceOf({ markProvenance: "synthetic" }).state, MARK_PROVENANCE.SYNTHETIC);
});

test("AN UNSTATED LABEL IS NEVER SYNTHETIC — it is UNSTATED, and it says so", () => {
  for (const sc of [{}, { markProvenance: null }, { markProvenance: "" }, { markProvenance: "  " }]) {
    const mp = markProvenanceOf(sc);
    assert.equal(mp.state, MARK_PROVENANCE.UNSTATED,
      `${JSON.stringify(sc)} must not resolve to a state the store never claimed`);
    assert.match(mp.why, /CANNOT BE TOLD/);
  }
});

test("a label that is neither word is UNSTATED and quotes what it found", () => {
  const mp = markProvenanceOf({ markProvenance: "real" });
  assert.equal(mp.state, MARK_PROVENANCE.UNSTATED);
  assert.match(mp.why, /"real"/);
});

// ── the run's own corroboration ──────────────────────────────────────────────────────────────────────

test("an UNTAKEN count is not a zero — the witness counts the two separately", () => {
  const d = runDirWith({ "register-counts.json": counts([{ name: "ORBIT",
    counts: { identical: { total: null, unavailable: "the credential was refused" }, containing: { total: 0 } } }]) });
  const w = registerCountsWitness([d]);
  assert.equal(w.cells, 2);
  assert.equal(w.taken, 1, "only the cell carrying a number was taken");
  assert.equal(w.untaken, 1);
  assert.equal(w.nonZero, 0);
  rmSync(d, { recursive: true, force: true });
});

test("the witness reports no sidecar rather than an empty register", () => {
  const d = mkdtempSync(join(tmpdir(), "e2e-markprov-"));
  assert.deepEqual(registerCountsWitness([d]), { sidecars: 0, cells: 0, taken: 0, nonZero: 0, untaken: 0, best: 0 });
  rmSync(d, { recursive: true, force: true });
});

// ── register-count-floor ─────────────────────────────────────────────────────────────────────────────

test("register-count-floor passes ABOVE the floor and reports what it saw", () => {
  const d = runDirWith({ "register-counts.json": counts([{ name: "ORBIT",
    counts: { identical: { total: 97 }, containing: { total: 601 } } }]) });
  const r = evalAssertion({ op: "register-count-floor", path: "_driver/register-counts.json:ORBIT",
    value: { identical: 45, containing: 250 } }, d);
  assert.equal(r.ok, true);
  assert.match(r.saw, /identical=97/);
  rmSync(d, { recursive: true, force: true });
});

test("register-count-floor FAILS below the floor without proposing a lower one", () => {
  const d = runDirWith({ "register-counts.json": counts([{ name: "ORBIT", counts: { identical: { total: 12 } } }]) });
  const r = evalAssertion({ op: "register-count-floor", path: "_driver/register-counts.json:ORBIT",
    value: { identical: 45 } }, d);
  assert.equal(r.ok, false);
  assert.match(r.saw, /below the floor/);
  rmSync(d, { recursive: true, force: true });
});

test("AN UNTAKEN COUNT FAILS AS UNTAKEN, never as a number below the floor", () => {
  const d = runDirWith({ "register-counts.json": counts([{ name: "ORBIT",
    counts: { identical: { total: null, unavailable: "no register credential in scope" } } }]) });
  const r = evalAssertion({ op: "register-count-floor", path: "_driver/register-counts.json:ORBIT",
    value: { identical: 45 } }, d);
  assert.equal(r.ok, false);
  assert.match(r.saw, /NOT TAKEN/);
  assert.match(r.saw, /no register credential in scope/);
  assert.doesNotMatch(r.saw, /below the floor/,
    "a count that was never taken must not be reported as a register that has thinned out");
  rmSync(d, { recursive: true, force: true });
});

test("register-count-floor fails when the sidecar is absent — nothing written is not nothing found", () => {
  const d = mkdtempSync(join(tmpdir(), "e2e-markprov-"));
  const r = evalAssertion({ op: "register-count-floor", path: "_driver/register-counts.json:ORBIT", value: { identical: 45 } }, d);
  assert.equal(r.ok, false);
  assert.match(r.saw, /absent/);
  rmSync(d, { recursive: true, force: true });
});

test("register-count-floor names the marks it did count when the asked-for one is missing", () => {
  const d = runDirWith({ "register-counts.json": counts([{ name: "SOMETHING ELSE", counts: { identical: { total: 9 } } }]) });
  const r = evalAssertion({ op: "register-count-floor", path: "_driver/register-counts.json:ORBIT", value: { identical: 45 } }, d);
  assert.equal(r.ok, false);
  assert.match(r.saw, /SOMETHING ELSE/);
  rmSync(d, { recursive: true, force: true });
});

// ── register-records-floor ───────────────────────────────────────────────────────────────────────────

const rec = (territory, n) => Array.from({ length: n }, (_, i) => ({ recordId: `/mark/${territory}/${i}`, territory, mark: "ORBIT" }));

test("register-records-floor passes on enough rows across enough offices", () => {
  const d = runDirWith({ "register-records.json": records({ marks: [{ name: "ORBIT",
    terms: [{ term: "ORBIT", basis: "identical", ok: true, fetched: 33, total: 97 }],
    records: [...rec("us", 17), ...rec("em", 22), ...rec("wo", 1)] }] }) });
  const r = evalAssertion({ op: "register-records-floor", path: "_driver/register-records.json:ORBIT",
    value: { records: 20, offices: 2 } }, d);
  assert.equal(r.ok, true);
  assert.match(r.saw, /3 office\(s\)/);
  rmSync(d, { recursive: true, force: true });
});

test("ENOUGH ROWS FROM ONE OFFICE IS NOT ENOUGH — the office span is its own floor", () => {
  const d = runDirWith({ "register-records.json": records({ marks: [{ name: "ORBIT",
    terms: [{ term: "ORBIT", basis: "identical", ok: true, fetched: 40, total: 97 }], records: rec("us", 40) }] }) });
  const r = evalAssertion({ op: "register-records-floor", path: "_driver/register-records.json:ORBIT",
    value: { records: 20, offices: 2 } }, d);
  assert.equal(r.ok, false, "one office satisfying a total would let the dedup property lapse in silence");
  rmSync(d, { recursive: true, force: true });
});

test("A REFUSED LISTING FAILS AS A REFUSAL, never as a register holding nothing", () => {
  const d = runDirWith({ "register-records.json": records({
    unavailable: "this run counted from fixtures and no record fixtures are configured", marks: [] }) });
  const r = evalAssertion({ op: "register-records-floor", path: "_driver/register-records.json:ORBIT",
    value: { records: 20, offices: 2 } }, d);
  assert.equal(r.ok, false);
  assert.match(r.saw, /never listed/);
  assert.match(r.saw, /not a register that holds nothing/);
  rmSync(d, { recursive: true, force: true });
});

test("a failed term is named even when the floor is MET — it is reduced coverage either way", () => {
  const d = runDirWith({ "register-records.json": records({ marks: [{ name: "ORBIT",
    terms: [{ term: "ORBIT", basis: "identical", ok: true, fetched: 40, total: 97 },
            { term: "ORBYT", basis: "close", ok: false, reason: "the register timed out" }],
    records: [...rec("us", 20), ...rec("em", 20)] }] }) });
  const r = evalAssertion({ op: "register-records-floor", path: "_driver/register-records.json:ORBIT",
    value: { records: 20, offices: 2 } }, d);
  assert.equal(r.ok, true);
  assert.match(r.saw, /ORBYT/, "a pass that hides a refused term is how reduced coverage reads as full coverage");
  rmSync(d, { recursive: true, force: true });
});

test("a shortfall alongside a failed term says the fetch may be the cause", () => {
  const d = runDirWith({ "register-records.json": records({ marks: [{ name: "ORBIT",
    terms: [{ term: "ORBIT", basis: "identical", ok: false, reason: "HTTP 503" }], records: [] }] }) });
  const r = evalAssertion({ op: "register-records-floor", path: "_driver/register-records.json:ORBIT",
    value: { records: 20, offices: 2 } }, d);
  assert.equal(r.ok, false);
  assert.match(r.saw, /FAILED to fetch/);
  rmSync(d, { recursive: true, force: true });
});

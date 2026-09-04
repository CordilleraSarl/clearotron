// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Timeout-taint detection (copper-lattice 2026-07-08): a register-unit pass whose winning band was
// touched by a kill-class attempt must read TAINTED from the per-attempt stage jsonl alone — the
// in-memory turn object does not survive --resume, the jsonl does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bandPassTaint, isTaintRow, TAINT_FAIL_RE } from "../register-taint.mjs";

const L = (rows) => rows.map((r) => JSON.stringify(r));
const row = (over) => ({ ts: "2026-07-08T10:00:00Z", attempt: 1, key: "k1", code: 0, wall: 900, fail: null, ...over });

test("the REAL incident signature — success, then a followup SIGKILL mutates the band, then a retry 'success' — is TAINTED", () => {
  // copper-lattice's actual jsonl: the original pass validated; the frame-reopen followup (same base
  // key) was SIGKILLed mid-write; the fresh -reopen-retry then validated the mutated band.
  const r = bandPassTaint(L([
    row({ attempt: 1, key: "base", fail: null, code: 0, wall: 431 }),
    row({ attempt: 1, key: "base", fail: "timeout", code: 137, wall: 1560 }),
    row({ attempt: 1, key: "base-reopen-retry", fail: null, code: 0, wall: 468 }),
  ]));
  assert.equal(r.tainted, true);
  assert.equal(r.evidence.length, 1);
  assert.equal(r.evidence[0].code, 137);
});

test("the plain retry ladder — attempt 1 killed BEFORE any success, attempt 2 a fresh full redo — is NOT taint", () => {
  // teal-lattice incumbent-class (and ~10 more corpus runs): the benign shape the validator gates
  // on the final artifact; tainting it would flip historically-good runs (2026-07-10 corpus audit).
  const r = bandPassTaint(L([
    row({ attempt: 1, key: "base", fail: "timeout", code: 137, wall: 1560 }),
    row({ attempt: 2, key: "base-rerun1", fail: null, code: 0, wall: 189 }),
  ]));
  assert.equal(r.tainted, false);
});

// copper-lattice legacy rows predate the killed/signals/followup fields — fail/code alone classify.
test("legacy rows (no killed/signals/followup fields) still classify — the verbatim copper-lattice rows", () => {
  const r = bandPassTaint(L([
    { ts: "2026-07-08T09:00:00Z", attempt: 1, key: "prelim-x-register-unit-primary-sweep", code: 0, wall: 431.4, status: "ok", fail: null },
    { ts: "2026-07-08T09:26:00Z", attempt: 1, key: "prelim-x-register-unit-primary-sweep", code: 137, wall: 1560.0, status: "timeout", fail: "timeout" },
    { ts: "2026-07-08T09:40:00Z", attempt: 1, key: "prelim-x-register-unit-primary-sweep-reopen-retry", code: 0, wall: 468.1, status: "ok", fail: null },
  ]));
  assert.equal(r.tainted, true, "fail:timeout + code:137 rows classify without the new fields");
});

test("a clean attempt-1 fresh pass SUPERSEDES an older taint — no clear-write needed", () => {
  const r = bandPassTaint(L([
    row({ attempt: 1, key: "base", fail: null }),                           // validated base
    row({ attempt: 1, key: "base", fail: "timeout", code: 137 }),           // followup kill — tainted here
    row({ attempt: 1, key: "base-taint-rerun", fail: null }),               // T1 fresh re-run, clean on attempt 1
  ]));
  assert.equal(r.tainted, false);
});

test("a fresh re-run that ITSELF got killed then succeeded stays tainted (post-success kill)", () => {
  const r = bandPassTaint(L([
    row({ attempt: 1, key: "base", fail: null }),                             // validated base
    row({ attempt: 1, key: "base", fail: "timeout", code: 137 }),             // followup kill
    row({ attempt: 1, key: "base-taint-rerun", fail: "timeout", code: 137 }), // T1 killed too
    row({ attempt: 2, key: "base-taint-rerun-rerun1", fail: null }),
  ]));
  assert.equal(r.tainted, true, "a kill after the first validated pass is never laundered by a later retry");
});

test("all attempts killed, no success at all — tainted (killed, never recovered in-process)", () => {
  const r = bandPassTaint(L([
    row({ attempt: 1, key: "base", fail: "timeout", code: 137 }),
    row({ attempt: 2, key: "base-rerun1", fail: "timeout", code: 137 }),
  ]));
  assert.equal(r.tainted, true);
});

test("a FOLLOWUP success after a post-success kill does NOT supersede — it patched, it didn't replace", () => {
  // marble-bastion's shape: validated pass, followup killed on the winning key, followup retry "ok".
  const r = bandPassTaint(L([
    row({ attempt: 2, key: "base-rerun1", fail: null }),
    row({ attempt: 1, key: "base-rerun1", fail: "timeout", code: 137, followup: true }),
    row({ attempt: 1, key: "base-rerun1", fail: null, followup: true }),
  ]));
  assert.equal(r.tainted, true);
});

test("legacy followup detection: a success on a key that already succeeded is a followup (key-reuse)", () => {
  // no followup flags on legacy rows — the key-reuse heuristic must keep the post-success kill tainted
  const r = bandPassTaint(L([
    { ts: "t", attempt: 2, key: "base-rerun1", code: 0, fail: null },
    { ts: "t", attempt: 1, key: "base-rerun1", code: 137, fail: "timeout" },
    { ts: "t", attempt: 1, key: "base-rerun1", code: 0, fail: null },
  ]));
  assert.equal(r.tainted, true, "key-reuse marks it a followup — the mutated base is still the material");
});

test("a kill INSIDE a followup taints a previously-clean pass (its partial writes are in the merge)", () => {
  const r = bandPassTaint(L([
    row({ attempt: 1, key: "base", fail: null }),                          // clean base pass
    row({ attempt: 1, key: "base", fail: "timeout", code: 137, followup: true }),  // envelope followup killed
    row({ attempt: 2, key: "base", fail: null, followup: true }),
  ]));
  assert.equal(r.tainted, true);
});

test("lane_wedge and rate_limited rows are NOT taint — nothing was written", () => {
  assert.equal(isTaintRow({ fail: "lane_wedge", code: 137, killed: true }), false, "a 0-token wedge wrote nothing, even killed at the wall");
  assert.equal(isTaintRow({ fail: "rate_limited" }), false);
  const r = bandPassTaint(L([
    row({ attempt: 1, key: "base", fail: null }),
    row({ attempt: 1, key: "base", fail: "lane_wedge", code: 137, followup: true }),
  ]));
  assert.equal(r.tainted, false);
});

test("kill-class discriminators: fail regexp, code 137, killed flag, hardWall/stalled signals", () => {
  assert.ok(TAINT_FAIL_RE.test("timeout") && TAINT_FAIL_RE.test("status_timeout"));
  assert.equal(isTaintRow({ fail: "status_timeout" }), true);
  assert.equal(isTaintRow({ fail: "nonzero_exit_1", code: 137 }), true);
  assert.equal(isTaintRow({ fail: "unparseable_json", killed: true }), true);
  assert.equal(isTaintRow({ fail: "x", signals: { hardWall: true } }), true);
  assert.equal(isTaintRow({ fail: "x", signals: { stalled: true } }), true);
  assert.equal(isTaintRow({ fail: "invalid_file:x:y", code: 1 }), false);
});

test("empty / absent / torn jsonl ⇒ untainted (legacy + replay purity)", () => {
  assert.equal(bandPassTaint([]).tainted, false);
  assert.equal(bandPassTaint(undefined).tainted, false);
  assert.equal(bandPassTaint(["{not json", ""]).tainted, false);
  const r = bandPassTaint(["{torn", JSON.stringify(row({ fail: null })), JSON.stringify(row({ key: "k1", fail: "timeout", code: 137, followup: true }))]);
  assert.equal(r.tainted, true, "torn lines are skipped, never mask real rows");
});

test("a content-retry ladder with NO kill-class attempt is untainted (attempts>1 alone is not taint)", () => {
  const r = bandPassTaint(L([
    row({ attempt: 1, key: "base", fail: "invalid_file:x.md:nonEmpty", code: 0 }),
    row({ attempt: 2, key: "base-rerun1", fail: null }),
  ]));
  assert.equal(r.tainted, false);
});

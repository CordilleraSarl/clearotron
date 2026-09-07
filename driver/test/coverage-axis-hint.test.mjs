// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The coverage-ledger corrective hint must state that the axis vocabulary is CLOSED.
//
// Live loop (CORAL FREEZE clearance run, 2026-07-30): the digest's prose Coverage ledger carried a
// digest-level tiering row alongside the four axis rows. The hint defined axis purely by DERIVATION
// ("lowercase text left of the first ' / ' of the Coverage-unit cell"), so the model derived an axis
// from that non-axis row exactly as instructed — and the validator, whose axis vocabulary is a closed
// enum of the run's active axes, had to reject it. Every warm retry re-issued the same derivation
// rule, so the correction could not converge and the stage burned its attempts. The same token killed
// a run the previous night.
//
// The validator already names the allowed set in its own message; the hint has to quote it back and
// say what to do with a prose row that is not an axis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { correctionHint } from "../gateway.mjs";

const AXES = "saturation-probe, primary-sweep, transliteration-numeric, incumbent-class";
// The real shape, with the run path generalised (the product repo carries no run identifiers).
const LIVE_FAIL = `invalid_file:prelim-search/tmp9001-mark/date-codename/register-findings.md:`
  + `coverage_axis_invalid:new — digest-level tiering of the 380 no (not in: ${AXES})`;

test("the hint quotes the closed axis set back from the validator message", () => {
  const h = correctionHint(LIVE_FAIL);
  assert.match(h, /CLOSED/, "the model must be told the vocabulary is not open-ended");
  for (const ax of AXES.split(", ")) {
    assert.ok(h.includes(ax), `the allowed axis "${ax}" is named in the hint`);
  }
});

test("the hint says a non-axis prose row is not a ledger row", () => {
  const h = correctionHint(LIVE_FAIL);
  assert.match(h, /not a\s+ledger row|NOT a\s+ledger row/, "names the actual mistake");
  assert.match(h, /reason/, "gives it somewhere legitimate to go");
  assert.match(h, /never invent an axis/i, "and forbids the shortcut it just took");
});

test("a derivation rule alone is no longer the whole definition of axis", () => {
  const h = correctionHint(LIVE_FAIL);
  // The derivation stays (it is right for a real axis row) but must not be the only constraint.
  assert.match(h, /left of/, "the derivation guidance is retained for genuine axis rows");
  assert.match(h, /active axes/, "…and is now bounded by the active-axis set");
});

test("no allowed-list in the message ⇒ still a closed-vocabulary hint, no crash", () => {
  const h = correctionHint("invalid_file:x/register-findings.md:coverage_axis_missing:primary-sweep");
  assert.match(h, /ACTIVE AXES|active axes/);
  assert.match(h, /CLOSED/);
});

test("the sibling schema tokens keep the JSON-shape hint", () => {
  for (const tok of ["coverage_ledger_unparseable: top level must be a JSON ARRAY",
                     "coverage_status_invalid:verified", "coverage_key_unknown:notes"]) {
    const h = correctionHint(`invalid_file:x/register-findings.md:${tok}`);
    assert.match(h, /register-coverage-ledger\.json is a JSON ARRAY/, `${tok} still gets the shape hint`);
    assert.match(h, /confirmed-clean \/ coverage-limited \/ deferred/, `${tok} still gets the status enum`);
  }
});

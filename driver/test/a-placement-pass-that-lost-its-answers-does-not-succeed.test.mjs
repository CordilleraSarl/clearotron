// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-placement-pass-that-lost-its-answers-does-not-succeed.test.mjs — the placement gate reads what the pass
// RECORDED, not only the file the render left behind.
//
// THE DEFECT. A pass tiered 141 in-class identical and near-identical register records. Every tier and
// reason sat in the driver's form. Not one reached placements.json: every register row was refused on an
// owner the fold never carried, and the render omits an unsettled row rather than emit it half-formed. The
// gate parsed the six common-law rows that were left, the stage reported success, and the report was silent
// on the register.
//
// WHERE THE LINE IS, and why it is not "any outstanding row". Replayed over every archived form-era run:
// the three discard-alls refuse under the arms below and none of the twenty-two healthy runs does. "Any
// outstanding row refuses" was measured too — it refuses five of the twenty-two, each over a handful of
// single records at offices that publish no owner. A corrective turn cannot supply an owner the register
// does not hold, so those are counted on the attempt row and not refused.
//
// Run:  node --test driver/test/a-placement-pass-that-lost-its-answers-does-not-succeed.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validators } from "../verify.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { renderPlacementsJson, placementRenderAccount, omittedFromRender } from "../placement-form.mjs";

const PAD = "Padding so the specimen clears the nonEmpty floor and the structural arm is what decides it.";
const DOC = ["# Candidate grouping — TESTMARK", "", "## Band reconciliation", "", PAD, "",
  "## Headline candidates", "<!-- clearotron:section=placement-tiers -->", "", "- CANDIDATE", "", PAD, ""].join("\n");

const pos = (id, owner) => ({ mark_text: `MARK-${id}`, owners: owner ? [owner] : [], owner_strings: owner ? [owner] : [],
  records: [`/mark/us/${id}`], classes: ["9"], territories: ["US"] });
const SEAT_ROW = { kind: "seat", mark: "Invented Online", owner: "Invented Online Ltd", jurisdiction: "US",
  records: [], tier: "watchlist-annex", reason: "marketplace seller in the same goods, no register leg" };
const judged = (id, tier = "sheet-2") => ({ select: `/mark/us/${id}`, tier, reason: "identical mark in class 9, live" });

/** A run dir as the driver leaves it after a judgement: form sidecar, seat copy, rendered file, stamp. */
function runDir({ positions, submitted, stamp = { structuredPlacements: 1, placementForm: 1, placementAccount: 1 }, form = true }) {
  const dir = mkdtempSync(join(tmpdir(), "placement-account-"));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "_driver", "stage-contracts.json"), JSON.stringify({ "placement-inquiry": stamp }));
  const u = unionPlacementForm(null, submitted, { floors: [], positions });
  if (form) writeFileSync(join(dir, "_driver", "placement-form.form.json"), JSON.stringify(u.form));
  writeFileSync(join(dir, "placements.json"), JSON.stringify(renderPlacementsJson(u.form.rows)));
  const md = join(dir, "placement-recommendations.md");
  writeFileSync(md, DOC);
  return { dir, md, u };
}
const judge = (r) => validators.placement(r.md, DOC);

test("every register row tiered and none rendered: the pass REFUSES, naming the register fact", () => {
  const r = runDir({ positions: [pos("A1", null), pos("A2", null)], submitted: [judged("A1"), judged("A2"), SEAT_ROW] });
  try {
    const v = judge(r);
    assert.equal(v.ok, false, "six common-law rows rendering must not stand in for a register pass that delivered nothing");
    assert.match(v.reason, /^placement_register_unrendered=2:/);
    assert.match(v.reason, /placement_owner_missing ×2/, "the cause is named, not only the count");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("a register that publishes no owner for ONE record is counted, not refused", () => {
  const r = runDir({ positions: [pos("B1", "Invented Holdings SA"), pos("B2", null)], submitted: [judged("B1"), judged("B2", "out-of-scope-filtered")] });
  try {
    assert.equal(judge(r).ok, true, "a corrective turn cannot supply an owner the register does not hold");
    const a = placementRenderAccount(r.u.form.rows);
    assert.equal(a.register_selected, 2);
    assert.equal(a.register_rendered, 1);
    assert.deepEqual(a.register_facts, { placement_owner_missing: 1 }, "and the account says which fact, so the omission is never causeless");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("a row the SEAT has not finished refuses, and the refusal names the row and its cause", () => {
  const r = runDir({ positions: [pos("C1", "Invented Holdings SA"), pos("C2", "Other Invented AG")],
    submitted: [judged("C1"), { select: "/mark/us/C2", tier: "sheet-2" }] });
  try {
    const v = judge(r);
    assert.equal(v.ok, false);
    assert.match(v.reason, /^placement_unjudged=1:/);
    assert.match(v.reason, /placement_reason_missing/);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("an archived run without the stamp key replays to the verdict it was minted under", () => {
  const r = runDir({ positions: [pos("D1", null)], submitted: [judged("D1")],
    stamp: { structuredPlacements: 1, placementForm: 1 } });
  try {
    assert.equal(judge(r).ok, true, "no archived verdict moves — the arm is on its own dispatch-time key");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("under the stamp, a form that is absent is the recording failing — refused, never read as no rows", () => {
  const r = runDir({ positions: [pos("E1", "Invented Holdings SA")], submitted: [judged("E1")], form: false });
  try {
    const v = judge(r);
    assert.equal(v.ok, false);
    assert.match(v.reason, /^placement_form_unreadable/);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("a pass that selected no register candidate is not a lost register", () => {
  const r = runDir({ positions: [pos("F1", "Invented Holdings SA")], submitted: [SEAT_ROW] });
  try {
    assert.equal(judge(r).ok, true, "a band with nothing worth placing is a real answer, and this arm must not refuse it");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("an omitted row carries its cause and who owes it", () => {
  const { u } = { u: unionPlacementForm(null, [judged("G1")], { floors: [], positions: [pos("G1", null)] }) };
  const [o] = omittedFromRender(u.form);
  assert.equal(o.cause, "placement_owner_missing");
  assert.equal(o.owed_by, "register");
  assert.deepEqual(o.missing, [], "the judgement is complete — which is exactly why `missing` alone could not explain it");
});

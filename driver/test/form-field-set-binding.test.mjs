// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CONTRACT IS ITS FIELD SET — for the other driver-written forms, not just the meaning-sweep one.
//
// M2's completion bound the meaning form three ways: one declared list, the emitted row carrying a
// slot per field, and the composed instruction naming every field. The enforcement registry then
// recorded the honest limit — the coverage form, the placement form and the grid ledger had no
// equivalent, so the fifth-field protection guarded one form out of four. This is the rest of it.
//
// WHAT THE MEASUREMENT FOUND, and it changed the rule rather than the code:
//
//   coverage   `kind` is declared as a seat-row field and is NOT named in the dispatch
//   placement  every declared field is named
//
// `kind` is not a defect. Both contracts FIX it to the constant `"seat"` — a row the seat adds is
// stamped, not chosen — so the dispatch has nothing to tell a seat about it. The declared list means
// "the fields a seat-added row must CARRY", which is not the same as "the fields a seat must AUTHOR".
// Conflating those would have produced a wrong bug report and a wrong fix, so the rule states both
// cases: every declared field is either NAMED in the dispatch or FIXED by the contract.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { STAGES, paths } from "../stages.mjs";
import * as coverage from "../coverage-form.mjs";
import * as placement from "../placement-form.mjs";

const FORMS = [
  { label: "coverage", mod: coverage, stage: "register-digest" },
  { label: "placement", mod: placement, stage: "placement-inquiry" },
];

const dispatchOf = (stage) => {
  const dir = mkdtempSync(join(tmpdir(), "field-set-"));
  mkdirSync(driverDir(dir), { recursive: true });
  try {
    return STAGES[stage].message({
      paths: paths(dir), profile: {}, half: "a", axis: "primary-sweep", axes: ["primary-sweep"],
      job: { classes: [9], goods: "software", marks: ["LUMEN"], jurisdictions: ["US"], mark: "LUMEN" },
      marks: ["LUMEN"], registerPlan: null, recallDirectives: [], lateBind: null,
      intakeAsks: [], ownedAsks: [], registerOnly: true,
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("ONE LIST, NOT TWO — the contract carried in the file is the declared list itself", () => {
  // `seat_row_contract.fields` rides INSIDE the form the seat edits, so the vocabulary is a value of
  // the file rather than prose about it. If it were a second literal it would drift from the first,
  // which is the defect this whole family exists to remove.
  for (const { label, mod } of FORMS)
    assert.deepEqual([...mod.SEAT_ROW_CONTRACT.fields], [...mod.SEAT_ROW_FIELDS], `${label}`);
});

test("EVERY DECLARED FIELD IS NAMED IN THE DISPATCH, OR FIXED BY THE CONTRACT", () => {
  // The rule the measurement produced. A field the seat must author has to be named where the seat is
  // told what to do; a field the contract stamps to a constant has nothing to tell.
  for (const { label, mod, stage } of FORMS) {
    const msg = dispatchOf(stage);
    assert.ok(msg.length > 200, `${label}: the dispatch must compose, or this test asserts nothing`);
    for (const f of mod.SEAT_ROW_FIELDS) {
      const named = msg.includes(f);
      const fixed = typeof mod.SEAT_ROW_CONTRACT[f] === "string" && mod.SEAT_ROW_CONTRACT[f].length < 24;
      assert.ok(named || fixed,
        `${label}: \`${f}\` is a declared seat-row field that the dispatch never names and the contract `
        + `never fixes — a seat is asked for it nowhere and told about it nowhere`);
    }
  }
});

test("the FIXED fields are exactly the ones we think, so the escape hatch cannot widen quietly", () => {
  // Without this, the clause above would excuse any future field by stamping it with a short string.
  for (const { label, mod } of FORMS) {
    const fixed = mod.SEAT_ROW_FIELDS.filter((f) => typeof mod.SEAT_ROW_CONTRACT[f] === "string" && mod.SEAT_ROW_CONTRACT[f].length < 24);
    assert.deepEqual(fixed, ["kind"], `${label}: only \`kind\` may be fixed`);
    assert.equal(mod.SEAT_ROW_CONTRACT.kind, "seat", `${label}: and it is stamped, never chosen`);
  }
});

test("the coverage form's emitted rows carry a slot per declared field", () => {
  // The third binding, where the rows are buildable from a fixture. A seat told to set a field, opening
  // a file with no such key, is M2's own defect — measured on the meaning form and fixed there.
  const { rows } = coverage.coverageFormRows({
    skeleton: [{ axis: "primary-sweep", state: "executed" }], plan: { entries: [] },
    bandBlocksByAxis: {}, deferredReasons: {}, activeAxes: null, bandsUnreadable: [],
  });
  assert.ok(rows.length > 0, "the fixture must produce rows, or this asserts nothing");
  for (const row of rows)
    for (const f of coverage.SEAT_ROW_FIELDS)
      assert.ok(f in row, `a coverage row the seat must fill has no \`${f}\` slot`);
});

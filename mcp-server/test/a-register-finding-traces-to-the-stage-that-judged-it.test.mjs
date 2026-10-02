// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A register finding traces to the stage that judged the register layer on ITS run: step 3's judges on a
// run judged by owner, the register digest on a run begun before step 3. A trace that named the digest on
// a run that never ran one would open on a stage with no event behind it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerStageLabel } from "../lib/trace.mjs";

const stage = (label, ok) => ({ event: "stage", stage: label, ok });

test("a run judged by owner traces to the judge whose dispatch was accepted last", () => {
  assert.equal(registerStageLabel([stage("owner-judgment:1", true), stage("owner-judgment:2", true)]), "owner-judgment:2");
  assert.equal(registerStageLabel([stage("owner-judgment:1", true), stage("owner-judgment:2", false)]), "owner-judgment:1",
    "a judge whose answer was not taken is not where the finding came from");
  assert.equal(registerStageLabel([stage("owner-judgment:2", false)]), "owner-judgment:2",
    "with no judge accepted, the last dispatch is still the stage to show, with its failure");
});

test("a run begun before step 3 traces to the digest, as it always did", () => {
  assert.equal(registerStageLabel([stage("register-digest", true), stage("synthesis", true)]), "register-digest");
  assert.equal(registerStageLabel([]), "register-digest");
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A DESIGNED FOLLOWUP REINTRODUCED THE VIOLATION THE PREVIOUS CYCLE CORRECTED.
//
// a measured run's synthesis seat failed `finding_action_condition_on_advisory`, was corrected, went clean
// — and a refinement pass twenty-seven minutes later failed the same way EIGHT times. The corrective
// ladder worked both times; nothing carried its result forward. The two dispatch paths differ:
// gateway.mjs RESUMES and composes from `lastFail`; composeFollowup is, in its own doc block, addressed
// to "a session that has nothing", and `lastFail` does not appear in stages.mjs at all.
//
// The corrected artefact was never missing — findings.json is on disk and rides the input pointers. The
// RULE the correction enforced is what could not travel.

import { test } from "node:test";
import assert from "node:assert/strict";

import { clearedSignatures, dispatchRows, cyclesOf } from "../seat-attempts.mjs";
import { composeFollowup, clearedConstraint } from "../stages.mjs";

const row = (attempt, status, fail) => JSON.stringify({ attempt, key: "synthesis", status, ...(fail ? { fail } : {}) });

test("THE MEASURED SHAPE — a fault corrected inside a cycle is cleared", () => {
  const rows = dispatchRows([row(1, "fail", "finding_action_condition_on_advisory:1"), row(2, "ok")].join("\n"));
  assert.equal(cyclesOf(rows).length, 1, "one cycle: the attempt counter advanced");
  assert.deepEqual(clearedSignatures(rows), ["finding_action_condition_on_advisory"]);
});

test("AN OPEN CYCLE CONTRIBUTES NOTHING — the load-bearing half", () => {
  // Its last attempt may yet fail. Calling its faults corrected would tell the next dispatch that a
  // repair had held when it had not, which is a worse instruction than silence.
  const rows = dispatchRows([row(1, "fail", "finding_action_condition_on_advisory:1")].join("\n"));
  assert.deepEqual(clearedSignatures(rows), []);
});

test("a cycle that ended FAILING clears nothing either", () => {
  const rows = dispatchRows([row(1, "ok"), row(1, "fail", "x:1"), row(2, "fail", "x:2")].join("\n"));
  assert.deepEqual(clearedSignatures(rows), [], "two cycles, and the second never went clean");
});

test("the KIND is carried, not the whole signature", () => {
  // `invalid_file:/very/long/path` is the same defect whichever path it names, and the constraint a
  // followup needs to state is the class.
  const rows = dispatchRows([row(1, "fail", "invalid_file:/run/abc/frame-diff.json:framediff_x"), row(2, "ok")].join("\n"));
  assert.deepEqual(clearedSignatures(rows), ["invalid_file"]);
});

test("across cycles: cleared accumulates, and a damaged line is never fatal", () => {
  const rows = dispatchRows([
    row(1, "fail", "a:1"), row(2, "ok"),
    "{ not json",
    row(1, "fail", "b:1"), row(2, "ok"),
  ].join("\n"));
  assert.deepEqual(clearedSignatures(rows), ["a", "b"]);
});

// ── the constraint the dispatch carries ─────────────────────────────────────────────────────────────

test("EMPTY IN, NOTHING OUT — a first cycle has corrected nothing", () => {
  assert.equal(clearedConstraint([]), "");
  assert.equal(clearedConstraint(null), "");
  assert.equal(clearedConstraint(["", "  "]), "", "and nothing is not a signature");
});

test("the block states the RULE, and refuses to read as a repair instruction", () => {
  const t = clearedConstraint(["finding_action_condition_on_advisory"]);
  assert.match(t, /ALREADY CORRECTED ON THIS RUN/);
  assert.match(t, /do not reintroduce it/);
  assert.match(t, /ALREADY carries that fix/, "the seat must not go looking for a repair that is done");
  assert.match(t, /not being asked to repeat the repair/);
  assert.ok(!/change nothing else|Fix exactly this/i.test(t),
    "the corrective ladder's sentence is written for a seat mid-repair and is the wrong one here");
});

test("plural reads correctly, and duplicates collapse", () => {
  const t = clearedConstraint(["b", "a", "a"]);
  assert.match(t, /do not reintroduce them: `a`, `b`\./);
  assert.match(t, /Each of these fired/);
});

test("IT REACHES THE DISPATCH — and a followup with nothing cleared is byte-identical to before", () => {
  const ctx = { profile: null, job: {} };
  const before = composeFollowup("synthesis", ctx, { followup: "Refine the actions." });
  const after = composeFollowup("synthesis", ctx, { followup: "Refine the actions.", cleared: [] });
  assert.equal(after, before, "no cleared signatures ⇒ the dispatch does not move");

  const withConstraint = composeFollowup("synthesis", ctx, {
    followup: "Refine the actions.", cleared: ["finding_action_condition_on_advisory"],
  });
  assert.match(withConstraint, /finding_action_condition_on_advisory/);
  assert.ok(withConstraint.indexOf("Refine the actions.") < withConstraint.indexOf("ALREADY CORRECTED"),
    "the task stays first in intent; the constraint follows it");
});

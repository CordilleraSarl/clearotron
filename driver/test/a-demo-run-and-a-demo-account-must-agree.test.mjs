// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-demo-run-and-a-demo-account-must-agree.test.mjs — consent, never override.
//
//. A profile's `demoData: true` marks an account as fiction, and the admission wall has
// always rejected a real clearance on it. `demoRun` on the job is the requester saying they know — so the
// demo clearances can run at all.
//
// AGREEMENT IN BOTH DIRECTIONS, and the second direction is the one easy to forget: a REAL account with a
// demo run is refused too. A demo banner over a real account's report is the same untruth pointing the
// other way, and worse, because the reader has every reason to trust it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { demoRunAgreement, demoRunShape } from "../demo-run-agreement.mjs";
import { DECLARED_JOB_FIELDS, validateJob } from "../enqueue-schema.mjs";
import { PORTAL_JOB_FIELDS } from "../portal-service.mjs";
import { DEV_COCKPIT_JOB_FIELDS } from "../dev-portal.mjs";
import { CLI_JOB_FIELDS } from "../enqueue.mjs";

test("2049 the four combinations, and only one of them runs", () => {
  const at = (demoRun, demoData) => demoRunAgreement({ demoRun, demoData, who: "acme" });
  assert.deepEqual(at(true, true), { ok: true, demo: true }, "a demo run on a demo account is the honest one");
  assert.deepEqual(at(false, false), { ok: true, demo: false }, "an ordinary run on a real account is untouched");

  const demoAccountRealJob = at(false, true);
  assert.equal(demoAccountRealJob.ok, false);
  assert.match(demoAccountRealJob.reject, /is DEMO DATA/, "the wall's existing sentence must survive verbatim");
  assert.match(demoAccountRealJob.reject, /Nothing has been searched, and nothing has been spent/);

  const realAccountDemoJob = at(true, false);
  assert.equal(realAccountDemoJob.ok, false, "a demo run on a REAL account was admitted — the banner would lie");
  assert.match(realAccountDemoJob.reject, /is a REAL account/);
  assert.notEqual(realAccountDemoJob.reject, demoAccountRealJob.reject,
    "both mismatches print the same sentence — a reader cannot tell which way the disagreement runs");
});

test("2049 the field CONSENTS and can never change what the profile means", () => {
  // The property that keeps a client's request out of the truth of their own report: for a fixed profile,
  // no value of demoRun makes a demo account real or a real account demo. It can only agree or refuse.
  for (const demoData of [true, false]) {
    const outcomes = [true, false].map((demoRun) => demoRunAgreement({ demoRun, demoData }));
    const admitted = outcomes.filter((o) => o.ok);
    assert.equal(admitted.length, 1, "exactly one value of demoRun agrees with a given profile");
    assert.equal(admitted[0].demo, demoData,
      "the admitted run's demo-ness follows the PROFILE — the job field never flipped it");
  }
});

test("2049 a malformed demoRun is REFUSED at the door, not warned and unset", () => {
  // Unlike its boolean neighbours, this one decides whether a report says it is fiction. A truthy string
  // would otherwise mean `true` on a value nobody typed.
  const base = { id: "j1", markName: "X", classes: [9] };
  for (const bad of ["yes", "false", 1, 0, {}]) {
    const r = validateJob({ ...base, demoRun: bad });
    assert.ok(r.errors.some((e) => /demoRun must be true or false/.test(e)),
      `${JSON.stringify(bad)} was not refused at the door`);
  }
  for (const good of [true, false]) {
    const r = validateJob({ ...base, demoRun: good });
    assert.equal(r.errors.some((e) => /demoRun/.test(e)), false, `${good} was refused and should not be`);
  }
  // Absent is not malformed.
  assert.equal(validateJob(base).errors.some((e) => /demoRun/.test(e)), false);
  assert.deepEqual(demoRunShape(undefined), { ok: true, value: false });
});

test("2049 declared, and every door has ruled on it — the client door says NO", () => {
  assert.ok(DECLARED_JOB_FIELDS.includes("demoRun"),
    "undeclared means SILENTLY STRIPPED with a 200 — not refused, gone, and the requester never told");

  // The client door must never let a requester declare their own report fiction.
  assert.equal(PORTAL_JOB_FIELDS.carries.includes("demoRun"), false,
    "the client door carries demoRun — a client could mark their own report fiction, or omit it and mark a "
    + "demo account's report real");
  assert.ok(PORTAL_JOB_FIELDS.notCarried.demoRun?.length > 30, "and it must say WHY, not 'n/a'");

  // Operator doors may.
  assert.ok(DEV_COCKPIT_JOB_FIELDS.carries.includes("demoRun"), "the dev cockpit cannot start a demo run");
  assert.ok(CLI_JOB_FIELDS.carries.includes("demoRun"), "the CLI cannot start a demo run");
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the stale-user-manager verdict. Pure inputs, so the three directions are all reachable: the
// fault as it actually occurred, the healthy case, and the two absences that must not read as either.
import { test } from "node:test";
import assert from "node:assert/strict";
import { managerGroupsVerdict } from "../manager-groups-verdict.mjs";

const V = (o) => managerGroupsVerdict({ user: "svc-runner", uid: 1005, ...o });

test("#693 the fault as it happened: the user is in a group the manager is not", () => {
  // the run account 1005 plus a second group 1006; the manager started before 1006 was added.
  const r = V({ idGroups: [1005, 1006], managerGroups: [1005] });
  assert.equal(r.state, "fail");

  // THE POINT OF THE CHECK is the wording, so it is asserted. The symptom (EACCES on a path whose
  // permissions are correct) sends a reader to chmod, and on the set-GID pool root that is destructive.
  assert.match(r.message, /STALE USER MANAGER/);
  assert.match(r.message, /not a file-permission problem/i);
  assert.match(r.message, /Do NOT chmod/);
  assert.match(r.message, /1006/, "it names WHICH group is missing, not just that something diverged");

  // And the fix names the right target. Restarting the units is what people try first, and it does nothing.
  assert.match(r.message, /systemctl restart user@1005\.service/);
  assert.match(r.message, /restarting the individual units does NOT refresh this/i);
});

test("#693 the healthy case passes, and says what it compared", () => {
  const r = V({ idGroups: [1005, 1006], managerGroups: [1006, 1005] });
  assert.equal(r.state, "pass", "order must not matter — these are sets");
  assert.match(r.message, /1005/);
});

test("#693 the OTHER direction: a manager holding a group the user has lost", () => {
  const r = V({ idGroups: [1005], managerGroups: [1005, 1006] });
  assert.equal(r.state, "fail");
  assert.match(r.message, /no longer in/);
  assert.match(r.message, /keep an access the user has lost/);
});

// ── the absences ──────────────────────────────────────────────────────────────────────────────────
// Both are legitimate shapes and neither is a pass. Production runs its services from SYSTEM units, so
// there is no user manager to compare against — that must skip, not fail, or this check would redden
// every prod deploy. And a check that could not read the user's groups established nothing at all.
test("#693 no user manager → skip, never pass and never fail", () => {
  const r = V({ idGroups: [1005, 1006], managerGroups: null, why: "no systemd --user process for uid 1005" });
  assert.equal(r.state, "skip", "a system-unit deployment is not a fault");
  assert.match(r.message, /Nothing to compare/);
  assert.match(r.message, /no systemd --user process/);
});

test("#693 unreadable user groups → skip, and it says it was not checked", () => {
  for (const idGroups of [null, [], undefined]) {
    const r = V({ idGroups, managerGroups: [1005] });
    assert.equal(r.state, "skip");
    assert.match(r.message, /Not checked, not passed/);
  }
});

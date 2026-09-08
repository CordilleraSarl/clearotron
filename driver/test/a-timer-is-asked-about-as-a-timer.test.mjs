// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A timer is asked about as a timer, because its service cannot answer for it — tracker issue 323.
//
// The health check asks `systemctl show <bare name>`, and systemd resolves a bare name to the `.service`.
// For a timer-driven unit that is the wrong question in the direction that hides the failure: the service
// reads `ActiveState=inactive` BETWEEN RUNS, which is correct and expected, and it reads `inactive` when
// its timer has been stopped and nothing will ever start it again. Identical strings, opposite meanings.
//
// So a check reporting only on services could say a unit exists, is not adrift from its checkout, and is
// `inactive` — all true, all reassuring — about a deployment whose scheduled work stopped happening.
import test from "node:test";
import assert from "node:assert/strict";
import { CHECKED_TIMERS, timerVerdict, UNIT_INVENTORY } from "../unit-inventory.mjs";

test("323 a stopped timer is a FAIL and says what stopping it costs", () => {
  const v = timerVerdict([{ unit: "clearotron-doctrine-sync.timer", active: "inactive", load: "loaded" }]);
  assert.equal(v.state, "fail", "a stopped timer read as a pass, which is the state this arm exists for");
  assert.deepEqual(v.stopped, ["clearotron-doctrine-sync.timer"]);
  assert.match(v.message, /will not fire again/, "the message says what it costs, not merely that a state differs");
});

test("323 an ARMED timer passes — the refusal is not universal", () => {
  // Without this the arm above is satisfied by a verdict that fails everything, which would pass while
  // making the instrument useless.
  const v = timerVerdict([{ unit: "clearotron-deploy.timer", active: "active", load: "loaded" }]);
  assert.equal(v.state, "pass");
  assert.deepEqual(v.stopped, []);
});

test("323 a timer that is not on this box is INFORMATION, never a verdict", () => {
  // The inventory spans prod and test, so a unit legitimately absent here would otherwise fail every run
  // on the other box — the same reasoning the service check already applies to LoadState=not-found.
  const v = timerVerdict([{ unit: "clearotron-deploy.timer", active: "inactive", load: "not-found" }]);
  assert.equal(v.state, "pass", "a timer this box does not have is not a stopped timer");
  assert.deepEqual(v.stopped, []);
  assert.match(v.message, /do not exist on this box/);
});

test("323 no session bus is a COULD-NOT-LOOK, not a report about the timers", () => {
  // `systemctl --user` answers nothing when the caller has no session bus, and a two-state verdict
  // renders that as "stopped". This is the third state.
  const v = timerVerdict(null, { probeFailed: "systemctl --user answered nothing" });
  assert.equal(v.state, "unknown");
  assert.deepEqual(v.stopped, [], "a look that did not happen must accuse nothing");
  assert.match(v.message, /failing to look, not a report/);
});

test("323 the timers come from the inventory, so a shipped one cannot be forgotten", () => {
  // Derived from what each entry already accounts for rather than listed a second time by hand: a list
  // written here would go stale the first time a unit shipped a timer and nobody remembered this file.
  assert.ok(CHECKED_TIMERS.length >= 1, "no timer is derived at all — the probe would ask about nothing");
  for (const name of CHECKED_TIMERS) assert.match(name, /\.timer$/, "a non-timer reached the timer list");
  const declared = UNIT_INVENTORY.filter((u) => u.runsOn.length > 0)
    .flatMap((u) => (u.systemdUnits ?? u.tracked ?? []).filter((f) => f.endsWith(".timer")));
  assert.deepEqual([...CHECKED_TIMERS].sort(), declared.sort(),
    "the derived list and the inventory disagree, so one of them is describing a deployment that does not exist");
});

test("323 an entry may declare units it does not TRACK — the two are different facts", () => {
  // A unit running on a box that this repository does not ship has no file list to read, so it says so
  // with `units:`. Claiming a tracked file that is absent is a fault; naming a unit a deployment runs is
  // a claim about a box, and folding them together would make one of the two lie.
  const planted = [{ unit: "planted", runsOn: ["prod"], tracked: null,
    systemdUnits: ["planted.service", "planted.timer"] }];
  const derived = planted.flatMap((u) => (u.systemdUnits ?? u.tracked ?? []).filter((f) => f.endsWith(".timer")));
  assert.deepEqual(derived, ["planted.timer"], "an untracked entry's declared timer was not reachable");
});

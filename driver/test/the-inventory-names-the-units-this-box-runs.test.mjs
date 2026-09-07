// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The deployment check asks systemd about a DECLARED list of unit names. When the services were renamed,
// the new units shipped with entries and those entries kept `runsOn: []`, while the pre-rename names kept
// the boxes. `CHECKED_UNITS` filters on a non-empty `runsOn`, so the list the check used named none of
// the services actually running — and `systemctl show` answers for a unit that does not exist, with
// `ActiveState=inactive`, so sixteen names that named nothing reported "0 active; 16 at rest".
//
// Measured on the test box, 2026-09-07: four services running, three arms reporting that nothing could be
// seen, and one neighbouring arm enumerating FROM systemd and seeing six live units in the same run.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKED_UNITS, UNIT_INVENTORY, unitInventoryVerdict } from "../unit-inventory.mjs";
import { unitsActiveVerdict } from "../unit-state-verdict.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("the units this deployment ships are the units the check asks about", () => {
  // The regression, stated over the SHIPPED FILES rather than over a list of names — a list would have to
  // be kept in step with the same rename that broke the inventory, and would go stale the same way.
  const shipped = ["clearotron-portal", "clearotron-worker", "clearotron-mcp-face", "clearotron-client-mcp"];
  for (const u of shipped) {
    const entry = UNIT_INVENTORY.find((e) => e.unit === u);
    assert.ok(entry, `${u} ships a unit file and has no inventory entry`);
    assert.ok(entry.runsOn.length > 0,
      `${u} is declared to run on no box, so CHECKED_UNITS excludes it and no arm asks systemd about it`);
    assert.ok(CHECKED_UNITS.includes(u), `${u} is missing from the list the deployment check reads`);
  }
});

test("a name the deployment stopped using is not still claiming a box", () => {
  // The other half. `trademark-portal` claimed prod AND test with no tracked file anywhere; on the test
  // box systemd reports it `not-found`. An entry claiming a box it is absent from makes every count
  // computed over the list wrong by one, silently.
  for (const u of ["trademark-portal", "trademark-ops-mcp", "client-mcp"]) {
    const entry = UNIT_INVENTORY.find((e) => e.unit === u);
    assert.ok(entry, u);
    assert.ok(!entry.runsOn.includes("test"),
      `${u} still claims the test box, where it was measured LoadState=not-found on 2026-09-07`);
    assert.ok(entry.measured, `${u}'s claim changed, so it owes the measurement that changed it`);
  }
});

test("EVERY entry that claims a box carries the measurement behind the claim", () => {
  // The file's own rule: "runsOn lists exactly the boxes MEASURED to carry it". It was unenforced, which
  // is how the rename walked past it. This asserts it only for the entries this change touched — a
  // blanket rule would fail on entries nobody has been back to measure, and a red that means "somebody
  // should go and look at production" is a different issue from this one.
  const touched = ["clearotron-portal", "clearotron-worker", "clearotron-mcp-face", "clearotron-client-mcp",
                   "clearotron-deploy", "trademark-portal", "trademark-ops-mcp", "client-mcp",
                   "trademark-test-deploy"];
  for (const u of touched) {
    const e = UNIT_INVENTORY.find((x) => x.unit === u);
    assert.match(e.measured ?? "", /2026-09-07/, `${u} carries no dated measurement`);
  }
});

test("A UNIT RUNNING HERE CANNOT BE DECLARED TO RUN NOWHERE", () => {
  // The precise finding, and the reason it is the right shape: it needs no knowledge of which box it is
  // on. An entry saying a unit runs on no box is contradicted by that unit running HERE, wherever here is.
  const orphan = UNIT_INVENTORY.find((u) => u.runsOn.length === 0);
  assert.ok(orphan, "the fixture needs an entry that still declares no box");
  const v = unitInventoryVerdict({ live: [`${orphan.unit}.service`], files: [], probe: { ok: true } });
  assert.equal(v.state, "fail");
  assert.match(v.message, new RegExp(`${orphan.unit} — 1 unit\\(s\\) are RUNNING on this box`));
  assert.match(v.message, /judging a population that excludes them/);
});

test("…and a properly declared live unit raises nothing", () => {
  const v = unitInventoryVerdict({ live: ["clearotron-portal.service"], files: [], probe: { ok: true } });
  assert.ok(!v.message.includes("RUNNING on this box"),
    "an entry that names its box must not be reported as contradicted");
});

test("A UNIT ABSENT FROM THIS BOX IS INFORMATION, NEVER A VERDICT", () => {
  // The inventory spans prod and test, so on the test box every prod-only entry is legitimately
  // `not-found`. A warn on that would fire on every run and be ignored by the second week — the shape of
  // a guard that cries wolf until nobody reads it.
  const v = unitsActiveVerdict({
    units: [{ unit: "a", active: "active", load: "loaded" }, { unit: "b", active: "inactive", load: "not-found" }],
    probe: { ok: true },
  });
  assert.equal(v.state, "pass", "an absent prod unit must not fail the test box's deploy");
  assert.match(v.message, /1 declared unit\(s\) do not exist on this box/, "…and must still be said out loud");
});

test("an older reading with no LoadState manufactures nothing", () => {
  // An absent field is not a finding. A verdict that treats `undefined` as `not-found` would report every
  // unit as absent the moment the property stopped being requested.
  const v = unitsActiveVerdict({ units: [{ unit: "a", active: "active" }], probe: { ok: true } });
  assert.equal(v.state, "pass");
  assert.ok(!v.message.includes("do not exist on this box"));
});

test("ZERO ACTIVE IS STILL NOT A PASS, and now says how much of the list is elsewhere", () => {
  const v = unitsActiveVerdict({
    units: [{ unit: "a", active: "inactive", load: "not-found" }], probe: { ok: true },
  });
  assert.equal(v.state, "skip", "0 active is either 'I could not look' or 'nothing is running' — never a pass");
  assert.match(v.message, /do not exist on this box/);
});

test("the checker asks systemd for LoadState — without it none of the above can fire", () => {
  // A textual arm on purpose: the property list is the seam between a live `systemctl` and every verdict
  // here, and dropping one entry from it turns each of those verdicts into a silent pass.
  const src = readFileSync(join(HERE, "..", "..", "scripts", "live-surface-check.mjs"), "utf8");
  assert.match(src, /"-p", "LoadState"/, "the property is not requested, so `load` is undefined everywhere");
  assert.match(src, /if \(k === "LoadState"\) load =/, "…and it must be parsed out of the answer");
  assert.equal((src.match(/unit: u, active, load,/g) ?? []).length, 2,
    "both push paths must carry it — one carries units with no clone, which is where the stale names land");
});

// ── THE RETIREMENT BRANCH, PLANTED — because the real table has no member to exercise it ─────────────
//
// `retired:` carried two entries and both left with their files once production was rebuilt. So
// `absentByRetirement` and the sentence it feeds are unreachable against the real inventory: they run,
// find nothing, and report nothing, on every deployment, forever. A reader of the file sees a mechanism
// that tells absent-and-expected from absent-and-should-not-be; what is actually there is a branch that
// has not fired since its last member left and would not be noticed if it stopped working.
//
// That is this file's own failure mode aimed at itself — a check that silently does not fire — so the
// mechanism is kept and PLANTED rather than trusted. The next retirement finds something that works.
test("a RETIRED unit's absence is EXPECTED, not drift — planted, because no real entry carries the field", () => {
  const planted = [
    { unit: "planted-retired", runsOn: ["test"], tracked: [], retired: { ruled: "2026-01-01", filesStayUntil: "prod", why: "planted" } },
    { unit: "planted-live", runsOn: ["test"], tracked: [] },
  ];
  const v = unitInventoryVerdict({ live: [], files: [], box: "test", probe: { ok: true }, inventory: planted });
  assert.match(v.message, /absent BY RETIREMENT/, "the retired unit's absence is not reported as expected");
  assert.match(v.message, /planted-retired/, "…and it is NAMED, so a reader can tell which unit was excused");
  assert.ok(!v.absent.includes("planted-retired"), "a retired unit must never land in the drift list");
  assert.ok(v.absent.includes("planted-live"), "…and the unretired one still must, or the excuse is universal");
});

test("the retirement excuse is NOT universal — it is read off the entry, never assumed", () => {
  // The failure this pins is the excuse widening: if `retired` were ever read as truthy-by-default, every
  // absent unit would be reported as expected and the whole absent-unit check would go quiet.
  const planted = [{ unit: "planted-live", runsOn: ["test"], tracked: [] }];
  const v = unitInventoryVerdict({ live: [], files: [], box: "test", probe: { ok: true }, inventory: planted });
  assert.doesNotMatch(v.message, /absent BY RETIREMENT/, "an inventory with no retired entry must say nothing about retirement");
  assert.deepEqual(v.absent, ["planted-live"]);
});

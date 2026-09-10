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
import { CHECKED_UNITS, UNIT_INVENTORY, unitInventoryVerdict, ACCOUNTED_FILES } from "../unit-inventory.mjs";
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
    // A DATE, not THE date. This read `/2026-09-07/` — the day these entries were first measured — so
    // remeasuring one on any later day failed with "carries no dated measurement" while the entry
    // carried a measurement dated that morning. The rule is that the claim is dated, and going back to
    // look again is the behaviour it exists to encourage; pinning one day punished exactly that.
    assert.match(e.measured ?? "", /\b20\d\d-\d\d-\d\d\b/, `${u} carries no dated measurement`);
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

// ── THE RETIREMENT BRANCH, PLANTED — and now also driven against the real table ──────────────────────
//
// `retired:` carried two entries and both left with their files once production was rebuilt, so for a
// time `absentByRetirement` and the sentence it feeds were unreachable against the real inventory: they
// ran, found nothing, and reported nothing, on every deployment, forever. A reader saw a mechanism that
// tells absent-and-expected from absent-and-should-not-be; what was there was a branch that had not
// fired since its last member left and would not have been noticed if it stopped working.
//
// That is this file's own failure mode aimed at itself, so the mechanism was kept and PLANTED. The
// planted arm stays — a real member can leave again, and the day it does this is what is left.
//
// THE REAL TABLE NOW CARRIES ONE, and the arm below drives it. A planted inventory proves the branch
// computes; only the real one proves the field is spelled the way the branch reads it. Those are
// different claims, and the gap between them is where a mechanism that "works" sits beside a table
// nothing in it can reach.
test("a RETIRED unit's absence is EXPECTED, not drift — planted, because the branch must work with or without a real member", () => {
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

// ── THE SAME BRANCH, AGAINST THE SHIPPED TABLE ──────────────────────────────────────────────────────
//
// The arms above inject an inventory. This one does not: it reads `UNIT_INVENTORY` as it ships, so it
// fails if the field is renamed, mistyped, or spelled onto an entry the verdict never looks at — none
// of which a planted table can see, because the plant supplies its own spelling.
//
// BOTH STATES, because the point of the field is that neither is a fault. A unit whose posture has been
// ruled away is still on the box until somebody removes it, and an inventory that could only be honest
// after that removal would force the entry and the box to disagree for the length of the window — which
// is the disagreement it exists to record.
test("the shipped inventory's retired entries are reported as expected in BOTH states", () => {
  const retired = UNIT_INVENTORY.filter((u) => u.retired);
  // A FLOOR, NOT A LOOP OVER WHATEVER IS THERE. With no member this arm would pass having asserted
  // nothing, which is the exact state that made the branch unreachable in the first place.
  assert.ok(retired.length >= 1,
    "no shipped entry carries `retired:`, so this arm asserts nothing and the branch is back to being "
    + "reachable only by injection — see the planted arm above for why that is not enough");

  const files = UNIT_INVENTORY.flatMap((u) => u.tracked ?? []);
  for (const u of retired) {
    for (const box of u.runsOn) {
      const unitFile = `${u.unit}.service`;
      // STILL ON THE BOX: it is running, so "declared here and not running" is false and it is in no
      // bucket at all. The entry records the ruling; the check has nothing to report yet.
      const on = unitInventoryVerdict({ live: [unitFile], files, box, probe: { ok: true } });
      assert.ok(!on.undeclared.includes(u.unit),
        `${u.unit} reads as undeclared while its entry is right there — a retirement is not a removal`);
      assert.ok(!on.absent.includes(u.unit), `${u.unit} landed in the drift list while it is still running`);

      // GONE FROM THE BOX: now it is absent, and absent-BY-RETIREMENT rather than absent-and-wrong.
      const off = unitInventoryVerdict({ live: [], files, box, probe: { ok: true } });
      assert.ok(!off.absent.includes(u.unit),
        `${u.unit} is retired and its absence was reported as drift — the ruling on the entry was not read`);
      assert.match(off.message, new RegExp(`absent BY RETIREMENT[^.]*${u.unit}`),
        `${u.unit}'s absence is not named as a retirement, so a reader cannot tell it from a missing unit`);

      // AND THE RULING IS LEGIBLE. A field that satisfies the branch while saying nothing a reader can
      // act on is the shape this whole file exists to refuse.
      for (const k of ["ruled", "filesStayUntil", "why"]) {
        assert.ok(typeof u.retired[k] === "string" && u.retired[k].trim(),
          `${u.unit}'s retirement has no \`${k}\` — the branch would still fire and the reader would still not know`);
      }
    }
  }
});

// A COMPLETE WALK, USING A FILE THE SHIPPED TABLE ACTUALLY CLAIMS. `accounted` is built from
// ACCOUNTED_FILES — the real table — so an injected inventory cannot vouch for an invented path, and a
// fixture that invents one fails for "no entry claims this file" rather than for the thing under test.
const A_REAL_TRACKED_FILE = [...ACCOUNTED_FILES][0];

// ── AN UNNAMED BOX IS A FAULT, NOT A FOOTNOTE ───────────────────────────────────────────────────────
//
// Half of this arm asks the mirror question — is a unit DECLARED for this deployment
// and absent from it? — and that half is suppressed when the box cannot name itself. The suppression is
// right: guessing would report every other deployment's units as missing here. What was wrong is that
// the arm then returned `pass`, so a deployment where nobody sets the name got a green tick beside a
// paragraph saying the check had not happened.
//
// It matters most where it was live. Measured 2026-09-10: the test deployment names itself and both
// halves run; production sets no name, so on the deployment where a stopped service is most costly this
// half has never executed, and nothing anywhere produced a finding.

test("an unnamed box FAILS — a suppressed half is not a pass", () => {
  const planted = [{ unit: "planted-live", runsOn: ["test"], tracked: [] }];
  const v = unitInventoryVerdict({ live: ["planted-live.service"], files: [], box: null, probe: { ok: true }, inventory: planted });
  assert.equal(v.state, "fail", "an unnamed box still reported a pass while half the arm did not run");
  assert.match(v.message, /NOTHING WAS COMPARED THE OTHER WAY/);
  assert.match(v.message, /CLEAROTRON_BOX/, "the message does not name the variable an operator has to set");
});

test("the same population with a NAME passes — the control, or the arm above proves nothing", () => {
  // Without this, a verdict that returned "fail" unconditionally would satisfy the arm above.
  // The walk is COMPLETE and its file is CLAIMED, so this arm isolates the box question and nothing
  // else: an entry with `tracked: []` beside a file of its own name is a fault in its own right.
  const planted = [{ unit: "planted-live", runsOn: ["test"], tracked: [] }];
  const v = unitInventoryVerdict({ live: ["planted-live.service"], files: [A_REAL_TRACKED_FILE],
    box: "test", probe: { ok: true }, inventory: planted });
  assert.equal(v.state, "pass", "a named box with nothing wrong must still pass");
  assert.doesNotMatch(v.message, /NOTHING WAS COMPARED/);
});

test("the failure is about the CHECK, not about the deployment, and the message keeps saying so", () => {
  // The distinction the file draws everywhere else: a failure to look is not a finding about the box.
  // If this ever starts reading as "your deployment is broken", the sentence has drifted.
  const planted = [{ unit: "planted-live", runsOn: ["test"], tracked: [] }];
  const v = unitInventoryVerdict({ live: ["planted-live.service"], files: [], box: null, probe: { ok: true }, inventory: planted });
  assert.match(v.message, /was NOT\s+checked|did not run/, "the message no longer says which half was skipped");
  assert.deepEqual(v.absent, [], "an unnamed box must not populate the drift list — that is the guess this refuses");
});

test("the allowlist is passed in, not spelled here — and an empty one still names the variable", () => {
  // The names come from shared/deployment-box.mjs through the caller, so there is one list. A second
  // copy inside this module is the drift this parameter exists to prevent.
  const planted = [{ unit: "planted-live", runsOn: ["test"], tracked: [] }];
  const withNames = unitInventoryVerdict({ live: [], files: [], box: null, probe: { ok: true }, inventory: planted, boxNames: ["prod", "test"] });
  assert.match(withNames.message, /\(prod or test\)/, "the caller's allowlist did not reach the message");
  const without = unitInventoryVerdict({ live: [], files: [], box: null, probe: { ok: true }, inventory: planted });
  assert.match(without.message, /CLEAROTRON_BOX/, "with no allowlist the message must still name the variable");
  assert.doesNotMatch(without.message, /\(\)/, "an empty allowlist left empty parentheses in the sentence");
});

test("a probe that could not look still SKIPS — the unnamed-box fault must not swallow it", () => {
  // Two different could-not-looks, and only one of them is this issue's. A failure to enumerate systemd
  // is reported as a skip and must stay that way, or the deploy learns to read every red the same.
  const v = unitInventoryVerdict({ live: [], files: [], box: null, probe: { ok: false, why: "no bus" } });
  assert.equal(v.state, "skip");
  assert.match(v.message, /no bus/);
});

// ── A WALK THAT DID NOT FINISH IS NOT A CLEAN BILL OF HEALTH ────────────────────────────────────────
//
// The sibling of the unnamed-deployment fault, one branch above it. The verdict already said, in its
// own words, that a short file list "quietly satisfies" both file arms and that an empty walk "is not a
// clean bill of health, it is a walk pointed somewhere wrong" — and it said both of those while
// returning `pass`. Two arms that can only report on what the walk found are worthless when the walk
// found nothing, and worse than worthless when they read as green.

test("an INCOMPLETE file walk fails — the two file arms cannot report on a list they did not finish", () => {
  const planted = [{ unit: "planted-live", runsOn: ["test"], tracked: [] }];
  const v = unitInventoryVerdict({ live: ["planted-live.service"], files: [A_REAL_TRACKED_FILE],
    filesError: "EACCES on driver/systemd", box: "test", probe: { ok: true }, inventory: planted });
  assert.equal(v.state, "fail");
  assert.match(v.message, /THE FILE ARMS DID NOT RUN/);
  assert.match(v.message, /EACCES on driver\/systemd/, "the reason the walk stopped is no longer carried");
});

test("an EMPTY file walk fails — no unit file anywhere is a path pointed wrong, not a clean tree", () => {
  const planted = [{ unit: "planted-live", runsOn: ["test"], tracked: [] }];
  const v = unitInventoryVerdict({ live: ["planted-live.service"], files: [], box: "test",
    probe: { ok: true }, inventory: planted });
  assert.equal(v.state, "fail");
  assert.match(v.message, /THE FILE ARMS DID NOT RUN/);
  assert.match(v.message, /found NO unit file anywhere/, "the empty case lost its own sentence");
});

test("a COMPLETE walk still passes — the control, without which the two arms above prove nothing", () => {
  const planted = [{ unit: "planted-live", runsOn: ["test"], tracked: [] }];
  const v = unitInventoryVerdict({ live: ["planted-live.service"], files: [A_REAL_TRACKED_FILE],
    box: "test", probe: { ok: true }, inventory: planted });
  assert.equal(v.state, "pass");
  assert.doesNotMatch(v.message, /DID NOT RUN/);
});

test("the two walk failures keep DIFFERENT sentences, because they are different states", () => {
  // Same verdict, and a reader still has to be able to tell "I could not read a directory" from
  // "I read everything and there was nothing there". Collapsing them would lose the more diagnostic one.
  const planted = [{ unit: "planted-live", runsOn: ["test"], tracked: [] }];
  const incomplete = unitInventoryVerdict({ live: [], files: [A_REAL_TRACKED_FILE], filesError: "EACCES", box: "test", probe: { ok: true }, inventory: planted });
  const empty = unitInventoryVerdict({ live: [], files: [], box: "test", probe: { ok: true }, inventory: planted });
  assert.match(incomplete.message, /INCOMPLETE/);
  assert.match(empty.message, /found NO unit file anywhere/);
  assert.notEqual(incomplete.message, empty.message);
});

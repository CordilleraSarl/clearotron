// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the unit that performs the deploy was the one unit deploy health could not
// attribute to a commit, so an updater running from a stale copy would have placed a stale tree with
// every check green.
//
// Every arm drives the PURE verdict. That is not a convenience here: the states worth catching — no
// stamp at all, a running copy that differs from its master, an updater feeding a different tree — are
// states a healthy box cannot be put into, and an arm that could only run the happy path would be green
// through the defect it is named for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updaterVerdict, readUpdaterStamp, updaterStampPath, resolveUpdaterStampPath, UPDATER_STAMP_BASENAME }
  from "../updater-identity.mjs";
import { serviceCommitVerdict, STAMP_ATTRIBUTED_UNITS, CHECKED_UNITS, UNIT_INVENTORY }
  from "../unit-inventory.mjs";

const SHA = "c".repeat(64);
const OTHER = "d".repeat(64);
const NOW = 1_789_000_000;
const CLONE = "/srv/checkout";

/** A stamp of the shape the updater writes, with one field overridden per arm. */
const stampOf = (over = {}) => ({
  schema: 1, writtenAt: NOW - 60,
  wrapper: "/srv/deploy/autodeploy.sh", wrapperSha256: SHA,
  masterPath: "/srv/store/ops/scripts/autodeploy.sh", masterSha256: SHA,
  masterCommit: "a".repeat(40), masterCommitError: null,
  checkout: CLONE, ...over,
});

// ── THE HEALTHY CASE FIRST, AS THE CONTROL. Every arm below asserts a fail; without a passing case
// beside them, a verdict that returned "fail" unconditionally would satisfy all of them.
test("a stamp whose two digests agree, on the tree being checked, passes", () => {
  const v = updaterVerdict({ stamp: stampOf(), now: NOW, deployClone: CLONE });
  assert.equal(v.state, "pass");
  // AND IT STATES THE LIMIT rather than claiming the updater is current: the master is read from a
  // store nothing pulls, so a store nobody has fetched leaves both sides equally old and in agreement.
  assert.match(v.message, /AS THIS BOX HOLDS IT/);
  assert.match(v.message, /not pulled automatically/);
});

test("no stamp at all FAILS, and says an absence is the stale-updater case rather than a gap", () => {
  const v = updaterVerdict({ stamp: null, now: NOW, deployClone: CLONE });
  assert.equal(v.state, "fail");
  assert.match(v.message, /failure to look, never a pass/);
  // The specific reason an absence is loud: the writer shipped IN the updater, so a copy old enough to
  // predate it writes none. An arm that only checked `state` would pass on a message that said
  // "not probed", which is the answer this branch exists to refuse.
  assert.match(v.message, /predate the stamp writes none/);
});

test("a running copy that DIFFERS from its master fails and names both digests", () => {
  const v = updaterVerdict({ stamp: stampOf({ masterSha256: OTHER }), now: NOW, deployClone: CLONE });
  assert.equal(v.state, "fail");
  assert.match(v.message, /DIFFERS from its master/);
  assert.match(v.message, new RegExp(SHA.slice(0, 8)));
  assert.match(v.message, new RegExp(OTHER.slice(0, 8)));
});

// ── AN UNREADABLE SIDE IS NOT A MISMATCH, and the distinction is the whole could-not-look rule: a
// digest that could not be taken must not be reported as two files that differ.
for (const [what, over, says, negatedByNeither] of [
  ["the running copy", { wrapperSha256: null }, /running copy of the updater could NOT be read as a digest/, false],
  ["the master", { masterSha256: null }, /the master could NOT be read as a digest/, false],
  // "neither X nor Y could be read" carries its negation in the neither/nor, so this row is exempt
  // from the un-negated-verb guard below rather than reworded into a double negative.
  ["both sides", { wrapperSha256: null, masterSha256: null }, /neither the running copy of the updater nor its master could be read as a digest/, true],
]) {
  test(`an unreadable digest on ${what} fails as a failure to look, not as drift`, () => {
    const v = updaterVerdict({ stamp: stampOf(over), now: NOW, deployClone: CLONE });
    assert.equal(v.state, "fail");
    assert.match(v.message, /failure to look, never a pass/);
    // THE VERB, NOT JUST THE NOUN. Matching "the master" alone passed a sentence that said the master
    // COULD be read — the opposite of the branch it was testing — because the phrase it looked for
    // survived the inversion intact.
    assert.match(v.message, says);
    assert.doesNotMatch(v.message, /DIFFERS/);
    if (!negatedByNeither) assert.doesNotMatch(v.message, /(?<!NOT )could be read as a digest/);
  });
}

test("an unreadable master carries the reason the updater reported", () => {
  const v = updaterVerdict({
    stamp: stampOf({ masterSha256: null, masterCommitError: "not a git repository" }),
    now: NOW, deployClone: CLONE });
  assert.equal(v.state, "fail");
  assert.match(v.message, /not a git repository/);
});

// ── THE STALE STAMP. Judged on a generous multiple, because a stopped deploy timer already fails on
// its own arm and one condition producing two reds teaches a reader to discount both.
test("a stamp older than the allowance fails; one inside it does not", () => {
  // STRADDLING THE DEFAULT, not a comfortable distance either side of it. A fixture at 7h against a 6h
  // allowance passes at 3h too, so it tests the branch without testing the threshold — the constant
  // could move a long way and this would not notice. These two are one hour apart across it.
  const old = updaterVerdict({ stamp: stampOf({ writtenAt: NOW - 4 * 3600 }), now: NOW, deployClone: CLONE });
  assert.equal(old.state, "fail");
  assert.match(old.message, /has not run/);
  assert.match(old.message, /past the 3h this check allows/);
  const fresh = updaterVerdict({ stamp: stampOf({ writtenAt: NOW - 2 * 3600 }), now: NOW, deployClone: CLONE });
  assert.equal(fresh.state, "pass");
  // A deferred tick is an hour, and a single deferral must not be a finding.
  assert.equal(updaterVerdict({ stamp: stampOf({ writtenAt: NOW - 90 * 60 }), now: NOW, deployClone: CLONE }).state, "pass");
});

test("the age is printed on a pass as well as a fail, and an unreadable time says so", () => {
  assert.match(updaterVerdict({ stamp: stampOf(), now: NOW, deployClone: CLONE }).message, /stamped 1 min ago/);
  const noTime = updaterVerdict({ stamp: stampOf({ writtenAt: null }), now: NOW, deployClone: CLONE });
  assert.match(noTime.message, /age is unknown/);
  assert.equal(noTime.state, "pass");   // an unknown age is not, by itself, a finding
});

// ── THE STRADDLE, POINTED AT THE MECHANISM. The digests agree in this state exactly as they do in a
// healthy one, which is why it needs its own branch: an updater keeping a DIFFERENT tree current is
// invisible to every comparison the stamp otherwise supports.
test("an updater that feeds a different tree than the one being checked fails", () => {
  const v = updaterVerdict({ stamp: stampOf({ checkout: "/srv/other" }), now: NOW, deployClone: CLONE });
  assert.equal(v.state, "fail");
  assert.match(v.message, /DIFFERENT tree/);
  assert.match(v.message, /\/srv\/other/);
  assert.match(v.message, /\/srv\/checkout/);
});

test("a trailing slash is not a different tree", () => {
  const v = updaterVerdict({ stamp: stampOf({ checkout: `${CLONE}/` }), now: NOW, deployClone: CLONE });
  assert.equal(v.state, "pass");
});

// ── THE READER. A parse failure and an absent file are the same null, and the verdict above says so.
test("readUpdaterStamp answers null for an absent file and for unparseable bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "updater-stamp-"));
  try {
    assert.equal(readUpdaterStamp(dir), null);
    writeFileSync(updaterStampPath(dir), "{ not json");
    assert.equal(readUpdaterStamp(dir), null);
    writeFileSync(updaterStampPath(dir), JSON.stringify(stampOf()));
    assert.equal(readUpdaterStamp(dir)?.wrapperSha256, SHA);
    assert.ok(updaterStampPath(dir).endsWith(UPDATER_STAMP_BASENAME));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── THE POPULATION MUST NOT LOSE A MEMBER. Moving the updater out of the compared population is only
// correct if it lands somewhere that is reported; a row in neither pile is the silently narrowed
// population that made this issue invisible in the first place.
test("every probed unit lands in exactly one bucket of the commit verdict", () => {
  const clones = [
    { unit: "clearotron-portal", clone: CLONE, head: "e".repeat(40), unreadable: null },
    { unit: "clearotron-deploy", clone: null, head: null, unreadable: "git could not read the home directory" },
    { unit: "other-product", clone: "/srv/elsewhere", head: "f".repeat(40), unreadable: null },
    { unit: "client-mcp-apikey", clone: null, head: null, unreadable: null },
    { unit: "broken", clone: null, head: null, unreadable: "no MainPID" },
  ];
  const v = serviceCommitVerdict({ clones, deployClone: CLONE });
  const buckets = [...v.owned, ...v.foreign, ...v.unreadable, ...v.stamped, ...v.idle];
  assert.equal(buckets.length, clones.length, `every row is accounted for: ${JSON.stringify(v)}`);
  assert.deepEqual([...buckets].sort(), clones.map((c) => c.unit).sort());
});

test("the updater is reported as stamped, never as a unit that could not be read", () => {
  const clones = [
    { unit: "clearotron-portal", clone: CLONE, head: "e".repeat(40), unreadable: null },
    { unit: "clearotron-deploy", clone: null, head: null, unreadable: "git could not read the home directory" },
  ];
  const v = serviceCommitVerdict({ clones, deployClone: CLONE });
  assert.deepEqual(v.stamped, ["clearotron-deploy"]);
  assert.ok(!v.unreadable.includes("clearotron-deploy"));
  // AND THE SENTENCE SAYS WHERE ITS VERDICT LIVES. Leaving it out of the unreadable count without
  // naming it anywhere would be the same silence wearing a smaller number.
  assert.match(v.message, /attributed by their own stamp/);
  assert.match(v.message, /clearotron-deploy/);
  assert.doesNotMatch(v.message, /could NOT be read/);
  assert.equal(v.state, "pass");
});

// ── THE LIST IS A PROPERTY, NOT A SPELLING. A literal at the use site keeps passing after the entry is
// renamed or retired, and the unit falls back into the could-not-read pile with nothing saying why.
test("the stamped population is declared in the inventory and is not empty", () => {
  assert.ok(STAMP_ATTRIBUTED_UNITS.length >= 1, "no unit declares stamp attribution — the arm guards nothing");
  for (const u of STAMP_ATTRIBUTED_UNITS) {
    assert.ok(CHECKED_UNITS.includes(u), `${u} is stamp-attributed but is not a unit this box checks`);
    const entry = UNIT_INVENTORY.find((e) => e.unit === u);
    assert.equal(entry?.attribution, "stamp");
  }
});

test("a unit not declared stamp-attributed is still compared normally", () => {
  const clones = [{ unit: "clearotron-portal", clone: CLONE, head: "e".repeat(40), unreadable: null }];
  const v = serviceCommitVerdict({ clones, deployClone: CLONE, stampAttributed: [] });
  assert.deepEqual(v.stamped, []);
  assert.deepEqual(v.owned, ["clearotron-portal"]);
});

// ── ONE NAME, NOT TWO. The reader resolving its own environment variable is how a redirected updater
// gets reported as an absent one: the writer honours CLEAROTRON_UPDATER_STAMP, so the reader must, and
// it is a FULL PATH rather than a directory. Both branches are driven because the fallback is what runs
// on every ordinary box and the override is what runs on the ones that moved.
test("the stamp path comes from the writer's own env name, and falls back to the deploy directory", () => {
  assert.equal(resolveUpdaterStampPath("/srv/deploy", {}), join("/srv/deploy", UPDATER_STAMP_BASENAME));
  assert.equal(resolveUpdaterStampPath("/srv/deploy", { CLEAROTRON_UPDATER_STAMP: "/elsewhere/stamp.json" }),
    "/elsewhere/stamp.json");
  // A box that redirects its updater and has no derivable directory still resolves.
  assert.equal(resolveUpdaterStampPath(null, { CLEAROTRON_UPDATER_STAMP: "/elsewhere/stamp.json" }),
    "/elsewhere/stamp.json");
  // Neither half available is a could-not-resolve, which the arm reports as a failure to look.
  assert.equal(resolveUpdaterStampPath(null, {}), null);
});

test("readUpdaterStamp reads the overridden path, not the derived one", () => {
  const dir = mkdtempSync(join(tmpdir(), "updater-stamp-env-"));
  try {
    const moved = join(dir, "moved.json");
    writeFileSync(moved, JSON.stringify(stampOf({ wrapperSha256: "aa" })));
    writeFileSync(join(dir, UPDATER_STAMP_BASENAME), JSON.stringify(stampOf({ wrapperSha256: "bb" })));
    assert.equal(readUpdaterStamp(dir, { env: { CLEAROTRON_UPDATER_STAMP: moved } })?.wrapperSha256, "aa");
    assert.equal(readUpdaterStamp(dir, { env: {} })?.wrapperSha256, "bb");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

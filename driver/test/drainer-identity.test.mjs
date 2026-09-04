// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — deploy health must be able to say which build the process that EXECUTES
// runs is holding, and must never report a build live having failed to look.
//
// Every arm below drives the PURE verdict, so both branches of every could-not-look are reachable on
// any box. That matters here more than usual: the incident's state — an orphaned drainer, in no unit,
// stamped by nothing — is precisely the state that cannot be staged on a healthy machine, and an arm
// that could only run the happy path would be green through the defect it is named for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drainerVerdict, writeDrainerStamp, readDrainerStamp, drainerStampPath, DRAINER_CMD, STAMP_BASENAME, defaultPpidOf }
  from "../drainer-identity.mjs";

const HEAD = "b".repeat(40);
const HELD = "a".repeat(40);
const ALIVE = () => true;
const GONE = () => false;
const stampOf = (o = {}) => ({ schema: 1, pid: 4242, pidStarttime: "999", engineCommit: HEAD,
  engineCommitSource: "git", mode: "watch", ...o });

test("no stamp is a FAILURE, not a skip — the deploy must not report a build live having never looked", () => {
  const v = drainerVerdict({ stamp: null, headCommit: HEAD, isAlive: ALIVE, processes: [] });
  assert.equal(v.state, "fail", "an absent stamp recorded as skip would pass the very box this arm exists for: "
    + "live-surface-check exits non-zero on `fail` only, so a skip leaves the deploy green");
  assert.match(v.message, /never a pass/);
});

test("no stamp WITH drainer processes running names them — an orphan that stamped nothing is the incident", () => {
  const v = drainerVerdict({ stamp: null, headCommit: HEAD, isAlive: ALIVE,
    processes: [{ pid: 746243, cmd: "node /home/x/driver/runner.mjs --watch" }] });
  assert.equal(v.state, "fail");
  assert.match(v.message, /pid 746243/, "the issue's second criterion is that an unsupervised drainer is reported BY NAME");
  assert.match(v.message, /unstamped/);
});

test("no stamp and no readable process table says BOTH could not be looked at", () => {
  const v = drainerVerdict({ stamp: null, headCommit: HEAD, isAlive: ALIVE, processes: null });
  assert.equal(v.state, "fail");
  assert.match(v.message, /process table could not be read/,
    "null is UNREADABLE and [] is EMPTY — reporting them the same way is how an absence becomes a pass");
});

test("THE INCIDENT: a live drainer on a different commit fails, and the message names BOTH commits", () => {
  const v = drainerVerdict({ stamp: stampOf({ engineCommit: HELD }), headCommit: HEAD, isAlive: ALIVE, processes: [] });
  assert.equal(v.state, "fail");
  assert.match(v.message, /aaaaaaaa/, "the commit the executing process actually loaded");
  assert.match(v.message, /bbbbbbbb/, "and the commit the checkout is on — the third criterion asks for both");
  assert.match(v.message, /Restart the drainer/, "a health failure an operator cannot act on is half a check");
});

test("a live drainer on the deployed commit passes", () => {
  const v = drainerVerdict({ stamp: stampOf(), headCommit: HEAD, isAlive: ALIVE, processes: [{ pid: 4242, cmd: "runner.mjs --watch" }] });
  assert.equal(v.state, "pass");
  assert.match(v.message, /pid 4242/);
});

test("a STAMPED drainer whose process is gone fails — nothing is executing runs", () => {
  const v = drainerVerdict({ stamp: stampOf(), headCommit: HEAD, isAlive: GONE, processes: [] });
  assert.equal(v.state, "fail");
  assert.match(v.message, /IS GONE/);
});

test("a SECOND, unstamped drainer beside a healthy one is reported and downgrades the pass", () => {
  // The stamp can only speak for the process that wrote it. A second drainer — an orphan of an earlier
  // start, the incident's own shape — holds a build nothing here can name, so a clean `pass` would be
  // a claim about a process this arm never saw.
  const v = drainerVerdict({ stamp: stampOf(), headCommit: HEAD, isAlive: ALIVE,
    processes: [{ pid: 4242, cmd: "runner.mjs --watch" }, { pid: 999111, cmd: "node bin/clearotron start" }] });
  assert.equal(v.state, "warn");
  assert.match(v.message, /999111/);
  assert.doesNotMatch(v.message, /UNACCOUNTED FOR: 2/, "the stamping process is not a stray");
});

test("an incomplete stamp cannot say who is draining, and is a failure", () => {
  for (const bad of [stampOf({ pid: null }), stampOf({ engineCommit: null }), stampOf({ pid: 0 })]) {
    const v = drainerVerdict({ stamp: bad, headCommit: HEAD, isAlive: ALIVE, processes: [] });
    assert.equal(v.state, "fail", `must refuse ${JSON.stringify(bad)}`);
  }
});

test("an unreadable checkout HEAD is a could-not-look, never a pass", () => {
  const v = drainerVerdict({ stamp: stampOf(), headCommit: null, isAlive: ALIVE, processes: [] });
  assert.equal(v.state, "fail");
  assert.match(v.message, /could not be read/);
});

test("Refs tracker issue 2081 — a build named from the archive says so, and still compares", () => {
  const v = drainerVerdict({ stamp: stampOf({ engineCommitSource: "build-info" }), headCommit: HEAD,
    isAlive: ALIVE, processes: [] });
  assert.equal(v.state, "pass");
  assert.match(v.message, /build-info\.json/,
    "a sha attested by a shipped file is a weaker claim than one read from a live checkout, and a reader "
    + "who cannot tell them apart cannot tell a stamped archive from a verified tree");
});

test("the command pattern matches both shapes a deployment drains with, and not the check itself", () => {
  assert.ok(DRAINER_CMD.test("node /home/x/driver/runner.mjs --watch"));
  assert.ok(DRAINER_CMD.test("node /home/x/bin/clearotron start --background"));
  assert.ok(DRAINER_CMD.test("npx clearotron start"));
  // A guard that matched its own reader would report the health check as an unaccounted drainer on
  // every run, which is a check that cries wolf until it is ignored.
  assert.ok(!DRAINER_CMD.test("node scripts/live-surface-check.mjs"));
  assert.ok(!DRAINER_CMD.test("node driver/pipeline.mjs --experiment synthesis"));
});

test("the stamp round-trips through a real file, and a torn or absent one reads as null", () => {
  const dir = mkdtempSync(join(tmpdir(), "drainer-stamp-"));
  try {
    assert.equal(readDrainerStamp(dir), null, "no stamp yet — and that must be a null, not a throw");
    const written = writeDrainerStamp(dir, { pid: 7, pidStarttime: "1", engineCommit: HELD, mode: "once" });
    assert.equal(written, drainerStampPath(dir));
    assert.match(readFileSync(written, "utf8"), /"schema": 1/);
    const back = readDrainerStamp(dir);
    assert.equal(back.pid, 7);
    assert.equal(back.engineCommit, HELD);
    // A half-written stamp must never be read as a stamp. The writer renames into place for this
    // reason; the reader's job is to answer null rather than hand a caller a torn commit sha.
    assert.equal(readDrainerStamp(dir, { read: () => '{"pid": 7, "engineComm' }), null);
    assert.equal(basenameOf(written), STAMP_BASENAME);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const basenameOf = (p) => p.split("/").pop();

test("Refs tracker issue 1977 criterion 2 — an UNSUPERVISED drainer is named even when every commit agrees", () => {
  // PPID 1 is the incident's own shape: an orphan of a start whose supervisor exited, in a `closing`
  // SSH session. Nothing restarts it, so the next deploy moves the checkout and leaves it on old code.
  // It downgrades an otherwise-clean pass because agreement today is not durability.
  const v = drainerVerdict({ stamp: stampOf(), headCommit: HEAD, isAlive: ALIVE, processes: [],
    ppidOf: () => 1 });
  assert.equal(v.state, "warn");
  assert.match(v.message, /NOT UNDER A SUPERVISOR \(PPID 1\)/);
  assert.match(v.message, /next deploy/, "the operator has to be told what it will cost, not just what it is");
});

test("a SUPERVISED drainer on the deployed commit is still a clean pass", () => {
  const v = drainerVerdict({ stamp: stampOf(), headCommit: HEAD, isAlive: ALIVE, processes: [],
    ppidOf: () => 8421 });
  assert.equal(v.state, "pass", "a check that warns on every healthy box is one everybody learns to ignore");
});

test("an UNREADABLE parent is unknown, and is never read as supervised", () => {
  const v = drainerVerdict({ stamp: stampOf(), headCommit: HEAD, isAlive: ALIVE, processes: [],
    ppidOf: () => null });
  assert.equal(v.state, "warn");
  assert.match(v.message, /could not be read/);
});

test("the supervision read is LIVE, not taken from the stamp — the orphaning happens after boot", () => {
  // A drainer's parent at boot IS its supervisor; it becomes 1 when that supervisor exits, which is the
  // event this criterion is about. A stamp-recorded ppid would hold the healthy boot value and report
  // the orphan as supervised — the finding lost to the moment it was taken.
  const stampClaimingHealthyParent = stampOf({ ppid: 8421 });
  const v = drainerVerdict({ stamp: stampClaimingHealthyParent, headCommit: HEAD, isAlive: ALIVE,
    processes: [], ppidOf: () => 1 });
  assert.match(v.message, /NOT UNDER A SUPERVISOR/,
    "the live read must win over anything the stamp claims about its own parent");
});

test("defaultPpidOf parses a ps answer, and answers null rather than guessing", () => {
  assert.equal(defaultPpidOf(1, { run: () => " 8421\n" }), 8421);
  assert.equal(defaultPpidOf(1, { run: () => "" }), null, "no answer is not pid 0");
  assert.equal(defaultPpidOf(1, { run: () => "not-a-number" }), null);
  assert.equal(defaultPpidOf(1, { run: () => { throw new Error("no such process"); } }), null);
});

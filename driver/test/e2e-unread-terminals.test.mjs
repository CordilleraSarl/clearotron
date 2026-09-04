// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — unread round terminals, and which of them can still be recovered.
//
// The receipts already record reading; nothing listed the nulls, so 39 of 62 rounds went unread and one
// blocking FAILED terminal sat for 34 hours. The asymmetry is what makes this a deadline rather than a
// tidy-up: an unread round whose run dir is on disk can be read today, and one that has been purged is
// unknowable forever.
//
// Two assertions here matter more than the rest, and both are about the check FAILING SAFE, because
// this one is meant to gate a purge:
//
//   · a depth-agnostic walk, because finished runs move into `archive/<YYYY-MM>/…`. A fixed-depth walk
//     would call an archived run purged, which would license deleting the very thing it protects.
//   · an empty corpus on EITHER side exits 2 rather than reporting a clean sweep. With no receipts
//     there is nothing to say; with no directories every round looks purged.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { readDoors, directoryNames, locateRun, ageHours, classify, summarise, runStateProbe, hasAttemptRows, evidenceDirs }
  from "../../scripts/e2e-unread-terminals.mjs";

const NOW = Date.parse("2026-08-14T12:00:00.000Z");
const round = (token, extra = {}) => ({
  token, startedAt: "2026-08-12T12:00:00.000Z", doors: ["portal"], cases: [], recorded: true,
  reportedAt: null, reportedState: null, clearedAt: null, ...extra,
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "e2e-unread-"));
  const doors = join(root, "doors"); mkdirSync(doors);
  const runs = join(root, "runs"); mkdirSync(runs);
  const writeDoor = (id, rounds) =>
    writeFileSync(join(doors, `_e2e-doors-${id}.json`), JSON.stringify({ version: 1, scenario: id, rounds }));
  const makeRun = (rel) => mkdirSync(join(runs, rel), { recursive: true });
  return { root, doors, runs, writeDoor, makeRun, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("#922 only rounds that are NOT SETTLED are listed — a SETTLED round is done", () => {
  // AMENDED 2026-08-14. This asserted "a READ round is done" and used `reportedState: "PASS"` as the
  // closed sentinel — neither is the rule. The harness closes a round on `reportedState === "settled"`
  // (previousRoundNotice in e2e.mjs:2210) and "PASS" is not that word, so under the corrected rule
  // this fixture is still unclosed. Both halves of the old test were wrong in the same direction: they
  // let a round leave the list without being closed.
  const f = fixture();
  try {
    f.writeDoor("R1", [round("aaaa1111"), round("bbbb2222", { reportedAt: "2026-08-13T00:00:00.000Z", reportedState: "settled" })]);
    f.makeRun("tmpe2er1aaaa1111-matter");
    const rows = classify(readDoors(f.doors), directoryNames(f.runs), NOW, () => "readable");
    assert.deepEqual(rows.map((r) => r.token), ["aaaa1111"]);
  } finally { f.cleanup(); }
});

test("#922 ARCHIVED RUNS ARE FOUND — calling one purged would license deleting it", () => {
  // The error that would matter most. Finished runs move two directory levels deeper; a fixed-depth
  // walk reports them as purged, and this script's whole purpose is to say which rounds are still
  // recoverable BEFORE a purge decision.
  const f = fixture();
  try {
    f.writeDoor("R2", [round("cccc3333"), round("dddd4444")]);
    f.makeRun("tmpe2er2cccc3333-matter/2026-08-12-some-codename");
    f.makeRun("archive/2026-08/tmpe2er2dddd4444-matter/2026-08-12-other-codename");
    const rows = classify(readDoors(f.doors), directoryNames(f.runs), NOW, () => "readable");
    assert.deepEqual(rows.map((r) => r.state), ["readable", "readable"],
      "the archived round must not read as purged");
  } finally { f.cleanup(); }
});

test("#922 a purged round is reported as UNRECOVERABLE, never dropped", () => {
  // An absence that is never named reads as though it never happened, which is exactly how these went
  // missing in the first place.
  const f = fixture();
  try {
    f.writeDoor("R3", [round("eeee5555")]);
    const rows = classify(readDoors(f.doors), directoryNames(f.runs), NOW, () => "readable");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "purged");
    assert.equal(rows[0].runDir, null);
  } finally { f.cleanup(); }
});

test("#922 a round with no token is UNLOCATABLE — a third state, not a purge", () => {
  const f = fixture();
  try {
    f.writeDoor("R4", [round(null), round("")]);
    const rows = classify(readDoors(f.doors), directoryNames(f.runs), NOW, () => "readable");
    assert.deepEqual(rows.map((r) => r.state), ["unlocatable", "unlocatable"],
      "cannot be tied to a run is a different fact from was deleted");
  } finally { f.cleanup(); }
});

test("#922 the token locates a run wherever the prefix convention puts it", () => {
  const names = new Map([["tmpe2er52a41a22c-meridian-thistle", "/runs/tmpe2er52a41a22c-meridian-thistle"]]);
  assert.ok(locateRun("2a41a22c", names));
  assert.equal(locateRun("deadbeef", names), null);
  assert.equal(locateRun(null, names), null);
  assert.equal(locateRun("", names), null, "an empty token must not match every directory");
});

test("#922 age is measured, and an unmeasurable age is null rather than zero", () => {
  assert.equal(Math.round(ageHours("2026-08-13T12:00:00.000Z", NOW)), 24);
  assert.equal(ageHours(null, NOW), null, "no stamp is not age zero — zero would read as brand new");
  assert.equal(ageHours("not a date", NOW), null);
});

test("#922 an unmeasurable age counts as STALE — the safe direction for a purge gate", () => {
  // A round whose age cannot be established must not slip under the staleness bar: this number gates a
  // deletion, so the unknown case has to fall on the side that keeps the evidence.
  const f = fixture();
  try {
    f.writeDoor("R5", [round("ffff6666", { startedAt: null })]);
    f.makeRun("tmpe2er5ffff6666-matter");
    const rows = classify(readDoors(f.doors), directoryNames(f.runs), NOW, () => "readable");
    assert.equal(rows[0].ageHours, null);
    assert.equal(summarise(rows, 24).stale, 1);
  } finally { f.cleanup(); }
});

test("#922 the summary counts each state once and they add up", () => {
  const f = fixture();
  try {
    f.writeDoor("R6", [round("1111aaaa"), round("2222bbbb"), round(null)]);
    f.makeRun("tmpe2er61111aaaa-matter");
    const rows = classify(readDoors(f.doors), directoryNames(f.runs), NOW, () => "readable");
    const s = summarise(rows, 24);
    assert.equal(s.unread, 3);
    // FOUR states now, and the sum is still the whole population — the property that stops a state
    // being added without a home, which is how `shell` hid inside `recoverable` in the first place.
    assert.equal(s.readable + s.shell + s.purged + s.unlocatable, s.unread,
      "every unread round is in exactly one state");
    assert.deepEqual([s.readable, s.shell, s.purged, s.unlocatable], [1, 0, 1, 1]);
  } finally { f.cleanup(); }
});

test("#922 a damaged receipt is skipped, never fatal — the others still report", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.doors, "_e2e-doors-BAD.json"), "{not json");
    f.writeDoor("R0", [round("3333cccc")]);
    const doors = readDoors(f.doors);
    assert.deepEqual(doors.map((d) => d.scenario), ["R0"]);
  } finally { f.cleanup(); }
});

test("#922 AN ABSENCE IS A FINDING on both sides", () => {
  const f = fixture();
  try {
    assert.deepEqual(readDoors(join(f.root, "nope")), [], "no receipts ⇒ nothing, and the caller exits 2");
    assert.equal(directoryNames(join(f.root, "nope")).size, 0);
    // The dangerous case: receipts present, no directories. Every round would classify as purged, and
    // acting on that would delete evidence on the strength of a wrong reading. The CLI refuses.
    f.writeDoor("R1", [round("4444dddd")]);
    const rows = classify(readDoors(f.doors), directoryNames(join(f.root, "nope")), NOW, () => "readable");
    assert.equal(rows[0].state, "purged",
      "…which is why the CLI checks the directory map is non-empty BEFORE trusting this");
  } finally { f.cleanup(); }
});

// ── second round — A DIRECTORY IS NOT A RUN ────────────────────────────────────────────────────
//
// The first version classified on the DIRECTORY EXISTING. 15 of the 26 rounds it called recoverable
// were empty shells: a cleanup had taken the contents and left the name. So it budgeted 27 reads that
// would have yielded 12, and reported completed losses as recoverable — the one direction this script
// must never err in, because "recoverable" is what licenses waiting instead of acting.

test("#922 A SHELL IS NOT READABLE — the defect, stated as a property", () => {
  const doors = [{ scenario: "R2", rounds: [
    { token: "aaaa1111", startedAt: "2026-08-13T00:00:00Z" },
    { token: "bbbb2222", startedAt: "2026-08-13T00:00:00Z" },
  ] }];
  const names = new Map([["run-aaaa1111", "/p/a"], ["run-bbbb2222", "/p/b"]]);
  const rows = classify(doors, names, Date.parse("2026-08-14T00:00:00Z"), (p) => (p === "/p/a" ? "readable" : "shell"));
  assert.deepEqual(rows.map((r) => r.state), ["readable", "shell"]);
});

test("#922 SHELL AND PURGED STAY DISTINCT — they are different events", () => {
  // A purge removed a run; something else removed a run's CONTENTS and left its name behind. Folding
  // them would lose the evidence that the second thing happens at all.
  const doors = [{ scenario: "R2", rounds: [
    { token: "bbbb2222", startedAt: "2026-08-13T00:00:00Z" },
    { token: "cccc3333", startedAt: "2026-08-13T00:00:00Z" },
    { token: null },
  ] }];
  const rows = classify(doors, new Map([["run-bbbb2222", "/p/b"]]),
    Date.parse("2026-08-14T00:00:00Z"), () => "shell");
  assert.deepEqual(rows.map((r) => r.state), ["shell", "purged", "unlocatable"]);
  const sum = summarise(rows, 24);
  assert.deepEqual(sum, { unread: 3, readable: 0, stillborn: 0, shell: 1, purged: 1, unlocatable: 1, stale: 0 });
});

test("#922 STALE COUNTS ONLY WHAT CAN STILL BE READ", () => {
  // Counting a shell as stale keeps budgeting a read that cannot happen — the defect one level up from
  // the one this fixes.
  const doors = [{ scenario: "R2", rounds: [{ token: "bbbb2222", startedAt: "2020-01-01T00:00:00Z" }] }];
  const rows = classify(doors, new Map([["run-bbbb2222", "/p/b"]]), Date.now(), () => "shell");
  assert.equal(summarise(rows, 24).stale, 0, "ancient, and still not something anyone can read");
});

test("#922 the probe answers the question the name promises", () => {
  // runStateProbe is the filesystem half. `status.json` is what `e2e.mjs report` reads, and that tool
  // has always disagreed with this script correctly — this is that agreement, made structural.
  const dir = mkdtempSync(join(tmpdir(), "shell-"));
  try {
    assert.equal(runStateProbe(dir), "shell", "an empty directory is a shell");
    // AMENDED 2026-08-14: a status record ALONE is `stillborn`, not `readable`. e2e's 3e738078 read
    // showed status.json cannot separate a run that failed at claim from a live one seconds old.
    writeFileSync(join(dir, "status.json"), "{}");
    assert.equal(runStateProbe(dir), "stillborn");
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(driverDir(dir, "synthesis.jsonl"),
      JSON.stringify({ attempt: 1, key: "synthesis", status: "ok" }) + "\n");
    assert.equal(runStateProbe(dir), "readable", "an attempt row is what makes it readable");
    assert.equal(runStateProbe(join(dir, "does-not-exist")), "shell", "unreadable is never readable");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── STILLBORN — the state e2e's 3e738078 reconcile found, and why status.json was too weak ──────────
//
// the one measured specimen carries a status.json, carries run.jsonl, and carries NO attempt row in any
// seat file. Its whole lifetime — startedAt to updatedAt — is TWO MILLISECONDS. It failed at claim.
// By directory, by status.json and by file count it is indistinguishable from a live run seconds after
// launch, which is exactly why the readability test had to become the attempt-row rule: the same
// definition that already governs attempt counting, reused rather than reinvented.

test("#922 STILLBORN is its own state — a driver finding, not a retention one", () => {
  const dir = mkdtempSync(join(tmpdir(), "stillborn-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(join(dir, "status.json"), "{}");
    writeFileSync(driverDir(dir, "run.jsonl"), JSON.stringify({ event: "claimed" }) + "\n");
    assert.equal(runStateProbe(dir), "stillborn",
      "a status record and no attempt row anywhere: the run never dispatched");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#922 run.jsonl IS EXCLUDED — it is the only file the stillborn run has", () => {
  // Counting it would call the one run that never dispatched readable, which is the whole defect.
  const dir = mkdtempSync(join(tmpdir(), "runjsonl-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(driverDir(dir, "run.jsonl"),
      JSON.stringify({ attempt: 1, key: "synthesis", status: "ok" }) + "\n");
    assert.equal(hasAttemptRows(dir), false, "even a dispatch-SHAPED row in run.jsonl is not a seat row");
    writeFileSync(driverDir(dir, "synthesis.jsonl"),
      JSON.stringify({ attempt: 1, key: "synthesis", status: "ok" }) + "\n");
    assert.equal(hasAttemptRows(dir), true, "…and one in a seat file is");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#922 a run WITH work is readable, and an empty directory is still a shell", () => {
  const dir = mkdtempSync(join(tmpdir(), "readable-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(join(dir, "status.json"), "{}");
    writeFileSync(driverDir(dir, "matter-frame.jsonl"),
      JSON.stringify({ attempt: 1, key: "matter-frame", status: "ok" }) + "\n");
    assert.equal(runStateProbe(dir), "readable");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const empty = mkdtempSync(join(tmpdir(), "empty-"));
  try { assert.equal(runStateProbe(empty), "shell"); } finally { rmSync(empty, { recursive: true, force: true }); }
});

test("#922 the five states still partition the population", () => {
  const doors = [{ scenario: "R2", rounds: [
    { token: "aaaa1111" }, { token: "bbbb2222" }, { token: "cccc3333" }, { token: "dddd4444" }, { token: null },
  ] }];
  const names = new Map([["r-aaaa1111", "/p/a"], ["r-bbbb2222", "/p/b"], ["r-cccc3333", "/p/c"]]);
  const probe = (p) => ({ "/p/a": "readable", "/p/b": "stillborn", "/p/c": "shell" }[p]);
  const s = summarise(classify(doors, names, Date.now(), probe), 24);
  assert.equal(s.readable + s.stillborn + s.shell + s.purged + s.unlocatable, s.unread);
  assert.deepEqual([s.readable, s.stillborn, s.shell, s.purged, s.unlocatable], [1, 1, 1, 1, 1]);
});

// ── UNCLOSED IS `reportedState !== "settled"` (e2e's measurement, 2026-08-14) ──────────────────
//
// 64 rounds = 21 never read + 9 READ-BUT-NOT-SETTLED + 34 settled. Unclosed is 30, not 21. A round
// looked at and returned "unknown" got a `reportedAt` stamp and dropped off this list while remaining
// exactly as unclosed — so READING a round was enough to stop it being counted, whatever the read
// found. The harness already knew: previousRoundNotice in e2e.mjs:2210 closes a round on
// `reportedState === "settled"`, NEVER on `reportedAt != null`. This lister was the last reader
// keying on the weaker field.

test("#922 a round READ but NOT SETTLED is still listed", () => {
  const doors = [{ scenario: "R2", rounds: [
    round("aaaa1111", { reportedAt: "2026-08-13T00:00:00Z", reportedState: "unknown" }),
    round("bbbb2222", { reportedAt: "2026-08-13T00:00:00Z", reportedState: "settled" }),
    round("cccc3333"),
  ] }];
  const rows = classify(doors, new Map([["r-aaaa1111", "/p/a"], ["r-cccc3333", "/p/c"]]),
    Date.now(), () => "readable");
  assert.deepEqual(rows.map((r) => r.token), ["aaaa1111", "cccc3333"],
    "the settled one drops off; the read-but-unknown one does not");
});

test("#922 reading a round does not close it — only settling does", () => {
  // The property, stated as the inverse: a stamp alone must never remove a round from the list.
  const stamped = round("aaaa1111", { reportedAt: "2026-08-13T00:00:00Z", reportedState: "in-flight" });
  const rows = classify([{ scenario: "R2", rounds: [stamped] }],
    new Map([["r-aaaa1111", "/p/a"]]), Date.now(), () => "readable");
  assert.equal(rows.length, 1);
});

// ── — THE REAL ON-DISK SHAPE, WHICH NO TEST ABOVE EVER BUILT AND PROBED ───────────────────────
//
// Every test above is correct and none of them could have caught this, in two complementary ways that
// are worth naming because the same blind spot is easy to rebuild:
//
//   (a) every `classify` test INJECTS a probe (`() => "readable"`), so the real `locateRun → probe`
//       handoff — the seam the defect lived in — is never exercised;
//   (b) every real-probe test plants `_driver` as a direct child of the directory it then probes,
//       which is not the shape on disk. The tests agreed with the bug.
//
// The sharpest instance is " ARCHIVED RUNS ARE FOUND" above: it builds the true two-level tree and
// then blindfolds itself with an injected probe on the very next line.
//
// What was actually on disk, measured on the test box: 4 of the 6 rounds the lister called `stillborn`
// carried attempt rows. The module header offers its exit code as a purge gate — so the failure mode
// was a green light to delete recoverable evidence.

/** The real layout: a matter directory, a dated run directory under it, `_driver` under THAT. */
function plantRealRun(root, matter, dated, { seat = "synthesis", rows = true } = {}) {
  const runDir = join(root, matter, dated);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "status.json"), "{}");
  writeFileSync(driverDir(runDir, "run.jsonl"), JSON.stringify({ event: "claimed" }) + "\n");
  if (rows) {
    writeFileSync(driverDir(runDir, `${seat}.jsonl`),
      JSON.stringify({ attempt: 1, key: seat, status: "ok" }) + "\n");
  }
  return runDir;
}

test("#1128 THE PROBE IS GIVEN THE MATTER DIR AND MUST STILL FIND THE WORK", () => {
  // `locateRun` can only ever return the matter directory — the round token appears nowhere else in
  // the tree. So the probe being unable to answer at that level was not an edge case, it was every
  // case: nothing ever classified as readable and `readable: 0` was structural.
  const f = fixture();
  try {
    const matter = "tmpe2er1aaaa1111-some-matter";
    plantRealRun(f.runs, matter, "2026-08-12-a-dated-run");
    assert.equal(runStateProbe(join(f.runs, matter)), "readable",
      "the matter directory holds a dated run whose _driver carries attempt rows — that is readable evidence");
    // The exactness the teardown gate depends on is UNCHANGED and asserted here so a later refactor
    // cannot quietly move the fallback into the shared definition.
    assert.equal(hasAttemptRows(join(f.runs, matter)), false,
      "hasAttemptRows still reads <dir>/_driver with no fallback — the gate in e2e.mjs relies on that");
  } finally { f.cleanup(); }
});

test("#1128 a matter whose run really has NO work is still stillborn, not rescued by the descent", () => {
  // The other direction, and the one that would matter if this fix over-reached: descending must not
  // turn the 2ms claim-failure specimen into evidence. `run.jsonl` is excluded at both levels.
  const f = fixture();
  try {
    const matter = "tmpe2er1bbbb2222-some-matter";
    plantRealRun(f.runs, matter, "2026-08-12-another-dated-run", { rows: false });
    assert.equal(runStateProbe(join(f.runs, matter)), "stillborn",
      "a dated run carrying only run.jsonl is a driver finding, not recoverable evidence");
  } finally { f.cleanup(); }
});

test("#1128 a matter holding TWO dated runs is readable if EITHER carries work", () => {
  // A matter can hold a re-run. Stopping at the first child would under-report in exactly the
  // direction the original defect did.
  const f = fixture();
  try {
    const matter = "tmpe2er1cccc3333-some-matter";
    plantRealRun(f.runs, matter, "2026-08-12-first-attempt", { rows: false });
    plantRealRun(f.runs, matter, "2026-08-13-second-attempt", { seat: "matter-frame", rows: true });
    assert.equal(runStateProbe(join(f.runs, matter)), "readable");
  } finally { f.cleanup(); }
});

test("#1128 END TO END on the REAL probe: readable evidence makes the exit code non-zero", () => {
  // The claim in the module's own header is that a purge path can be gated on the exit code. This is
  // that claim, tested through the whole chain — doors → directoryNames → locateRun → runStateProbe →
  // summarise → exit code — with NO injected probe anywhere. It is the test the module never had, and
  // its absence is why three separate corrections to this lister all missed the same thing.
  const f = fixture();
  try {
    f.writeDoor("R2", [round("eeee5555")]);
    plantRealRun(f.runs, "tmpe2er2eeee5555-some-matter", "2026-08-12-the-dated-run");
    const rows = classify(readDoors(f.doors), directoryNames(f.runs), NOW);
    assert.deepEqual(rows.map((r) => r.state), ["readable"], "the default probe is the real one");
    const sum = summarise(rows, 24);
    assert.equal(sum.stale, 1, "started 2026-08-12, measured at 2026-08-14: well past 24h and readable");
    assert.equal(sum.stale ? 1 : 0, 1,
      "this is the exit code the header promises a purge can be gated on — it was 0 while this "
      + "evidence sat on disk, which is a green light to delete it");
  } finally { f.cleanup(); }
});

test("#1128 the archived two-level round classifies readable WITHOUT an injected probe", () => {
  // The blindfold removed from " ARCHIVED RUNS ARE FOUND". Same tree, real probe.
  const f = fixture();
  try {
    f.writeDoor("R2", [round("cccc3333"), round("dddd4444")]);
    plantRealRun(f.runs, "tmpe2er2cccc3333-matter", "2026-08-12-some-codename");
    plantRealRun(f.runs, "archive/2026-08/tmpe2er2dddd4444-matter", "2026-08-12-other-codename");
    const rows = classify(readDoors(f.doors), directoryNames(f.runs), NOW);
    assert.deepEqual(rows.map((r) => r.state), ["readable", "readable"],
      "an archived round is recoverable evidence and must never read as purged OR as stillborn");
  } finally { f.cleanup(); }
});

test("#1128 evidenceDirs is one level, never a walk", () => {
  // A walk would eventually reach an archive of unrelated runs and report them as this round's
  // evidence — a false POSITIVE, which on a purge gate is the same class of error pointed the other
  // way. Asserted directly so the bound is a decision rather than an accident of the layout.
  const dir = mkdtempSync(join(tmpdir(), "evdirs-"));
  try {
    mkdirSync(driverDir(join(dir, "2026-08-12-codename")), { recursive: true });
    writeFileSync(join(dir, "loose.txt"), "x");
    const got = evidenceDirs(dir, readdirSync(dir, { withFileTypes: true }));
    assert.deepEqual(got, [dir, join(dir, "2026-08-12-codename")],
      "the directory itself and its immediate children — files are not directories, and grandchildren are not included");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

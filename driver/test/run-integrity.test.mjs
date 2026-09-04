// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the frozen judged-by set across a seat turn.
//
// THE THREE PROPERTIES ARE PRE-REGISTERED ON THE ISSUE, and two of them are about the check staying
// SILENT. That ordering is deliberate: an integrity check does not die by missing a write, it dies by
// crying wolf until somebody disables it. So the quiet cases are asserted as hard as the loud one.
//
//   1. a rewrite of a frozen record while a seat ran is CAUGHT and names the file
//   2. a write to an excluded append-only journal does NOT fault — concurrent stages write those mid-turn
//   3. a turn that touches nothing produces NO ROW AT ALL
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { frozenSnapshot, frozenDiff, describeDrift, isFrozenEntry,
  BY_DESIGN_MUTATORS, byDesignMutator, isSiblingDispatch, stageBlock } from "../run-integrity.mjs";
import { WITNESS_FILE } from "../methodology-witness.mjs";
import { dispatchFileName } from "../dispatch-record.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

/** One name for the guard, so the skip reports what the marker says. */
const JOURNAL_GUARD = "#1365 the journal sinks outside the frozen set";

// — the repo root, derived the way every other guard in this suite derives it.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const mk = () => {
  const dir = mkdtempSync(join(tmpdir(), "run-integrity-"));
  mkdirSync(driverDir(dir), { recursive: true });
  return dir;
};
const put = (dir, name, body) => writeFileSync(driverDir(dir, name), body);
const dirs = [];
const run = () => { const d = mk(); dirs.push(d); return d; };
test.after?.(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

// ── property 1: the loud case ────────────────────────────────────────────────────────────────────────

test("#954: a frozen record rewritten while the seat ran is CAUGHT, and the row names it", () => {
  const dir = run();
  put(dir, "register-plan.json", '{"plan_version":7,"entries":[]}');
  put(dir, "plan-execution.json", '{"missing":[]}');
  const before = frozenSnapshot(dir);

  // the seat forges the receipt its own round is judged by
  put(dir, "plan-execution.json", '{"missing":[],"executed":["everything, honest"]}');

  const drift = describeDrift("common-law-half:m", before, frozenSnapshot(dir));
  assert.ok(drift, "a rewritten frozen record must produce a row");
  assert.equal(drift.verdict, "would-fault");
  assert.deepEqual(drift.changed, ["plan-execution.json"], "named, not a generic integrity failure");
  assert.equal(drift.stage, "common-law-half:m", "and attributed to the turn it happened in");
  assert.equal(drift.armed, false, "LOG-ONLY: a would-fault verdict is not a fault that happened");
});

test("#954: a DELETED frozen record is caught too — erasure is not a quiet path", () => {
  const dir = run();
  put(dir, "register-plan.json", "{}");
  const before = frozenSnapshot(dir);
  rmSync(driverDir(dir, "register-plan.json"));
  const drift = describeDrift("register-unit", before, frozenSnapshot(dir));
  assert.equal(drift.verdict, "would-fault");
  assert.deepEqual(drift.deleted, ["register-plan.json"]);
});

// ── property 2: the excluded journals — the false-positive machine this must not become ─────────────

test("#954: appends to run.jsonl / <stage>.jsonl / reading-log.jsonl do NOT fault", () => {
  // These are written by the driver and the band server WHILE a turn is in flight, because stages run
  // concurrently. A check that fires on them fires on every turn and gets switched off in a week.
  const dir = run();
  put(dir, "register-plan.json", "{}");
  put(dir, "run.jsonl", '{"event":"stage"}\n');
  put(dir, "common-law-half:m.jsonl", '{"event":"attempt"}\n');
  put(dir, "reading-log.jsonl", '{"lookup":1}\n');
  const before = frozenSnapshot(dir);

  put(dir, "run.jsonl", '{"event":"stage"}\n{"event":"attempt"}\n');
  put(dir, "common-law-half:m.jsonl", '{"event":"attempt"}\n{"event":"attempt"}\n');
  put(dir, "reading-log.jsonl", '{"lookup":1}\n{"lookup":2}\n');

  assert.equal(describeDrift("common-law-half:m", before, frozenSnapshot(dir)), null,
    "three journals grew and the check said nothing — that is the requirement, not a leniency");
});

test("#1365: the .jsonl PATTERN is the deciding mechanism, and this arm reds if it is removed", () => {
  // THIS ARM REPLACES ONE THAT COULD NOT FAIL. It read `for (const n of FROZEN_JOURNALS) assert.equal(
  // isFrozenEntry(n), false)` — asserting the LIST's effect while measuring the PATTERN's. Deleting the
  // list changed nothing and the assertion still passed, so the list was free to rot to empty or to
  // nonsense without a red. It had in fact rotted: it held two entries under a docblock claiming three,
  // and both were already excluded one line below.
  //
  // A name in NO list is what makes this arm honest. It can only pass via the pattern.
  assert.equal(isFrozenEntry("register-repair.jsonl"), false,
    "a .jsonl sink named in no list must still be excluded — the pattern is the mechanism, and it is gone");
  assert.equal(isFrozenEntry("engine-turn.jsonl"), false, "likewise, and this one did not exist when the module was written");
  assert.equal(isFrozenEntry("common-law-half:a.jsonl"), false, "per-stage logs are appended mid-turn");
  assert.equal(isFrozenEntry("run.jsonl"), false, "the journal the old list named — still out, via the pattern");
  assert.equal(isFrozenEntry("reading-log.jsonl"), false, "likewise");
  assert.equal(isFrozenEntry("plan-execution.json.tmp"), false, "a half-written temp is not the record");
});

test("#1365: the judged-by material is still IN — the pattern excluded journals, not the record", () => {
  // The other direction, and the one that matters if somebody ever widens the pattern. An integrity
  // check that excludes everything passes every test about what it excludes.
  for (const n of ["register-plan.json", "grid-spec.half-m.json", "band-shape.json",
                   "recall-reconciliation.json", "common-law-half:m.attempt1", "common-law-half:m.attempt1.prev-ab12cd"])
    assert.equal(isFrozenEntry(n), true, n);
});

test("#1365: the doc no longer promises the safe direction while shipping the unsafe one", () => {
  // The defect was half prose. The docblock said journals were excluded "BY NAME rather than by pattern,
  // so a new .jsonl sink is included by default and has to be excluded deliberately" — the reverse of
  // what shipped, on the module that is the tamper check for the whole of _driver/. A reader who
  // believed it would have thought a new sink was watched.
  const src = readFileSync(join(ROOT, "driver", "run-integrity.mjs"), "utf8");
  assert.doesNotMatch(src, /BY NAME rather than by pattern/,
    "the false promise is back in the doc of the module that ships its opposite");
  assert.doesNotMatch(src, /FROZEN_JOURNALS/,
    "the dead constant is back — every entry in it was already excluded by the line below it");
  assert.match(src, /appended|APPENDED/, "the doc must still say WHY journals are out, or the pattern looks arbitrary");
});

test("#1365: the blind spot's SCALE is measured, so it cannot grow unnoticed as a number nobody has", (ctx) => {
  // Option 1 of the issue was taken: the pattern is right, the doc was stale, and new journals are
  // unwatched BY DEFAULT. That is a defensible design and it is now written down — but "unwatched by
  // default" with no number attached is how a two-file exception becomes a twenty-file one.
  //
  // A FLOOR, NOT AN EQUALITY. A hard count would red on every new sink, which is the ratchet option 2
  // wanted and option 1 explicitly did not choose. What a floor buys is that this stops being evidence
  // the moment the enumeration breaks: finding nothing must red, not pass. 's drift guard was
  // silently narrowed from 13 names to 9 while still passing, for exactly the want of this.
  // THROUGH shared/tracked-files.mjs, NEVER git directly. test-tiers.test.mjs guards that in as many
  // words — "no test enumerates the tracked corpus behind the helper's back" — and the reason is:
  // off a checkout this has to be a STATED skip, not a wall of "fatal: not a git repository". `null` IS
  // that skip, and the helper prints a marker the merge gate greps for, so returning here is refused
  // loudly rather than passing quietly.
  const listed = trackedFiles(JOURNAL_GUARD,
    { root: ROOT, pathspec: ["driver/*.mjs", "driver/**/*.mjs"] });
  // — a bare return here is a PASS to node:test, so the arm reported a measured scale having
  // measured nothing. The marker on stderr is for CI; this is for whoever is watching the run.
  if (listed === null) return ctx.skip(skipReason(JOURNAL_GUARD));
  const files = listed.filter((f) => !f.includes("/test/") && !f.endsWith(".test.mjs"));
  const sinks = new Set();
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const m of src.matchAll(/["'`]([a-z0-9][a-z0-9.:-]*\.jsonl)["'`]/g)) sinks.add(m[1]);
  }
  assert.ok(sinks.size >= 10,
    `only ${sinks.size} .jsonl sink names found in driver/ — the enumeration broke, and an empty result here ` +
    "would otherwise read as 'the blind spot is small'");
  // Every one of them is outside the tamper check. That is the finding, asserted rather than described.
  for (const n of sinks) assert.equal(isFrozenEntry(n), false, `${n} is a journal and must be outside the frozen set`);
  // NOT A TOTAL, and saying so is the point: driver/attributed-span.mjs writes `${name}.jsonl` from a
  // caller-supplied name, so the real population is this set plus whatever a caller passes. A source-text
  // enumeration can only ever be a floor over a dynamic writer.
  assert.match(readFileSync(join(ROOT, "driver", "attributed-span.mjs"), "utf8"), /\$\{name\}\.jsonl/,
    "the dynamic sink this floor cannot see has moved — re-derive whether the enumeration is still a floor");
});

// ── property 3: the quiet turn stays quiet ──────────────────────────────────────────────────────────

test("#954: a turn that touches nothing produces NO ROW", () => {
  const dir = run();
  put(dir, "register-plan.json", "{}");
  const before = frozenSnapshot(dir);
  assert.equal(describeDrift("synthesis", before, frozenSnapshot(dir)), null,
    "a row per turn saying nothing happened would bury the rows that matter");
});

test("#954: a concurrent stage's NEW dispatch record is reported but reads QUIET, not would-fault", () => {
  // Three common-law halves run at once; each writes its own dispatch record before its turn, which lands
  // inside a sibling's window. Additions are counted rather than filtered — a seat forging a new _driver/
  // file lands here too — but they do not read as a fault, and which of the two this field actually
  // carries is one of the things the log-only run exists to measure.
  const dir = run();
  put(dir, "register-plan.json", "{}");
  const before = frozenSnapshot(dir);
  put(dir, "common-law-half:b.attempt1", "a sibling's dispatch");
  const drift = describeDrift("common-law-half:a", before, frozenSnapshot(dir));
  assert.ok(drift, "it is recorded…");
  assert.equal(drift.verdict, "quiet", "…and it is not a fault");
  assert.equal(drift.addedCount, 1);
  assert.deepEqual(drift.changed, []);
});

// ── the check must never be able to fail a run by failing itself ────────────────────────────────────

test("#954: a missing run dir, a missing _driver, and a null runDir all degrade silently", () => {
  assert.equal(frozenSnapshot(null).size, 0);
  assert.equal(frozenSnapshot("/nonexistent/path/nowhere").size, 0);
  const dir = mkdtempSync(join(tmpdir(), "run-integrity-bare-"));
  dirs.push(dir);
  assert.equal(frozenSnapshot(dir).size, 0, "no _driver yet — the first turn of a run");
  assert.equal(describeDrift("intake", frozenSnapshot(dir), frozenSnapshot(dir)), null);
});

test("#954: frozenDiff is pure and accepts plain objects as well as Maps", () => {
  const d = frozenDiff({ a: "1", b: "2", c: "3" }, { a: "1", b: "CHANGED", d: "4" });
  assert.deepEqual(d, { changed: ["b"], deleted: ["c"], added: ["d"] });
});


// ── — THE MEASURED RUN: 25 WOULD-FAULTS ON A CLEARANCE THAT DELIVERED CLEANLY ─────────────────
//
// On the 2026-08-18 delivered run — 9/9 steps, 73/73 ruled, report published — this check would have
// faulted twenty-five times. Every fault was `armed: false`, so it cost nothing; armed, it kills clean
// deliveries. The two shapes below are that run's, reconstructed from the issue's own description of
// it rather than from the VM's artifact set, which this lane cannot reach. Anything the reconstruction
// gets wrong is a fact about the shapes, not about the classification, and the classification is what
// these assert.

test("#1266 the delivered run's shape produces ZERO faults — the by-design mutators are allowed", () => {
  const dir = run();
  // The frozen set as a stage's turn opens: the witness, the two form sidecars, and a real record.
  put(dir, WITNESS_FILE, '{"reads":["doctrine-a"]}');
  put(dir, "placement-form.form.json", '{"answers":[]}');
  put(dir, "register-coverage-form.form.json", '{"answers":[]}');
  put(dir, "register-findings.json", '{"findings":[]}');
  const before = frozenSnapshot(dir);

  // …and what the driver itself wrote during it: the witness accumulated another doctrine read, and
  // both forms took another answer. All three change IN PLACE, which is the sharp field.
  put(dir, WITNESS_FILE, '{"reads":["doctrine-a","doctrine-b"]}');
  put(dir, "placement-form.form.json", '{"answers":[1]}');
  put(dir, "register-coverage-form.form.json", '{"answers":[1]}');

  const drift = describeDrift("placement-inquiry", before, frozenSnapshot(dir));
  assert.equal(drift.verdict, "quiet", "a clean delivered run still reads as a fault");
  assert.deepEqual(drift.changed, [], "an allowed mutator is still being counted as a violation");
  // NOT SILENTLY DROPPED. The row still carries them, because a guard that hides what it forgave
  // teaches nobody what it is forgiving — and these counts are how the arming decision gets measured.
  assert.equal(drift.byDesignCount, 3);
  assert.deepEqual(drift.byDesign.sort(),
    [WITNESS_FILE, "placement-form.form.json", "register-coverage-form.form.json"].sort());
});

test("#1266 report-card:2's eleven sibling dispatches stop being additions", () => {
  const dir = run();
  put(dir, "register-findings.json", "{}");
  const before = frozenSnapshot(dir);
  // Fourteen siblings, eleven of them dispatched inside this seat's window — the measured shape.
  for (const seat of [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) put(dir, dispatchFileName(`report-card:${seat}`, 1), "msg");
  const drift = describeDrift("report-card:2", before, frozenSnapshot(dir));
  assert.equal(drift.verdict, "quiet");
  assert.equal(drift.siblingAddCount, 11);
  assert.equal(drift.addedCount, 0,
    "sibling dispatches still count as additions — the one field that should notice a forged file is "
    + "then eleven-of-eleven explained noise, and cannot");
});

test("#1266 a genuine violation still faults LOUDLY, and names the file", () => {
  // Acceptance 3's other half. The allowlist must not have widened into "anything that moved is fine".
  const dir = run();
  put(dir, WITNESS_FILE, "{}");
  put(dir, "register-findings.json", '{"findings":[]}');
  const before = frozenSnapshot(dir);
  put(dir, WITNESS_FILE, '{"reads":["x"]}');                       // allowed, alongside…
  put(dir, "register-findings.json", '{"findings":["forged"]}');   // …a record no entry covers
  const drift = describeDrift("report-card:2", before, frozenSnapshot(dir));
  assert.equal(drift.verdict, "would-fault");
  assert.deepEqual(drift.changed, ["register-findings.json"], "the fault must name the file, and only it");
  assert.equal(drift.byDesignCount, 1, "…while the allowed change is still reported beside it");
});

test("#1266 a seat forging a NON-dispatch file during a sibling's turn is still an addition", () => {
  const dir = run();
  put(dir, "register-findings.json", "{}");
  const before = frozenSnapshot(dir);
  put(dir, "report-card:9.forged.json", "{}");                     // same block, NOT a dispatch record
  put(dir, dispatchFileName("report-card:9", 1), "msg");           // same block, IS one
  const drift = describeDrift("report-card:2", before, frozenSnapshot(dir));
  assert.deepEqual(drift.added, ["report-card:9.forged.json"]);
  assert.equal(drift.siblingAddCount, 1);
});

test("#1266 a dispatch record from ANOTHER stage block is not a sibling", () => {
  assert.equal(isSiblingDispatch(dispatchFileName("common-law-half:a", 1), "report-card:2"), false);
  assert.equal(isSiblingDispatch(dispatchFileName("report-card:9", 1), "report-card:2"), true);
  // An unnumbered stage is its own block and still matches its own dispatches.
  assert.equal(isSiblingDispatch(dispatchFileName("synthesis", 2), "synthesis"), true);
  assert.equal(stageBlock("report-card:2"), "report-card");
  assert.equal(stageBlock("synthesis"), "synthesis");
});

test("#1266 a DELETION is never allowlisted — every entry is a file its writer rewrites, not removes", () => {
  const dir = run();
  put(dir, WITNESS_FILE, "{}");
  const before = frozenSnapshot(dir);
  rmSync(driverDir(dir, WITNESS_FILE));
  const drift = describeDrift("placement-inquiry", before, frozenSnapshot(dir));
  assert.equal(drift.verdict, "would-fault", "the witness vanishing mid-turn is not a by-design change");
  assert.deepEqual(drift.deleted, [WITNESS_FILE]);
});

test("#1266 every allowlist entry carries a REASON, and the names come from their writers", () => {
  // Acceptance 1: never a bare path list. A list of allowed paths is indistinguishable from a list of
  // paths somebody got tired of seeing, and the next reader cannot tell which entries are load-bearing.
  assert.ok(BY_DESIGN_MUTATORS.length > 0);
  for (const m of BY_DESIGN_MUTATORS) {
    assert.equal(typeof m.match, "function", `${m.name} has no predicate`);
    assert.ok(typeof m.why === "string" && m.why.length > 80,
      `${m.name} carries no reason worth reading — an entry nobody can evaluate is an entry nobody removes`);
  }
  // The witness's name is imported from the module that WRITES it, so a rename cannot leave this
  // allowlist quietly matching nothing — which would restore the 25 faults in silence.
  assert.ok(BY_DESIGN_MUTATORS.some((m) => m.name === WITNESS_FILE));
  assert.equal(byDesignMutator("run.jsonl"), null, "a journal is excluded by the frozen set, not allowlisted");
});

test("#1266 the check is STILL DISARMED — arming is its own explicit act", () => {
  // Acceptance 4. These three fixes make arming *possible*; they are not arming. The evidence for that
  // decision is a replay against a real delivered run, which is not this lane's to run.
  const dir = run();
  put(dir, "register-findings.json", "{}");
  const before = frozenSnapshot(dir);
  put(dir, "register-findings.json", '{"x":1}');
  assert.equal(describeDrift("synthesis", before, frozenSnapshot(dir)).armed, false,
    "the check armed itself as a side effect of being fixed");
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — CITATION DRIFT IS A RELATION BETWEEN TWO STATES.
//
// `citation-line-check` walks ONE state of the tree and says so in its own CANNOT SEE paragraph: a
// citation that drifted onto a different LIVE line reads as correct to it, because there is nothing
// wrong with the line it now points at. No arm added to a tree-walking guard reaches a relation
// between a before and an after. A DIFF has both states.
//
// ── WHY THESE ARMS ARE SHAPED AS PAIRS ────────────────────────────────────────────────────────────
//
// The first cut of this report printed a clean tick over a range with 57 hunks in a file cited from
// nine places. It passed `exists: () => true` as a convenience stub, and `resolveCited` SHORT-CIRCUITS
// on that: every cited string came back `{state:"exact", path:<the string>}`, so a bare-basename
// citation resolved to a path that is not a file, matched nothing in the changed map, and the walk
// found zero. A stub that makes every lookup succeed is indistinguishable from one that makes every
// lookup fail, except that it looks like a pass.
//
// So every negative here carries its population. "Nothing was reported" is only a result when the
// walk is shown to have HAD something to not report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  hunksOf, whereItWent, changedFileHunks, citationsIntoChanged, driftRows, REMEDY,
} from "../../scripts/citation-drift-report.mjs";
import { indexByBasename } from "../../scripts/citation-line-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// Namespaced `driftcase-` on purpose, and the reason is in citation-line-check's EXEMPT_TARGETS: a
// first cut of the sibling fixture exempted the BARE names it used and swallowed two of that file's own
// controls. An exemption wide enough to cover somebody else's known-bad turns their arm green while it
// proves nothing.
const TARGET = "driver/driftcase-target.mjs";
const CITER = "driver/driftcase-citer.mjs";
const TRACKED = [TARGET, CITER];
const byBase = indexByBasename(TRACKED);
const exists = (p) => TRACKED.includes(p);

/** A corpus of one citing file whose line 3 cites `driftcase-target.mjs:<n>`. */
const corpusCiting = (...lines) => [{ file: CITER, text: `// one\n// two\n${lines.join("\n")}\n` }];

/** A diff for TARGET that inserts `add` lines at old line `at`, deleting `del`. */
const fakeGit = (at, add, del = 0, { mergeBase = "BASE" } = {}) => (args) => {
  if (args[0] === "merge-base") return `${mergeBase}\n`;
  if (args[1] === "--name-only") return `${TARGET}\n`;
  return `--- a/${TARGET}\n+++ b/${TARGET}\n@@ -${at},${del} +${at},${add} @@\n`;
};

/** The hunk map alone, for the arms that do not care which base was resolved. */
const hunksFor = (...a) => changedFileHunks("BASE..HEAD", { git: fakeGit(...a) }).hunks;

test("1950: an insertion ABOVE a citation moves it, and the report says where it went", () => {
  const changed = hunksFor(10, 4);
  assert.equal(changed.size, 1, "the walk must have a changed file to work over");

  const cites = citationsIntoChanged(corpusCiting(`// see ${TARGET}:40 for the fold`), byBase, changed, exists);
  assert.equal(cites.length, 1, "the population — without this the negative below proves nothing");

  const rows = driftRows(cites, changed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "moved");
  assert.equal(rows[0].cited, 40);
  assert.equal(rows[0].to, 44, "four lines added above line 40 puts it at 44");
  assert.equal(rows[0].target, TARGET);
  assert.equal(rows[0].from, CITER);
});

test("1950: an insertion BELOW every citation reports NOTHING — and the walk had citations to not report", () => {
  // THE REAL NEGATIVE. An empty walk produces this same zero, which is exactly how the first cut
  // passed: it is only a result when the population is shown to be non-empty and the classification
  // is what emptied it.
  const changed = hunksFor(200, 30);
  const cites = citationsIntoChanged(
    corpusCiting(`// see ${TARGET}:12`, `// and ${TARGET}:40`, `// and ${TARGET}:199`),
    byBase, changed, exists);
  assert.equal(cites.length, 3, "three citations were FOUND — the walk is not empty");

  const rows = driftRows(cites, changed);
  assert.deepEqual(rows, [], "…and every one of them is above the insertion, so none moved");

  // And the control that this fixture CAN produce a mover: move the same hunk above them.
  const above = hunksFor(5, 9);
  const movers = driftRows(citationsIntoChanged(
    corpusCiting(`// see ${TARGET}:12`, `// and ${TARGET}:40`, `// and ${TARGET}:199`),
    byBase, above, exists), above);
  assert.equal(movers.length, 3, "the same three citations move when the insertion is above them");
});

test("1950: a citation whose target line is INSIDE the change is its own kind, not a mover", () => {
  // A citation whose target was EDITED is a different conversation from one that merely slid, and
  // guessing a new line for it would be inventing an answer the diff cannot give.
  const changed = hunksFor(30, 6, 6);
  const rows = driftRows(
    citationsIntoChanged(corpusCiting(`// see ${TARGET}:33`), byBase, changed, exists), changed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "target-edited");
  assert.equal(rows[0].to, null, "where it went is not knowable from the diff, so it is not stated");
});

test("1950: an always-true `exists` is not a harmless stub — it is how the first cut printed a clean tick", () => {
  // `resolveCited` short-circuits on `exists`, so a stub that says yes to everything returns the raw
  // cited STRING as the path. A bare basename then resolves to something that is not a file, matches
  // nothing in the changed map, and the report finds zero over a range full of movers.
  const changed = hunksFor(5, 7);
  const corpus = corpusCiting("// see driftcase-target.mjs:40 by bare basename");

  const honest = citationsIntoChanged(corpus, byBase, changed, exists);
  assert.equal(honest.length, 1, "the tracked-set predicate resolves the basename to its real path");
  assert.equal(honest[0].target, TARGET);

  const stubbed = citationsIntoChanged(corpus, byBase, changed, () => true);
  assert.equal(stubbed.length, 0,
    "the always-true stub resolves it to the bare string, which is in no changed map — a silent zero");
});

test("1950: the remedy is the SYMBOL and never a new number, and it says why", () => {
  assert.match(REMEDY, /Drop the number and keep the symbol/);
  assert.match(REMEDY, /Do NOT\s+renumber/, "the wrong repair is named, not merely omitted");
  assert.match(REMEDY, /turns it green/, "…and why: a bumped wrong number is a wrong citation made green");
});

test("1950: it REPORTS and does not refuse — a range with movers still exits 0", () => {
  // The load-bearing decision. Most drift makes wrong citations wronger rather than breaking correct
  // ones, and a refusal would stop the queue over a corpus nobody has migrated.
  const run = (args) => {
    try {
      return { code: 0, out: execFileSync(process.execPath,
        [join(ROOT, "scripts/citation-drift-report.mjs"), ...args], { cwd: ROOT, encoding: "utf8" }) };
    } catch (e) { return { code: e.status, out: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
  };
  // NO AMBIENT HISTORY. The first cut drove `HEAD~1..HEAD` and passed locally and RED IN CI: the runner
  // checks out at DEPTH 1, so `HEAD~1` does not exist there. An arm that reads whatever history the
  // checkout happens to have is testing the checkout. `HEAD..HEAD` resolves in any clone, shallow
  // included, and still exercises the whole path — the walk runs, finds no changed file, and reports.
  const r = run(["--range", "HEAD..HEAD"]);
  assert.equal(r.code, 0, `a report must never gate:\n${r.out}`);
  assert.match(r.out, /citation-drift-report/);
  assert.match(r.out, /modified file\(s\)/, "…and it REPORTED rather than merely exiting quietly");

  // AN UNREADABLE RANGE IS THE ONE CASE THAT MUST NOT EXIT 0, and it is what CI caught. A range naming
  // a ref that does not exist used to die with an uncaught `Command failed` and a Node stack trace —
  // a report saying it could not look, in the one form nobody can act on. The ref is invented so this
  // is unresolvable in every checkout, deep or shallow, rather than only in the one CI happens to make.
  const unreadable = run(["--range", "no-such-ref-1950..HEAD"]);
  assert.equal(unreadable.code, 2, `an unreadable range is could-not-look, never a clean report:\n${unreadable.out}`);
  assert.match(unreadable.out, /cannot read no-such-ref-1950\.\.HEAD/, "and it names the range it could not read");
  assert.doesNotMatch(unreadable.out, /at genericNodeError|node:internal/, "by name, not as a stack trace");

  // An unknown flag is still could-not-look, the same rule the sibling guards use: a flag this build
  // does not know is a check that did not happen.
  const bad = run(["--nope"]);
  assert.equal(bad.code, 2, `an unrecognised flag must refuse rather than fall through:\n${bad.out}`);
  assert.match(bad.out, /unrecognised flag/);
});

test("1950: hunk parsing reads the single-line form, where the count is omitted rather than 1", () => {
  // `@@ -12 +12,3 @@` means one old line, not zero. Reading the absent count as 0 makes every
  // single-line hunk look like a pure insertion and shifts every citation below it by one.
  const [h] = hunksOf("@@ -12 +12,3 @@ some context\n");
  assert.deepEqual(h, { oldStart: 12, oldLines: 1, newStart: 12, newLines: 3 });
  assert.deepEqual(whereItWent([h], 20), { moved: true, to: 22 });
  assert.deepEqual(whereItWent([h], 5), { moved: false });
  assert.deepEqual(whereItWent([h], 12), { inside: true });
});

test("1950: the base is the MERGE BASE, so a stale branch is not shown main's work as its own", () => {
  // MEASURED, and it is why this arm exists. `git diff A..B` is an ENDPOINT comparison: run on a branch
  // four commits behind main, the first cut listed 24 modified files and 49 affected citations where
  // the branch itself touched four. Every extra row was main's work presented as the author's, with a
  // remedy attached, aimed at citations nobody in that lane had gone near.
  const calls = [];
  const git = (args) => { calls.push(args.join(" ")); return fakeGit(10, 4, 0, { mergeBase: "MB999" })(args); };

  const both = ["BASE..HEAD", "BASE...HEAD"].map((r) => changedFileHunks(r, { git }));
  for (const r of both) assert.equal(r.base, "MB999", "the resolved base is the merge base, not the endpoint");
  assert.ok(calls.some((c) => c.startsWith("merge-base ")), "…and it was ASKED for, not assumed");
  assert.ok(calls.every((c) => !/BASE\.\.\.HEAD/.test(c)),
    "the three-dot spelling must never reach git — it would make the answer depend on the caller's dots");
  assert.ok(calls.some((c) => c.includes("MB999..HEAD")), "the diff is taken from the resolved base");

  // Both spellings must give the SAME answer. A report whose verdict depends on which dots were typed
  // is a report nobody can quote.
  assert.deepEqual([...both[0].hunks.keys()], [...both[1].hunks.keys()]);
});

test("1950: unrelated histories leave the endpoint as the base rather than crashing the report", () => {
  // `git merge-base` exits non-zero when there is nothing in common. A report is not a gate and must
  // still produce its answer; the endpoint is the only base there is.
  const git = (args) => {
    if (args[0] === "merge-base") throw new Error("fatal: refusing to merge unrelated histories");
    return fakeGit(10, 4)(args);
  };
  const r = changedFileHunks("BASE..HEAD", { git });
  assert.equal(r.base, "BASE");
  assert.equal(r.hunks.size, 1, "and it still reports");
});

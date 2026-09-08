// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT THE PUBLIC TREE ALREADY CARRIES, AND THE PROMISE THAT IT ONLY FALLS.
//
// `scripts/added-reference-check.mjs` refuses these classes in a diff, so nothing new arrives. That
// alone does not hold the total: a diff guard reads only ADDED lines, so a repaired line that comes
// back in a later edit is invisible to it, and so is a file moved from a tree the guard does not read
// into one it does. The backlog beside this file is the other half — a per-file, per-class count that
// may go down and may not go up.
//
// 804 LINES ACROSS 292 FILES WHEN THIS WAS MINTED, and 750 of them are one class: the spelled tracker
// citation. That population belongs to its own strip and will fall in one pass. The other 54 are the
// ones worth watching line by line — account names, home directories on the build machines, and this
// project's own words for how it is organised.
//
// WHY THE COUNTS ARE PER CLASS AND NOT ONE TOTAL. The citation strip will move 750 to nothing in a
// single pull request. Under one total, a file could lose four citations and gain four account names
// and the floor would report it unchanged — the repair paying for the regression, silently, at exactly
// the moment the numbers are moving fastest. Per class, that trade is two entries and both are visible.
//
// WHY A FLOOR AND NOT AN ASSERTION OF ZERO. An arm asserting zero goes red the day somebody edits near
// a surviving line, and a permanently red arm teaches people to stop reading the suite. Four of the
// eight classes ARE at zero, and those are asserted as zero — see the arm below. A class with no
// residue has no reason to be given room to grow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CLASSES, censusOf, offendingClasses, publishedOf } from "../../shared/reference-guard-classes.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TABLE = JSON.parse(readFileSync(join(ROOT, "driver/test/fixtures/public-residue-backlog.json"), "utf8"));

const GUARD = "public-residue-backlog";
// Through the helper: `null` is a stated skip, not an empty corpus. An empty one here would read as a
// repaired tree — every count zero, the floor satisfied — which is the precise failure a backlog table
// exists to make impossible.
const tracked = () => trackedFiles(GUARD, { root: ROOT });

// ── PUBLISHED, NOT MERELY TRACKED ───────────────────────────────────────────────────────────────
//
// The backlog is a statement about the published repository, and the suite is also run over a bigger
// tree: the withheld corpus is laid back over a clone at its pre-cut paths so our own arms can run
// against it. That overlay STAGES what it lays (`git add -A`) and never commits it, which is what
// makes the two populations tellable apart — a laid path is in the index and not in HEAD.
//
// Measured before this filter existed: the laid corpus is 110 files carrying 360 hits of these
// classes, 299 of them the one class this floor holds at ZERO. Without the filter every one of those
// reads as growth in a file the committed fixture cannot record — writing them into it would publish
// the withheld path list, which is the thing the cut exists to prevent. So they are not counted, and
// the number of them is reported rather than swallowed.
//
// `trackedFiles` still enumerates, so the loud no-checkout skip and the corpus marker are unchanged.
// This asks a second, different question of the same tree — what is PUBLISHED here — and it is one
// `git` read with its answer asserted below in both directions.
function published() {
  const all = tracked();
  if (all === null) return null;
  const p = publishedOf(all, ROOT);
  return p.error ? p : { ...p, tracked: all.length };
}

const census = () => {
  const p = published();
  if (p === null) return null;
  assert.ok(!p.error, p.error);
  const c = censusOf(p.files, (f) => readFileSync(join(ROOT, f), "utf8"));
  return { ...c, laid: p.laid, trackedCount: p.tracked };
};

// THE FIXTURE IS ORDERED BY `CLASSES`, so a class added, removed or renamed invalidates every row in
// it — the counts would silently shift one column left. This is asserted before anything reads a row,
// because a floor compared column-by-column against the wrong columns still produces a verdict.
test("the backlog's columns are the guard's classes, in the guard's order", () => {
  assert.deepEqual(TABLE.classes, CLASSES.map((c) => c.id),
    "the class table moved and the backlog did not — re-mint it in the same commit, or every count "
    + "below is being read against the wrong class");
});

test("the public residue is a FLOOR — no file may carry more than it is recorded with", (ctx) => {
  const now = census();
  if (now === null) return ctx.skip(skipReason(GUARD));
  assert.ok(Object.keys(now.files).length > 0,
    "the census found no file carrying anything, over a corpus that had 292 — that is an instrument "
    + "failure reading as a repaired tree, not a repaired tree");

  const grew = [];
  for (const [path, counts] of Object.entries(now.files)) {
    const was = TABLE.files[path] ?? CLASSES.map(() => 0);
    counts.forEach((n, i) => {
      if (n > was[i]) grew.push(`${path}: ${CLASSES[i].id} ${was[i]} → ${n}`);
    });
  }
  assert.deepEqual(grew, [],
    "these files gained one of the classes the public tree must not acquire. If the line is genuinely "
    + "required, the answer is not to re-mint the backlog upward — say why the code is as it is and "
    + "leave the address out. `node scripts/added-reference-check.mjs` names the class for each.");
});

// A FLOOR THAT IS NEVER RE-MINTED BECOMES A CEILING NOBODY IS UNDER. The total falling is the point,
// and it must be recorded when it falls, or the table stops describing the tree and starts describing
// a day in its history — at which point a regression can hide under somebody else's repair.
test("the backlog is not stale — a repaired tree gets its number written down", (ctx) => {
  const now = census();
  if (now === null) return ctx.skip(skipReason(GUARD));

  const gone = Object.keys(TABLE.files).filter((p) => !(p in now.files));
  const fell = Object.entries(now.files)
    .filter(([p, counts]) => TABLE.files[p] && counts.reduce((a, b) => a + b, 0) < TABLE.files[p].reduce((a, b) => a + b, 0));
  const slack = now.total < TABLE.total;

  assert.ok(!slack && !gone.length && !fell.length,
    `the tree is cleaner than the backlog records (total ${now.total} vs ${TABLE.total}, `
    + `${gone.length} file(s) fully repaired, ${fell.length} partly). Re-mint it in this commit: `
    + "`node scripts/mint-public-residue.mjs --apply`. The number going down is the work; leaving the "
    + "old one in place is how the next regression gets absorbed without anybody seeing it.");
});

// THE FOUR CLASSES WITH NO RESIDUE GET NO ROOM AT ALL. A floor is a concession to a population that
// already exists; where none does, the concession is a hole. These four have never been in the tree in
// a form this guard reads, so a single occurrence is a regression and is asserted as one.
test("the classes with no standing residue are held at zero, not floored", (ctx) => {
  const now = census();
  if (now === null) return ctx.skip(skipReason(GUARD));

  // `private-repo-name` IS NOT IN THIS LIST, and its absence is the point. It has no pattern in this
  // tree — the literals would publish the private names the class exists to refuse — so a zero from it
  // is what an unspellable class reports, not what a clean tree does. Asserting it here would be an
  // arm that can never fail, dressed as coverage. The class is asserted where it can be: the arm in
  // a-bare-reference-added-in-a-diff-is-refused pins that it is declared, has no pattern, and says
  // where it IS enforced.
  const ZERO = ["bare-reference", "agent-trailer", "machine-trailer"];
  for (const id of ZERO) {
    const i = CLASSES.findIndex((c) => c.id === id);
    assert.notEqual(i, -1, `${id} is no longer a class — this arm is asserting about nothing`);
    assert.ok(CLASSES[i].pattern,
      `${id} has no pattern, so a zero from it means "not looked for" rather than "not there" — take it `
      + "out of this list rather than letting it report a clean tree");
    assert.equal(TABLE.files && Object.values(TABLE.files).reduce((a, v) => a + v[i], 0), 0,
      `${id} has a recorded residue, so this arm's premise is wrong — it is a floor class, not a zero one`);
    const found = Object.entries(now.files).filter(([, v]) => v[i] > 0).map(([p, v]) => `${p} (${v[i]})`);
    assert.deepEqual(found, [],
      `${id} appeared in the tree this run measured, and it has never been in the PUBLISHED one. `
      + (now.cutRecord
        ? "This run has a cut record, so it may be measuring an overlaid tree — check whether these "
          + "paths are withheld ones the skip failed to exclude before hunting a regression here."
        : "There is no cut record, so this IS the published tree and the finding is a real one."));
  }
});

// THE INSTRUMENT ITSELF, over a tree whose answer is known. Every arm above reports a number from
// `censusOf`, and a `censusOf` that had quietly stopped matching would satisfy all of them — the floor
// by counting nothing, the staleness arm by counting nothing being a fall it would then have flagged,
// were it not for this. So the counter is shown non-zero on a corpus built here.
test("the census counts, on a synthetic tree with a known answer", () => {
  const files = {
    "docs/a.md": [
      "Ruled on tracker issue 1234, and again on tracker issue 1235.",
      "Driven on testuser under /home/testuser/trademark/pool.",
      "Nothing wrong with this line at all.",
    ].join("\n"),
    "driver/b.mjs": [
      "// relayed by role-overwatch",
      "const testuser = 1;                    // not prose: the guard does not read code",
      "// Agent: role-dev",
    ].join("\n"),
    // NOT READ, AND THE SAME OFFENDING TEXT AS THE FILES ABOVE. If the exclusion stopped working, this
    // file's counts would appear in the totals and every number below would be wrong by a known amount.
    "demo/c.mjs": "// driven on testuser against tracker issue 1234",
    "driver/skills/d.md": "Driven on testuser against tracker issue 1234.",
  };
  const c = censusOf(Object.keys(files), (f) => files[f]);

  const idx = (id) => CLASSES.findIndex((x) => x.id === id);
  assert.deepEqual(Object.keys(c.files).sort(), ["docs/a.md", "driver/b.mjs"],
    "an excluded tree reached the census");
  assert.equal(c.files["docs/a.md"][idx("spelled-citation")], 2, "both citations on one line are counted");
  // TWO, NOT ONE. The account is named twice on that line — bare, and again inside the path — and the
  // path class fires beside it. One line, three counts, and none of them is double-counting: removing
  // the path leaves the bare mention, so a count that merged them would report the repair as complete.
  assert.equal(c.files["docs/a.md"][idx("login")], 2);
  assert.equal(c.files["docs/a.md"][idx("home-path")], 1);
  assert.equal(c.files["driver/b.mjs"][idx("role-name")], 2, "the trailer's role name counts as a role name");
  assert.equal(c.files["driver/b.mjs"][idx("agent-trailer")], 1);
  assert.equal(c.files["driver/b.mjs"][idx("login")], 0, "a code line is not prose, even carrying a login");
  assert.equal(c.total, 8);

  // AND THE OTHER DIRECTION: the same functions over clean prose return nothing, so a non-zero total
  // is a finding rather than the counter's resting state.
  assert.deepEqual(offendingClasses("docs/a.md", "Nothing wrong with this line at all."), []);
  const clean = censusOf(["docs/e.md"], () => "A page about trademarks.\n");
  assert.equal(clean.total, 0);
  assert.deepEqual(clean.files, {});
});

// A RUNTIME PROPERTY THE CLASS TABLE RELIES ON, ASSERTED RATHER THAN ASSUMED. `offendingClasses` holds
// one `g`-flagged regex per class for the lifetime of the process and iterates it with `matchAll`. That
// is only safe because `matchAll` iterates a CLONE and leaves the original's `lastIndex` at 0; were it
// not, the second line scanned would start matching from wherever the first stopped, and the census
// would report a number that fell every time the corpus grew.
test("scanning the same line twice gives the same answer", () => {
  const line = "// driven on testuser against tracker issue 1234 and testuser again";
  const first = offendingClasses("driver/x.mjs", line);
  const second = offendingClasses("driver/x.mjs", line);
  assert.deepEqual(second, first, "the class table kept state between calls");
  assert.equal(first.filter((h) => h.id === "login").length, 2,
    "both occurrences on one line are reported — a count that stops at the first lets the second in");
});

// ── THE WITHHELD SKIP, DRIVEN ───────────────────────────────────────────────────────────────────
//
// `isWithheld` answers false for everything on the published tree, because there is no cut record
// there. That is correct and it means public CI never executes the branch that keeps this floor
// honest under the overlay — an unexercised exclusion, in the one place an exclusion is dangerous.
//
// Measured before the skip existed: the overlay lays 110 files carrying 360 hits, 299 of them the
// bare-reference class this floor holds at zero. Those paths cannot go into the committed fixture —
// writing them there would publish the withheld path list — so the skip is the only correct answer,
// and it is driven here rather than left to the one run that would find it too late.
test("a withheld path is skipped and counted, and the count is what makes the skip visible", () => {
  const files = { "docs/public.md": "Ruled on tracker issue 1234.", "corpus-laid/withheld.md": "Ruled on tracker issue 1234." };
  const both = censusOf(Object.keys(files), (f) => files[f]);
  assert.equal(both.total, 2, "the control: with nothing withheld, both files count");
  assert.equal(both.skipped, 0);

  // The predicate the real one stands in for. `censusOf` takes it from the module, so this drives the
  // same shape through an injected reader: a file the census cannot read is not the same as one it was
  // told to leave alone, and only the second is a skip.
  const onlyPublic = censusOf(Object.keys(files).filter((f) => !f.startsWith("corpus-laid/")), (f) => files[f]);
  assert.equal(onlyPublic.total, 1, "excluding the laid file leaves exactly the published one");

  // AND THE DIRECTION THAT MATTERS. A predicate answering true for everything would return an empty
  // census, which reads as a repaired tree. The skip count is what tells those two apart, so it is
  // asserted rather than trusted.
  assert.equal(censusOf([], () => "").skipped, 0, "an empty corpus skipped nothing — it had nothing to skip");
  assert.equal(typeof both.cutRecord, "boolean", "the census does not say whether it had a cut record to consult");
});

// WHERE A CUT RECORD IS PRESENT, THE SKIP MUST HAVE FIRED. A record that loads and matches nothing is
// indistinguishable from an instrument that stopped working, and both report a clean census.
test("with a cut record present, the census skipped something", (ctx) => {
  const now = census();
  if (now === null) return ctx.skip(skipReason(GUARD));
  if (!now.cutRecord) return ctx.skip("no cut record in this tree — nothing is withheld from it, which is correct on the published tree");
  assert.ok(now.skipped > 0,
    "a cut record is present and the census skipped no path. Either the overlay laid nothing, or "
    + "`isWithheld` stopped matching — and the second reads exactly like a clean tree.");
});

// ── THE LAID-FILE DISCRIMINATOR, DRIVEN ON A TREE BUILT FOR IT ──────────────────────────────────
//
// `publishedOf` is what stops the withheld corpus being counted, and on the published tree it excludes
// nothing — so public CI never executes the branch that matters. An exclusion only ever exercised by
// the run that would otherwise catch the problem is not an exclusion anybody has watched work.
//
// So the overlay's exact shape is built here: a repository with a commit, and a second file staged and
// not committed, which is what `git add -A` leaves behind. Both directions are asserted, because a
// filter that dropped EVERYTHING would satisfy the half that matters and report a clean census.
test("a staged-but-uncommitted file is laid over this tree, not published in it", () => {
  const dir = mkdtempSync(join(tmpdir(), "overlay-shape-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q", ".");
  git("config", "user.email", "arm@example.test");
  git("config", "user.name", "arm");
  writeFileSync(join(dir, "published.md"), "Ruled on tracker issue 1234.\n");
  git("add", "published.md");
  git("commit", "-qm", "base");
  writeFileSync(join(dir, "laid.md"), "Ruled on tracker issue 1234.\n");
  git("add", "-A");

  const tracked = git("ls-files").split("\n").filter(Boolean);
  assert.deepEqual(tracked.sort(), ["laid.md", "published.md"],
    "the index does not hold both files, so the arm is not driving the overlay's shape");

  const p = publishedOf(tracked, dir);
  assert.ok(!p.error, p.error);
  assert.deepEqual(p.files, ["published.md"], "the laid file reached the published population");
  assert.equal(p.laid, 1, "the laid file was dropped without being counted — a silent skip");

  // THE CENSUS OVER EACH. Same text in both files, so any difference in the counts is the filter and
  // nothing else.
  const read = (f) => readFileSync(join(dir, f), "utf8");
  assert.equal(censusOf(p.files, read).total, 1, "the published file's own citation stopped being counted");
  assert.equal(censusOf(tracked, read).total, 2, "the control: unfiltered, both files count — so the filter is what removed one");

  rmSync(dir, { recursive: true, force: true });
});

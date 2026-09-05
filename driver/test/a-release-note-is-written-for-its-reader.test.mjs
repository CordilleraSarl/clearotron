// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RELEASE NOTES ARE WRITTEN FOR THE PERSON WHO READS THEM — tracker issue 97.
//
// The owner read the first pre-release's notes and rejected them: they named internal things and
// addressed an undefined "you". The reader is somebody who installs and runs Clearotron — a trademark
// lawyer, or the IT person helping them — who has never opened this repository. His contract lives in
// `.changeset/README.md`; this file is what keeps the mechanism honest.
//
// WHAT THESE ARMS ARE FOR, and it is not "the lint has rules". Each one drives a note the lint must
// refuse and a note it must not, because a guard that refuses everything is as useless as one that
// refuses nothing, and the second kind is the one that survives review.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findings, notePaths, workspaceNames, packagesIn, bodyOf, sentencesIn,
  GROUPS, MAX_WORDS, INTERNAL_WORDS, EMPTY_PHRASES, sourceDirectories,
} from "../../scripts/release-notes-lint.mjs";
import { group, writeRootChangelog, GROUPS as CHANGELOG_GROUPS } from "../../scripts/release-version.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const note = (body, fm = '"prelim-driver": patch') => `---\n${fm}\n---\n\n${body}\n`;
const offences = (body, fm) => findings(note(body, fm)).map((f) => f.offending);

test("tracker 97 every release note in the tree is written for a reader who has never opened this repository", () => {
  // THE POPULATION, not a sample. An arm that checked one note would pass over six bad ones.
  const paths = nonEmpty(notePaths(ROOT), "the release notes under .changeset/");
  const bad = [];
  for (const p of paths) {
    for (const f of findings(readFileSync(p, "utf8"), { file: p })) bad.push(`${p}:${f.line}  ${f.rule}`);
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});

test("tracker 97 the lint refuses each thing the contract bans, and passes a note that obeys it", () => {
  // THE CONTROL FIRST. If the good note were refused, every arm below would pass for the wrong reason.
  assert.deepEqual(offences("Fixed: The demo now offers only the two example accounts it ships with."), []);

  // Issue and pull-request numbers: the reader has no tracker to look one up in.
  assert.deepEqual(offences("Fixed: The demo works again, see #1044."), ["#1044"]);
  assert.deepEqual(offences("Fixed: The demo works again — tracker issue 97."), ["tracker issue", "tracker"]);

  // Module names and paths into OUR tree. A path of the READER's is allowed — owner ruling.
  assert.deepEqual(offences("Fixed: release-version.mjs writes it now."), ["release-version.mjs"]);
  assert.deepEqual(offences("Fixed: The walk in driver/engine now covers everything."), ["driver/engine"]);
  assert.deepEqual(offences("Fixed: Settings now live in `~/.config/clearotron/` and survive an upgrade."), []);
  assert.deepEqual(offences("New: See https://github.com/CordilleraSarl/clearotron for the source."), []);

  // A flag the user documentation never shows.
  assert.deepEqual(offences("Fixed: Pass --pack-destination to move it."), ["--pack-destination"]);

  // Port numbers are our deployment's business.
  assert.deepEqual(offences("For operators: The portal now answers on port 18802."), ["port 18802"]);

  // Our vocabulary, every word of it, one note each so a missing word cannot hide behind a present one.
  for (const w of nonEmpty(INTERNAL_WORDS, "the internal vocabulary")) {
    const found = offences(`Fixed: The ${w} now does the right thing for everybody.`);
    assert.ok(found.length, `\`${w}\` is in the banned list and the lint let it through`);
  }
  // …except `provenance`, which the contract allows when the sentence glosses it.
  assert.ok(offences("New: Each release carries provenance.").length);
  assert.deepEqual(offences("New: Each release carries provenance — a signed record of the build."), []);

  // The phrases that stand in for saying what happens.
  for (const p of nonEmpty(EMPTY_PHRASES, "the empty phrases")) {
    assert.ok(offences(`Fixed: The demo ${p} lists its accounts.`).length, `"${p}" was let through`);
  }
});

test("tracker 97 a sentence a reader cannot hold in their head is refused, and the limit is a count not a feeling", () => {
  const words = (n) => "word ".repeat(n).trim();
  assert.deepEqual(offences(`Fixed: ${words(MAX_WORDS - 1)}.`), []);
  assert.ok(findings(note(`Fixed: ${words(MAX_WORDS + 5)}.`)).some((f) => /at most 25 words/.test(f.rule)));
  // TWO short sentences are not one long one — the contract allows a second sentence, and an arm that
  // measured the paragraph would refuse correct prose.
  assert.deepEqual(offences(`Fixed: ${words(20)}. ${words(20)}.`), []);
  // A full stop inside code is not a sentence boundary, or `clearotron doctor` splits a sentence in two
  // and a 30-word note reads as two 15-word ones.
  assert.equal(sentencesIn("Run `a.b.c` and then stop. Then go.").length, 2);
});

test("tracker 97 a note names a package that exists, decided when it is written rather than on main", () => {
  // MEASURED 2026-09-05: ten notes named the ROOT package. `changeset version` refuses that — the root is
  // not one of the workspaces — and it refuses it on MAIN, after the merge, in the release job.
  const workspaces = nonEmpty(workspaceNames(ROOT), "the workspace packages");
  assert.ok(!workspaces.has("clearotron"),
    "the root package is a workspace now, so this arm is asserting something that stopped being true");

  assert.deepEqual(offences("Fixed: It works.", '"clearotron": patch'), ["clearotron"]);
  assert.deepEqual(offences("Fixed: It works.", '"no-such-package": patch'), ["no-such-package"]);
  // Every real workspace passes, so the check cannot be satisfied by refusing everything.
  for (const name of workspaces) assert.deepEqual(offences("Fixed: It works.", `"${name}": patch`), []);
  // One good and one bad names only the bad one.
  assert.deepEqual(offences("Fixed: It works.", '"portal-ui": patch\n"clearotron": patch'), ["clearotron"]);
  // And a note with no frontmatter at all is a refusal, not an empty pass.
  assert.ok(findings("Fixed: It works.\n").some((f) => /names no package/.test(f.rule)));
  assert.deepEqual(packagesIn(note("x", '"portal-ui": minor')), ["portal-ui"]);
});

test("tracker 97 the page groups the notes, and a note that names no group is refused rather than filed wrongly", () => {
  assert.deepEqual(GROUPS, CHANGELOG_GROUPS, "the lint and the changelog disagree about what the groups are");
  assert.deepEqual(GROUPS, ["New", "Fixed", "For operators"], "user-facing groups come first, per the contract");

  for (const g of GROUPS) assert.deepEqual(offences(`${g}: The demo lists its accounts.`), []);
  assert.ok(findings(note("The demo lists its accounts.")).some((f) => /opens with its group/.test(f.rule)));
  assert.ok(findings(note("Improved: The demo lists its accounts.")).some((f) => /opens with its group/.test(f.rule)));

  // THE GENERATOR READS IT OFF AND DROPS EMPTY GROUPS. A heading with nothing under it tells a reader
  // something is missing, which is a worse lie than not printing the group.
  const g = group(["New: A.", "Fixed: B.", "Fixed: C."]);
  assert.deepEqual(g.ungrouped, []);
  assert.deepEqual(g.groups, { New: ["A."], Fixed: ["B.", "C."], "For operators": [] });
  const rendered = renderTo(g, "9.9.9");
  assert.match(rendered, /### New\n\n- A\./);
  assert.match(rendered, /### Fixed\n\n- B\.\n- C\./);
  assert.ok(!rendered.includes("For operators"), "an empty group was printed as a heading with nothing under it");
  // Order on the page is the contract's, not the order the notes happened to arrive in.
  assert.ok(rendered.indexOf("### New") < rendered.indexOf("### Fixed"));

  // AND AN UNGROUPED BULLET IS SURFACED, never defaulted into a group.
  assert.deepEqual(group(["A stray line."]).ungrouped, ["A stray line."]);
});

/** The changelog the generator would write for one grouped set, rendered in a directory of its own. */
function renderTo(grouped, version) {
  const dir = mkdtempSync(join(tmpdir(), "release-notes-"));
  try { return readFileSync(writeRootChangelog({ version, ...grouped }, dir), "utf8"); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test("tracker 97 the standard is in the repository, and it runs where a note is written", () => {
  // THE CONTRACT ITSELF. A rule that lives in a chat message is a rule the next contributor never sees.
  const readme = read(".changeset/README.md");
  for (const [what, needle] of [
    ["who reads a note", "trademark lawyer"],
    ["the one rule", "what is different for that reader after upgrading"],
    ["the word limit", "at most 25 words"],
    ["the groups", "**New** · **Fixed** · **For operators**"],
    ["the banned list", "Banned in a note"],
    ["the before/after examples", "Before → after"],
  ]) {
    assert.ok(readme.includes(needle), `.changeset/README.md no longer carries ${what}`);
  }
  // All three examples, not one: they are the part a contributor actually copies.
  // Counted as PAIRS, since the value is in the contrast: a rejected sentence beside its replacement.
  assert.equal((readme.match(/✓ /g) ?? []).length, 3, ".changeset/README.md lost one of the three examples");
  assert.equal((readme.match(/✗ /g) ?? []).length, 3, ".changeset/README.md lost one of the rejected sentences");
  // And it tells the contributor the one thing the contract does not: the group prefix.
  assert.match(readme, /`New:`, `Fixed:` or `For operators:`/);

  // IT RUNS ON BOTH SURFACES, and the release one runs BEFORE the version step — after it the notes are
  // gone into the changelog and taking one out means rewriting a published release.
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /run: node scripts\/release-notes-lint\.mjs/, "the lint no longer runs on a pull request");
  const rel = read(".github/workflows/release.yml").split("\n").filter((l) => !/^\s*#/.test(l));
  const lint = rel.findIndex((l) => /release-notes-lint\.mjs/.test(l));
  const version = rel.findIndex((l) => /uses: changesets\/action@/.test(l));
  assert.ok(lint > -1 && version > -1, "the release workflow lost the lint or the version step");
  assert.ok(lint < version, "the lint runs AFTER the version step, by which time the notes are consumed");

  // And the pull-request template asks for it, because the checkbox is what a person reads.
  assert.match(read(".github/pull_request_template.md"), /release-notes-lint/,
    "the pull-request template no longer asks for a release note");
});

test("tracker 97 the source directories the lint refuses are read off the tree, not typed into it", () => {
  // A TYPED LIST GOES STALE SILENTLY: a directory added next month would be a path the lint waves through.
  const dirs = nonEmpty(sourceDirectories(ROOT), "the repository's top-level directories");
  for (const expected of ["driver", "scripts", "shared", "bin"]) {
    assert.ok(dirs.has(expected), `\`${expected}\` is not in the derived set, so a path into it would pass`);
  }
  assert.ok(!dirs.has("node_modules"), "node_modules is in the set; a note would be refused for saying it");
  // Derived, so a directory that exists is covered whether or not anybody remembered it.
  for (const d of readdirSync(ROOT, { withFileTypes: true })) {
    if (d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules") {
      assert.ok(dirs.has(d.name), `\`${d.name}\` exists in the tree and the lint does not know about it`);
    }
  }
});

test("tracker 97 the licence record ships in the package, which it never has before", () => {
  // MEASURED ON THE PUBLISHED ARTEFACT: THIRD-PARTY-NOTICES.md was not short, it was ABSENT. `files[]`
  // never named it, so every release went out with no record of what the bundled dependencies are
  // licensed under, and nothing anywhere was red.
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.files.includes("THIRD-PARTY-NOTICES.md"),
    "`files[]` does not name the licence notices, so npm will not pack them — npm ships LICENSE and "
    + "README of its own accord and this file only if asked");
  assert.ok(existsSync(join(ROOT, "THIRD-PARTY-NOTICES.md")), "the licence notices are not in the tree at all");
  const entries = read("THIRD-PARTY-NOTICES.md").split("\n").filter((l) => /^## /.test(l)).length;
  assert.ok(entries > 150, `the licence notices list only ${entries} packages; the tree bundles far more`);
});

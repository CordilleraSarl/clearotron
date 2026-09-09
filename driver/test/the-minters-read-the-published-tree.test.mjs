// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE TWO SCRIPTS THAT MINT AND SWEEP READ WHAT HEAD PUBLISHES, NOT WHAT THE INDEX TRACKS.
//
// `git ls-files` reads the index. An overlay run stages the withheld corpus over a clone and never
// commits it, so there the index carries files that exist in no public tree — and a floor minted from
// it records withheld hits into a public fixture. Nothing reports that: the number is simply too high,
// and the next person to re-mint from a clean checkout is shown a SHRINK and told to record it.
//
// WHY THIS ARM EXISTS WHEN `publishedOf` IS ALREADY TESTED. Its own arms hold the helper's behaviour.
// What nothing else holds is that THESE TWO CALLERS reach it — and reverting either to a bare
// `ls-files` is a one-line edit that restores the defect while every helper arm stays green. This is
// the call site, asserted so the coverage is by construction rather than by memory.
//
// It reads the SOURCE rather than driving the scripts, deliberately: on a clean checkout the index and
// HEAD agree, so a behavioural arm here would pass whichever call the script made. That is the same
// defect one level up — a check that cannot fail over the population it is written for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

for (const [name, path] of [
  ["the reference-strip backlog minter", "../../scripts/mint-reference-strip-backlog.mjs"],
  ["the citation strip", "../../scripts/strip-tracker-citations.mjs"],
]) {
  test(`${name} filters its population through publishedOf`, () => {
    const src = read(path);
    assert.match(src, /publishedOf\(/, `${name} no longer filters to what HEAD publishes`);
    assert.match(src, /from "\.\.\/shared\/reference-guard-classes\.mjs"/,
      `${name} must use the shared helper, not a second spelling of the same rule`);

    // AND IT MUST ACT ON BOTH ANSWERS. `publishedOf` returns `{error}` for a tree with no HEAD — a
    // could-not-look — and `laid` for paths the index carries and HEAD does not. A caller that read
    // `files` and ignored the rest would mint silently over a tree it could not describe.
    assert.match(src, /\.error/, `${name} does not act on the could-not-look answer`);
    assert.match(src, /\.laid/, `${name} does not report the paths it excluded`);
  });
}

test("neither script still enumerates the index as its population", () => {
  // The exact shape that was there before, and the one a revert would restore.
  for (const path of ["../../scripts/mint-reference-strip-backlog.mjs", "../../scripts/strip-tracker-citations.mjs"]) {
    const src = read(path);
    assert.doesNotMatch(src, /const tracked = execFileSync\("git", \["-C", ROOT, "ls-files"\]/,
      `${path} assigns the index straight to its population again`);
  }
});

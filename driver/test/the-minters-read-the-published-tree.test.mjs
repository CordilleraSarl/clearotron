// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY SCRIPT THAT MINTS A COMMITTED FLOOR READS WHAT HEAD PUBLISHES, NOT WHAT THE INDEX TRACKS.
//
// Listing the tracked files reads the INDEX. An overlay run stages the withheld corpus over a clone and never
// commits it, so there the index carries files that exist in no public tree — and a floor minted from
// it records withheld hits into a public fixture. Nothing reports that: the number is simply too high,
// and the next person to re-mint from a clean checkout is shown a SHRINK and told to record it.
//
// ── THIS FILE'S OWN DEFECT, AND WHY IT IS WORTH WRITING DOWN ────────────────────────────────────────
//
// The first version named its population by hand — two entries — and `mint-suite-census.mjs` was not
// one of them, while that file still enumerated the index. So a guard written specifically to stop this
// defect passed over a caller carrying it. Its header claimed the coverage was "by construction rather
// than by memory": the two call sites were, and the POPULATION was memory, and it was one short.
//
// Found in review, and deriving the population then found a fourth — `mint-names-in-force.mjs` had the
// same defect and no reader had looked at it, because no list named it.
//
// So the population is now read off the directory. A minter added tomorrow is covered the day it is
// written, and a reviewer never has to notice that a list needs extending.
//
// ── AND THE ASSERTION IS POSITIVE ───────────────────────────────────────────────────────────────────
//
// It used to also assert the ABSENCE of one exact prior spelling of the enumerating call, which holds
// one rendering of the defect rather than the property. The
// census's own sites spell the same call differently: lowercase
// root, a different variable, arguments after. A revert typed even slightly differently walks past it.
// Requiring the population to FLOW THROUGH the helper cannot be satisfied by a rewording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const SCRIPTS = join(ROOT, "scripts");

/** Every minter, off the directory. The sweep rides with them: it selects the same population. */
const minters = () => [
  ...readdirSync(SCRIPTS).filter((f) => f.startsWith("mint-") && f.endsWith(".mjs")),
  "strip-tracker-citations.mjs",
].sort();

const src = (f) => readFileSync(join(SCRIPTS, f), "utf8");
/**
 * Whether a script has a tracked-tree population at all — directly, or through the shared enumerator.
 *
 * BOTH ROUTES, and the second was this check's own blind spot on its first run. Looking only for a
 * literal `the listing subcommand` read `mint-public-residue.mjs` as having no population and demanded it import
 * nothing — while that file takes the tracked list from `shared/tracked-files.mjs` and filters it
 * through the helper, which is the shape every one of these should have. A detector that recognises one
 * spelling of a thing reports the other as absent, which is the defect this file exists to catch,
 * arriving inside the file that catches it.
 */
const hasAPopulation = (text) => /execFileSync\(\s*"git"/.test(text) || /from "\.\.\/shared\/tracked-files\.mjs"/.test(text);

/** Those that actually take a population, so no arm below is ever created with nothing to measure. */
const governed = () => minters().filter((f) => hasAPopulation(src(f)));

test("the population is derived, and it is not empty", () => {
  // The silent-pass mode of every check below: a directory read that returns nothing, or a filter that
  // stops matching, leaves the loop with no body and this file green over nothing at all.
  //
  // AND THE FILTER IS ASSERTED, NOT TRUSTED. A script dropping out of `governed` is how one of these
  // stops being checked — silently, because a check that was never created cannot fail. The five are
  // named here for exactly that: `hasAPopulation` narrowing, or a minter rewritten to take its files
  // from somewhere this cannot see, reds this arm rather than shrinking the suite quietly.
  const found = governed();
  assert.ok(found.length >= 5, `only ${found.length} script(s) are governed — the derivation has stopped matching`);
  for (const known of ["mint-suite-census.mjs", "mint-names-in-force.mjs", "mint-public-residue.mjs",
    "mint-reference-strip-backlog.mjs", "strip-tracker-citations.mjs"]) {
    assert.ok(found.includes(known), `${known} is no longer governed by this check`);
  }
});

// FILTERED HERE RATHER THAN BAILED INSIDE. An arm that returns early on a precondition reports its
// subject clean having measured none of it, because a bare `return` counts as a pass. A script with no
// population has nothing to filter and gets no arm at all; that it is out of scope is asserted above.
for (const f of governed()) {
  test(`${f} takes its population from what HEAD publishes`, () => {
    const text = src(f);
    assert.match(text, /publishedOf\(/, `${f} takes a tracked population and never filters it to what HEAD carries`);
    assert.match(text, /from "\.\.\/shared\/reference-guard-classes\.mjs"/,
      `${f} must use the shared helper, not a second spelling of the same rule`);
    // AND IT MUST ACT ON BOTH ANSWERS. `publishedOf` returns `error` for a tree with no HEAD — a failure
    // to look — and `laid` for paths the index carries and HEAD does not. A caller reading `files` and
    // ignoring the rest would mint silently over a tree it could not describe.
    assert.match(text, /\.error/, `${f} does not act on the answer that says it could not look`);
    assert.match(text, /\.laid/, `${f} does not report the paths it excluded`);
  });
}

// ── A MINTER DOES NOT READ ITS OWN OUTPUT ───────────────────────────────────────────────────────────
//
// `mint-names-in-force.mjs` derives the CLEAROTRON_* names this build reads by scanning every tracked
// source file — and the file it WRITES is a tracked source file whose entire content is those names as
// string literals. So every name already in the list was rediscovered as a name the build reads and
// written back: the derivation fed itself, and a name that code stopped reading never left, because the
// list it was supposed to leave is what kept it there.
//
// DRIVEN THROUGH THE SCRIPT'S OWN `sourceFiles`, not asserted against the regex. A pattern test would
// pass on any filter that happened to contain the right characters; this asks the function the question
// the minter asks it.
test("the names minter excludes its own output from the tree it scans", async () => {
  const { sourceFiles } = await import("../../scripts/mint-names-in-force.mjs");
  const files = sourceFiles(ROOT);

  // THE FLOOR FIRST. An empty or tiny population would satisfy the absence below while measuring
  // nothing at all, which is the shape this whole file exists to refuse.
  assert.ok(files.length > 200, `the population read as ${files.length} files — too few to be measuring anything`);

  const self = join("shared", "names-in-force.mjs");
  assert.ok(!files.includes(self), "the minter's own output is in the population it derives from");

  // AND THE EXCLUSION IS NARROW. Its neighbours in the same directory are still read, so this removed
  // one file rather than a directory — an over-broad filter would drop real reads and shrink the list.
  assert.ok(files.some((f) => f.startsWith("shared/") && f !== self),
    "nothing under shared/ is read any more, so the exclusion took more than its own file");
  assert.ok(files.some((f) => f.startsWith("driver/") && f.endsWith(".mjs")),
    "the driver is not being read at all");
});

test("a name only the output carries does not survive, and a name the code reads does", async () => {
  const { sourceFiles } = await import("../../scripts/mint-names-in-force.mjs");
  const files = sourceFiles(ROOT);
  const text = files.map((f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return ""; } }).join("\n");

  // THE PROPERTY, BOTH DIRECTIONS. A ghost is a name the published list carries that no scanned source
  // mentions; a real name is one a scanned source does mention. The first set must be empty and the
  // second must not, or the derivation is either self-feeding or reading nothing.
  const listed = [...new Set([...readFileSync(join(ROOT, "shared", "names-in-force.mjs"), "utf8")
    .matchAll(/"(CLEAROTRON_[A-Z0-9_]+)"/g)].map((m) => m[1]))];
  assert.ok(listed.length > 100, `the list carries ${listed.length} names — too few to be measuring anything`);

  const ghosts = listed.filter((n) => !new RegExp(`\\b${n}\\b`).test(text));
  assert.deepEqual(ghosts, [],
    "the published list carries names no scanned source reads — the derivation is feeding itself again");
});

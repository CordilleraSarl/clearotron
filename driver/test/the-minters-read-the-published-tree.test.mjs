// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY SCRIPT THAT MINTS A COMMITTED FLOOR READS WHAT HEAD PUBLISHES, NOT WHAT THE INDEX TRACKS.
//
// `git ls-files` reads the index. An overlay run stages the withheld corpus over a clone and never
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
// It used to also assert the ABSENCE of the exact prior text — `const tracked = execFileSync("git",
// ["-C", ROOT, "ls-files"]` — which holds one rendering of the defect rather than the property. The
// census's own sites read `files = execFileSync("git", ["-C", root, "ls-files", "--", …])`: lowercase
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
 * literal `"ls-files"` read `mint-public-residue.mjs` as having no population and demanded it import
 * nothing — while that file takes the tracked list from `shared/tracked-files.mjs` and filters it
 * through the helper, which is the shape every one of these should have. A detector that recognises one
 * spelling of a thing reports the other as absent, which is the defect this file exists to catch,
 * arriving inside the file that catches it.
 */
const hasAPopulation = (text) => /"ls-files"/.test(text) || /from "\.\.\/shared\/tracked-files\.mjs"/.test(text);

test("the population is derived, and it is not empty", () => {
  // The silent-pass mode of every check below: a directory read that returns nothing, or a filter that
  // stops matching, leaves each `for` loop with no body and this file green over nothing at all.
  const found = minters();
  assert.ok(found.length >= 5, `read ${found.length} script(s) — the derivation has stopped matching`);
  for (const known of ["mint-suite-census.mjs", "mint-names-in-force.mjs", "mint-public-residue.mjs",
    "mint-reference-strip-backlog.mjs", "strip-tracker-citations.mjs"]) {
    assert.ok(found.includes(known), `${known} is no longer reached by the derivation`);
  }
});

for (const f of minters()) {
  test(`${f} takes its population from what HEAD publishes`, () => {
    const text = src(f);
    // A script that never enumerates the tree has no population to filter, and requiring the helper of
    // it would be requiring a call with nothing to pass.
    if (!hasAPopulation(text)) return;   // nothing to filter, so nothing to require
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

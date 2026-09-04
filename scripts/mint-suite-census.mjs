#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// mint-suite-census.mjs —: re-stamp driver/suite-census.json after a deliberate change.
//
//   node scripts/mint-suite-census.mjs            # DRY RUN — prints what would change
//   node scripts/mint-suite-census.mjs --apply    # writes it
//   node scripts/mint-suite-census.mjs --check    # prints the same, and EXITS 1 if anything differs
//   node scripts/mint-suite-census.mjs --apply --allow-loss   # writes it EVEN IF a file left the
//                                                             # census or shrank inside it
//
// — `--apply` REFUSES ON A LOSS. A file gone from the census, or fewer tests or assertions inside
// one, stops the write; growth and additions never do. Without that arm the routine command laundered
// the exact defect the census exists to catch, and did it in silence: re-stamping after a gutting makes
// the census agree with the gutted tree, and the suite arm that compares them then agrees with both.
//
// — `--check` EXISTS BECAUSE PEOPLE WERE ALREADY WRITING IT. This script took exactly one flag,
// and an unrecognised argument fell through to the dry run, which prints a diff and exits 0 — always.
// Lane gate scripts (mine included) ran `--check` and read `$?` as a pass, so a line reported as a
// census gate was measuring nothing at all. The enforcement was never here — it is
// driver/test/suite-census.test.mjs and it ran anyway inside the suite — so nothing bad shipped through
// the hole. But a flag that silently means "dry run" to a caller who believes it means "verify" is the
// exact shape this repo keeps getting caught by, so it now means what it is being read as.
//
// THE RE-STAMP IS THE DELIBERATE ACT, which is the whole mechanism. A census that updated itself would
// guard nothing: the point is that deleting a test file, renaming one out of the collection glob, or
// hollowing one out cannot happen without somebody running this and seeing the diff.
//
// DRY RUN BY DEFAULT for the same reason the other rewriting scripts here are: this file is a ceiling
// somebody could silently lower, and lowering it is exactly how a gutting would be laundered into a
// green suite. `--apply` is one flag, and the diff it prints first is the review.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CENSUS_WORKSPACES, CENSUS_ROOT_SCRIPTS, countTestSites, collectionFromManifests, censusDisagreements,
  rootScriptDisagreements, lossBetween } from "../shared/suite-census.mjs";
import { withheldEntryFor, announceWithheldMode } from "../shared/withheld-paths-access.mjs";   // — withheld is a stated absence, not a loss.: the record does not ship, and without it every absence is a loss
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently

// — say which mode this run is in, so a relaxed check is never silent.
announceWithheldMode();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CENSUS = join(ROOT, "driver", "suite-census.json");
const APPLY = process.argv.includes("--apply");
const CHECK = process.argv.includes("--check");
// — the opt-out for a DELIBERATE loss, named like its sibling `--allow-unstaged` in
// scripts/regen-baselines.mjs. Never needed to add or grow a test, which is the routine case.
const ALLOW_LOSS = process.argv.includes("--allow-loss");

const README = [
  "#1010 — THE SUITE'S SELF-CENSUS. Minted and checked by shared/suite-census.mjs's ONE counter, so the",
  "minting side cannot drift from the checking side and manufacture its own findings.",
  "",
  "Collection is a glob, so a test file that is DELETED or RENAMED out of it simply stops being",
  "collected: the runner reports a smaller total and exits 0. Nothing pinned assertion counts either, so",
  "a GUTTED file — names intact, assertions gone — reported the same green.",
  "",
  "This file is the persisted expectation that makes those three visible, and only a persisted",
  "expectation can: a committed deletion vanishes from git, from the glob and from the TAP output at the",
  "same instant, so no pairwise comparison at run time has anything left to compare.",
  "",
  "THE COUNTS ARE A FLOOR, NOT A TARGET. 93% of assert sites are one-site-one-execution, so this",
  "UNDERSTATES how bad a gutting is and never whether one happened. Do not tighten it into an exact",
  "count — that would have to model loops, and a census that fails on an honest refactor gets deleted.",
  "",
  "RE-STAMP DELIBERATELY:  node scripts/mint-suite-census.mjs --apply",
];

export function buildCensus(root = ROOT) {
  const out = { _README: README, workspaces: {}, rootScripts: {} };
  for (const { ws, ext } of CENSUS_WORKSPACES) {
    let files = [];
    try {
      files = execFileSync("git", ["-C", root, "ls-files", "--", `${ws}/test/*.test.${ext}`], { encoding: "utf8" })
        .split("\n").map((s) => s.trim()).filter(Boolean).sort();
    } catch { files = []; }
    const perFile = {};
    for (const f of files) {
      const abs = join(root, f);
      if (!existsSync(abs)) continue;                    // tracked but deleted in the working tree
      perFile[f.slice(`${ws}/test/`.length)] = countTestSites(readFileSync(abs, "utf8"));
    }
    // — NO `files` SCALAR. `perFile` IS the file list, and a count beside it was a second copy of
    // one fact that git could take one side of. Two branches each adding a test file merged to a perFile
    // holding BOTH and a `files` holding ONE side's number, so every PR that added a test file went red
    // the moment main added one too — "the census says 517 files and lists 518" — and the only remedy
    // was rebase-and-re-mint, which the next merge invalidated again. Serialised every test-adding merge
    // in the repo. Derived at read time there is nothing to disagree with: a perFile auto-merge that
    // takes both additions is simply CORRECT, and needs no re-mint at all.
    out.workspaces[ws] = { ext, perFile };
  }
  // — THE ROOT-SCRIPT POPULATIONS. Keyed by the FULL repo-relative path, not a prefix-stripped
  // one: these globs span two shapes (`providers/_shared/test/` and `providers/<id>/test/`), and a
  // stripped key would collide the moment two providers shipped a file of the same name.
  for (const { script, globs } of CENSUS_ROOT_SCRIPTS) {
    let files = [];
    try {
      files = execFileSync("git", ["-C", root, "ls-files", "--", ...globs], { encoding: "utf8" })
        .split("\n").map((x) => x.trim()).filter(Boolean).sort();
    } catch { files = []; }
    const perFile = {};
    for (const f of files) {
      const abs = join(root, f);
      if (!existsSync(abs)) continue;                    // tracked but deleted in the working tree
      perFile[f] = countTestSites(readFileSync(abs, "utf8"));
    }
    out.rootScripts[script] = { globs: [...globs], perFile };
  }
  return out;
}

/** The manifests, read from disk. Separate from the pure resolver so the canary can plant its own. */
const readManifest = (rel) => { try { return JSON.parse(readFileSync(join(ROOT, rel), "utf8")); } catch { return null; } };

function main() {
  // ── ITEM 1 — BEFORE ANY COUNTING, DOES THIS CENSUS DESCRIBE WHAT THE RUNNER RUNS? ───────────
  //
  // FIRST, and it refuses rather than warns. Everything below counts files inside a corpus this list
  // chooses, so a census that is internally consistent about the WRONG corpus passes every other check
  // in this file — measured: narrowing driver's own collection glob silenced 581 of 639 files while
  // `--check` exited 0 and the census test passed. Counting after that point is counting the wrong
  // thing carefully.
  //
  // ON `--apply` TOO, not only `--check`. A re-stamp is where a wrong corpus gets written down as the
  // new expectation, which is the one moment the disagreement stops being visible at all.
  // — the same question of the ROOT scripts. Narrowing `test:providers`' glob silences a third of
  // that population at exit 0, and no per-workspace check can see it: `providers` is not a workspace.
  const disagreements = [...censusDisagreements(collectionFromManifests(readManifest)),
    ...rootScriptDisagreements(readManifest)];
  if (disagreements.length) {
    // — the message names BOTH declared sources now. It used to say "the census and `npm run
    // test:full` disagree" whatever had moved, so a root-script disagreement sent the reader to look at
    // a script that was fine. A refusal that misnames its own subject costs the reader the time the
    // refusal was meant to save.
    console.error("\nREFUSING — the census and what the runner collects disagree:");
    for (const d of disagreements) console.error(`  · ${d}`);
    console.error("\nOne of the two moved. Either a workspace's test script or a root test script was "
      + "re-pointed, or CENSUS_WORKSPACES / CENSUS_ROOT_SCRIPTS in shared/suite-census.mjs is out of "
      + "date. Fix the disagreement — do not re-stamp over it, because a census minted against a corpus "
      + "nothing runs is the defect #1010 names, not the fix for it.");
    process.exitCode = 1;
    return;
  }

  const next = buildCensus();
  let prev = null;
  try { prev = JSON.parse(readFileSync(CENSUS, "utf8")); } catch { /* first mint */ }

  const lost = [];
  for (const { ws } of CENSUS_WORKSPACES) {
    const a = prev?.workspaces?.[ws]?.perFile ?? {};
    const b = next.workspaces[ws].perFile;
    const added = Object.keys(b).filter((k) => !(k in a)).sort();
    const { gone, shrunk, skipped } = lossBetween(a, b);
    for (const f of gone) lost.push(`${ws}  REMOVED  ${f}  (was ${a[f].tests} tests, ${a[f].asserts} asserts)`);
    for (const f of shrunk) lost.push(`${ws}  SHRANK   ${f}  ${a[f].tests}\u2192${b[f].tests} tests, ${a[f].asserts}\u2192${b[f].asserts} asserts`);
    // item 3 — a NEW skip is a loss. It lands here with REMOVED and SHRANK so it needs the same
    // --allow-loss and the same sentence in the PR body naming what stopped running.
    for (const f of skipped) lost.push(`${ws}  SKIPPED  ${f}  ${a[f].skips ?? 0}\u2192${b[f].skips ?? 0} skip(s), `
      + `${a[f].todos ?? 0}\u2192${b[f].todos ?? 0} todo(s) — an arm that stopped running reads as one that passed`);
    console.log(`\n${ws}: ${Object.keys(next.workspaces[ws].perFile ?? {}).length} file(s)`);
    for (const f of added) console.log(`  + ${f}  (${b[f].tests} tests, ${b[f].asserts} asserts)`);
    // A file leaving the census, or shrinking inside it, is the shape this whole thing exists for.
    // Printed loudly and separately, and — since 's loss arm — REFUSED below unless --allow-loss
    // is passed. This comment used to end "an --apply that scrolls past these is the laundering", which
    // was an accurate description of what the code then did: it printed both lines and wrote the file.
    for (const f of gone) console.log(`  REMOVED  ${f}  (was ${a[f].tests} tests, ${a[f].asserts} asserts)`);
    for (const f of shrunk) console.log(`  SHRANK   ${f}  ${a[f].tests}→${b[f].tests} tests, ${a[f].asserts}→${b[f].asserts} asserts`);
    for (const f of skipped) console.log(`  SKIPPED  ${f}  ${a[f].skips ?? 0}→${b[f].skips ?? 0} skip(s), `
      + `${a[f].todos ?? 0}→${b[f].todos ?? 0} todo(s)`);
    // follow-up — THE REASSURING LINE READ BROADER THAN IT MEASURED. `added`/`gone`/`shrunk` are
    // the three LOSS shapes this census exists to catch, and a file that GREW is none of them: gain a
    // test without re-stamping and all three lists are empty, so the summary printed "no additions,
    // removals or shrinkage" — true, reassuring, and said over a stale census. Caught in the wild 90
    // minutes after `--check` landed, which is the same disease one level up: a narrator that sounds like
    // a verdict. So growth is now printed as its own shape, and the all-clear says what it actually
    // checked instead of implying currency it never established.
    const grew = Object.keys(b).filter((k) => k in a && (b[k].tests > a[k].tests || b[k].asserts > a[k].asserts)).sort();
    for (const f of grew) console.log(`  grew     ${f}  ${a[f].tests}→${b[f].tests} tests, ${a[f].asserts}→${b[f].asserts} asserts`);
    if (!added.length && !gone.length && !shrunk.length && !grew.length) console.log("  (unchanged — no file added, removed, grown or shrunk)");
    else if (!added.length && !gone.length && !shrunk.length) console.log("  (nothing LOST — but the counts above moved, so the census on disk is stale)");
  }

  // ── — THE ROOT-SCRIPT POPULATIONS, AND THE ONE PLACE AN ABSENCE IS NOT A LOSS ──────────────
  //
  // A file that is gone AND covered by a `shared/withheld-paths.mjs` entry is a stated consequence of
  // the cut. A file that is gone and undeclared is damage, and it fails. That distinction is already
  // the house rule — withheld-paths' own header states it for documents, `no-caveat-repair` enforces
  // it for docs, `withheld-fixture.mjs` applies it to fixtures — and this is the same rule over test
  // files.
  //
  // THE EXEMPTION IS AUTOMATIC, WITH NO FLAG, AND THAT IS THE WHOLE DESIGN. Routing a withheld absence
  // through `--allow-loss` would make every cut train somebody to pass it, and a flag that means "I
  // looked" becomes the flag that means "get on with it". It is still PRINTED — a stated consequence
  // read silently is indistinguishable from one nobody noticed.
  for (const { script } of CENSUS_ROOT_SCRIPTS) {
    const a = prev?.rootScripts?.[script]?.perFile ?? {};
    const b = next.rootScripts[script].perFile;
    const added = Object.keys(b).filter((k) => !(k in a)).sort();
    const { gone, shrunk, skipped } = lossBetween(a, b);
    const withheldGone = gone.filter((f) => withheldEntryFor(f));
    const undeclaredGone = gone.filter((f) => !withheldEntryFor(f));
    for (const f of undeclaredGone) lost.push(`${script}  REMOVED  ${f}  (was ${a[f].tests} tests, ${a[f].asserts} asserts) — not covered by any withheld-paths entry`);
    for (const f of shrunk) lost.push(`${script}  SHRANK   ${f}  ${a[f].tests}\u2192${b[f].tests} tests, ${a[f].asserts}\u2192${b[f].asserts} asserts`);
    for (const f of skipped) lost.push(`${script}  SKIPPED  ${f}  ${a[f].skips ?? 0}\u2192${b[f].skips ?? 0} skip(s), `
      + `${a[f].todos ?? 0}\u2192${b[f].todos ?? 0} todo(s) — an arm that stopped running reads as one that passed`);
    console.log(`\n${script}: ${Object.keys(b).length} file(s)`);
    for (const f of added) console.log(`  + ${f}  (${b[f].tests} tests, ${b[f].asserts} asserts)`);
    for (const f of withheldGone) console.log(`  withheld ${f}  (was ${a[f].tests} tests, ${a[f].asserts} asserts) — ${withheldEntryFor(f).path}, a stated consequence of the cut, not a loss`);
    for (const f of undeclaredGone) console.log(`  REMOVED  ${f}  (was ${a[f].tests} tests, ${a[f].asserts} asserts)  UNDECLARED`);
    for (const f of shrunk) console.log(`  SHRANK   ${f}  ${a[f].tests}→${b[f].tests} tests, ${a[f].asserts}→${b[f].asserts} asserts`);
    for (const f of skipped) console.log(`  SKIPPED  ${f}  ${a[f].skips ?? 0}→${b[f].skips ?? 0} skip(s), ${a[f].todos ?? 0}→${b[f].todos ?? 0} todo(s)`);
    const grew = Object.keys(b).filter((k) => k in a && (b[k].tests > a[k].tests || b[k].asserts > a[k].asserts)).sort();
    for (const f of grew) console.log(`  grew     ${f}  ${a[f].tests}→${b[f].tests} tests, ${a[f].asserts}→${b[f].asserts} asserts`);
    if (!added.length && !gone.length && !shrunk.length && !grew.length) console.log("  (unchanged — no file added, removed, grown or shrunk)");
    else if (!undeclaredGone.length && !shrunk.length && !added.length) console.log("  (nothing LOST — the counts above moved, so the census on disk is stale)");
  }

  if (CHECK) {
    // Compared against what is ON DISK, so this catches the scalar drift too: a `files` count that took
    // one side of a merge differs from a fresh mint even when every perFile key matches.
    const same = JSON.stringify(prev) === JSON.stringify(next);
    // The remedy line names the command that will actually work. It used to say `--apply` even when the
    // difference was a LOSS, which sent the reader to re-stamp over the very thing this file exists to
    // catch — the failure message recommending the laundering by name.
    const remedy = lost.length
      ? "node scripts/mint-suite-census.mjs --apply --allow-loss   (LOSS above \u2014 say in the PR body what was lost and why)"
      : "node scripts/mint-suite-census.mjs --apply";
    console.log(same
      ? `\nCHECK — ${CENSUS} matches this tree.`
      : `\nCHECK FAILED — ${CENSUS} does not match this tree. Re-stamp it: ${remedy}`);
    if (!same) process.exitCode = 1;
    return;
  }
  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Pass --apply to re-stamp ${CENSUS}.`);
    return;
  }
  // — A RE-STAMP MAY NOT RECORD A LOSS, and this is the arm that makes the rest of the census
  // load-bearing. Everything above is a comparison against a file that `--apply` then overwrote, so a
  // gutting survived it: delete eight assertions, re-stamp, and the census and the gutted tree agree,
  // which is exactly what driver/test/suite-census.test.mjs checks. Measured on 2a01f882 — 12 pass, 0
  // fail, over a file that had lost a third of its assertions.
  //
  // The header above already claimed the protection: "deleting a test file, renaming one out of the
  // collection glob, or hollowing one out cannot happen without somebody running this and seeing the
  // diff". Both routine callers run `--apply` unattended — the merge protocol re-mints on every rebase,
  // and scripts/regen-baselines.mjs runs it as one of four generators — so the diff it printed first was
  // a review nobody performed. A guard that has to be READ is not a guard.
  if (lost.length && !ALLOW_LOSS) {
    console.error(`\nREFUSING TO RE-STAMP — this would record a LOSS:\n\n  ${lost.join("\n  ")}\n`);
    console.error("Growth and additions never reach this line; only a file leaving the census or shrinking\n"
      + "inside it does. If the loss is deliberate — a test file genuinely deleted, a guard genuinely\n"
      + "retired — re-run with --allow-loss and say in the PR body what was lost and why.\n\n"
      + "  node scripts/mint-suite-census.mjs --apply --allow-loss");
    process.exitCode = 1;
    return;
  }
  writeFileSync(CENSUS, JSON.stringify(next, null, 2) + "\n");
  console.log(`\nre-stamped ${CENSUS}${ALLOW_LOSS && lost.length ? `  (--allow-loss: ${lost.length} loss line(s) accepted)` : ""}`);
}

if (isEntrypoint(import.meta.url)) main();

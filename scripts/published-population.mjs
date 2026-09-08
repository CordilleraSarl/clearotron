#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHICH FILES A FLOOR IS ALLOWED TO BE ABOUT.
//
// A committed floor is a statement about the PUBLISHED tree. Both minters that read this used
// `git ls-files`, which enumerates the INDEX, and the index is not the published population: an overlay
// run STAGES the withheld corpus over a clone and never commits it, so `ls-files` there returns files
// that exist in no public tree. A floor minted from that records withheld hits into a public fixture,
// and nothing says so — the number is simply too high, and the next person to re-mint from a clean tree
// sees a SHRINK and is told to record it.
//
// Measured on this tree: index 3,677 files, HEAD 3,677, empty set difference — so a clean checkout is
// not where this bites. That is the whole problem with it. It is correct everywhere it is usually run.
//
// TWO MECHANISMS, AND THE FIRST IS THE FIX. Enumerating from `HEAD` answers the published question by
// construction: a file the overlay laid is not in HEAD, so it cannot enter the population however the
// script is invoked. The refusal underneath it is not redundant — it is what turns "your number was
// quietly about a different tree" into a stop with the offending paths named.
//
// WHY THE REFUSAL IS NOT A BLANKET ONE. A newly added file is legitimately in the index and not in HEAD,
// and the suite census REQUIRES exactly that shape: `git add`, mint, `git add` again. So the refusal
// names what it found and offers `--include-staged`, rather than making the documented flow impossible
// and teaching the next person to reach for a flag they do not read.
import { execFileSync } from "node:child_process";

const git = (root, args) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n").filter(Boolean);

/** Every path HEAD carries. This is the published population, and it is what a floor may be about. */
export const headFiles = (root) => git(root, ["ls-tree", "-r", "HEAD", "--name-only"]);

/** Paths the INDEX carries that HEAD does not — an overlay's withheld corpus, or a staged addition. */
export function stagedOnly(root) {
  const head = new Set(headFiles(root));
  return git(root, ["ls-files"]).filter((f) => !head.has(f));
}

/**
 * The file list a minter may measure, or a refusal.
 *
 * `includeStaged` is the deliberate override for the add-then-mint flow. It widens the population to
 * the index AND says so on stderr, because a number about a tree that is not published yet is still a
 * different claim from one about the published tree.
 */
export function publishedPopulation(root, { includeStaged = false, what = "this floor" } = {}) {
  const extra = stagedOnly(root);
  if (!extra.length) return headFiles(root);
  if (includeStaged) {
    process.stderr.write(
      `published-population: measuring ${extra.length} staged-but-uncommitted file(s) as well as HEAD — `
      + `${what} will describe a tree nobody has published yet.\n`);
    return [...headFiles(root), ...extra];
  }
  process.stderr.write(
    `published-population: REFUSING to mint ${what}.\n`
    + `  ${extra.length} file(s) are in the index and not in HEAD, so this tree's index is not the\n`
    + `  published population. An overlay run stages the withheld corpus and never commits it, and a\n`
    + `  floor minted here would record withheld hits into a public fixture.\n`
    + extra.slice(0, 10).map((f) => `    ${f}\n`).join("")
    + (extra.length > 10 ? `    …and ${extra.length - 10} more\n` : "")
    + `  If these are your own staged additions, re-run with --include-staged.\n`);
  process.exit(2);
}

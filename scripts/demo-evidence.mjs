#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// demo-evidence.mjs — THE HAND-WRITTEN DIFF MUST BE REVIEWABLE ON ITS OWN.
//
// One integration branch carried 37 commits, 2,490 files, 221,105 additions and 410,984 deletions, and
// most of it was regenerated demo evidence. A reviewer cannot find the source changes inside that, so
// in practice nobody reads them — the review happens, and it reviews nothing. The evidence is not the
// problem: it is generated output, it is meant to change wholesale, and it is right that it ships.
// Mixing it into the same commits as hand-written code is the problem.
//
// TWO HALVES, because a convention nobody checks is a convention that lasts one beta:
//
//   --check    a commit that touches `demo/` touches nothing else, across a range
//   --apply    re-record `demo/MANIFEST.json` — generator, tree, and the run each product replays
//
// The manifest is what makes the regeneration commit self-explaining: without it a reviewer skipping
// the demo diff is taking on trust that it IS regenerated output rather than a hand edit hidden in
// 200,000 lines. With it, the thing they are skipping says what produced it.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const MANIFEST = join(ROOT, "demo", "MANIFEST.json");
export const GENERATOR = "scripts/freeze-example-run.mjs";

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/** Every product directory under `demo/`, with the run it replays. */
export function products({ root = ROOT } = {}) {
  const dir = join(root, "demo");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort()
    .map((name) => {
      let meta = {};
      try { meta = JSON.parse(readFileSync(join(dir, name, "meta.json"), "utf8")); } catch { /* absent is an answer */ }
      return { product: name, runId: meta.runId ?? null, template: meta.template ?? null };
    });
}

/**
 * Is this a commit that mixes generated evidence with hand-written source?
 * Returns the offending paths, or an empty array. PURE given the file list.
 */
export function mixedPaths(files) {
  const demo = files.filter((f) => f.startsWith("demo/"));
  if (!demo.length) return [];                       // touches no evidence — nothing to say
  return files.filter((f) => !f.startsWith("demo/"));
}

if (isEntrypoint(import.meta.url)) {
  const apply = process.argv.includes("--apply");

  if (apply) {
    writeFileSync(MANIFEST, `${JSON.stringify({
      note: "What produced the evidence under demo/. Re-recorded by scripts/demo-evidence.mjs --apply in the same commit that regenerates it.",
      generator: GENERATOR,
      recordedFromTree: git("rev-parse", "HEAD"),
      products: products(),
    }, null, 2)}\n`);
    console.log(`recorded ${products().length} demo product(s) against ${git("rev-parse", "--short", "HEAD")}`);
    process.exit(0);
  }

  // --check: every commit in the range keeps its evidence to itself.
  const base = process.argv[process.argv.indexOf("--base") + 1] || "origin/main";

  // ── A BASE THIS CHECKOUT CANNOT RESOLVE IS A FAILURE TO LOOK, AND IT SAYS SO ────────────────────
  //
  // A shallow clone fetches one branch, so `origin/main` is not a ref in it and `rev-list base..HEAD`
  // dies on an ambiguous argument — a stack trace naming a line of this file, which reads as a broken
  // script rather than as a checkout that cannot answer the question. It is neither a clean range nor
  // a mixed one: nothing was compared. Falling back to another base would be worse, because a range
  // measured against something the caller did not ask for reports a clean result for a population it
  // never examined.
  try { git("rev-parse", "--verify", "--quiet", `${base}^{commit}`); }
  catch {
    console.error(`demo-evidence: this checkout has no "${base}", so no commit was compared.`);
    console.error("");
    console.error("Nothing is known about the range either way — this is not a clean result. A shallow");
    console.error("checkout carries only the branch it fetched; fetch the base ref, or name one this");
    console.error("clone holds with --base.");
    process.exit(2);
  }

  const shas = git("rev-list", `${base}..HEAD`).split("\n").filter(Boolean);
  const bad = [];
  for (const sha of shas) {
    const files = git("show", "--name-only", "--pretty=format:", sha).split("\n").filter(Boolean);
    const mixed = mixedPaths(files);
    if (mixed.length) bad.push({ sha, mixed });
  }

  if (!bad.length) {
    console.log(`demo-evidence: ${shas.length} commit(s) against ${base}; none mixes generated evidence with source.`);
    process.exit(0);
  }

  console.error("demo-evidence: generated evidence is mixed with hand-written source.\n");
  console.error("A reviewer cannot find the source diff inside a regeneration, so in practice nobody reads it.\n");
  for (const { sha, mixed } of bad) {
    console.error(`  ${sha.slice(0, 9)} also touches ${mixed.length} non-demo path(s):`);
    for (const f of mixed.slice(0, 5)) console.error(`      ${f}`);
    if (mixed.length > 5) console.error(`      …and ${mixed.length - 5} more`);
  }
  console.error("\nSplit the regeneration into its own commit:");
  console.error("  git reset HEAD~ && git add demo && git commit && git add -A && git commit");
  process.exit(1);
}

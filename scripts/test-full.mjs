#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// RUN EVERY CORPUS, AND REFUSE TO BE SILENT ABOUT ONE THAT WAS NOT RUN.
//
//   node scripts/test-full.mjs                 # every corpus
//   node scripts/test-full.mjs --only providers # one of them
//   node scripts/test-full.mjs --list           # the plan, run nothing
//
// ── WHAT THIS REPLACES, AND WHY A FLAG WAS NOT ENOUGH ────────────────────────────────────────────
//
// `npm run test:full --workspaces --if-present` reported this suite green while running part of it.
// Two separate holes, and only the smaller one is about the flag:
//
//   - `providers/` holds twelve directories of register-adapter tests. ELEVEN OF THEM ARE NOT
//     WORKSPACES — they have no package.json at all — so no `--workspaces` command can reach them,
//     with or without `--if-present`. That is the larger half and no flag fixes it.
//   - `--if-present` turns "this workspace declares no such script" into a silent skip. An absence
//     reading as a pass is the shape this repository refuses everywhere else.
//
// So the population is declared here rather than inferred from a flag, and every member of it is
// either run or named. A corpus that was not run is a line on stdout, never an omission.
//
// ── THE RULE, AND THE ONE THING THAT MAY SOFTEN IT ───────────────────────────────────────────────
//
// A declared workspace that does not define `test:full` FAILS this command. That is the permissive
// half of the old gate written the other way round.
//
// One softening, because refusing here would be a false refusal: a workspace whose tests are already
// run by another corpus is COVERED, not missing. `providers/oauth-mcp-bridge` is a workspace with no
// scripts block whose ten tests run every time the providers corpus does. Failing it would refuse a
// workspace whose tests demonstrably execute, and giving it a script of its own would split one
// corpus across two mechanisms and run those files twice.
//
// THE EXEMPTION IS CHECKED, NEVER TRUSTED. For each entry below, this command asserts that the
// covering corpus's own file list actually reaches that workspace, and that the workspace has test
// files at all. Both halves matter: an intersection with an empty set is empty, so a workspace that
// lost its tests would satisfy a reachability check that only asked "is nothing missing". If someone
// narrows the providers file list until it no longer reaches this workspace, the exemption stops
// being true and this command says so instead of going quiet.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every `*.test.mjs` under `providers/`, at any depth, deduplicated and ordered.
 *
 * RECURSIVE, AND THAT IS THE POINT. This read `providers/<dir>/test/*.test.mjs` and nothing else, one
 * level deep — and the exemption check below counted a covered workspace's own files with the SAME
 * shape. So a test at `providers/x/y.test.mjs`, or at `providers/x/test/sub/y.test.mjs`, was in no
 * corpus at all, both sides missed it together and therefore agreed, and every check reported clean
 * under a command whose whole claim is that it runs every corpus. Two derived sides sharing one
 * assumption cannot disagree about it; that is this file's own argument, and it applied here.
 *
 * `node_modules` is excluded because an installed dependency's tests are not this repository's corpus.
 * Nothing else is: a file is either collected or it is a fault, never quietly outside the shape.
 */
export function providerTestFiles(root = ROOT) {
  const base = join(root, "providers");
  if (!existsSync(base)) return [];
  const out = new Set();
  const walk = (dir, rel) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.name === "node_modules") continue;
      const here = `${rel}/${d.name}`;
      if (d.isDirectory()) walk(join(dir, d.name), here);
      else if (d.name.endsWith(".test.mjs")) out.add(here);
    }
  };
  walk(base, "providers");
  // DEDUPLICATED ON PURPOSE. The shell form this replaced listed `providers/_shared/test/*.test.mjs`
  // and then `providers/*/test/*.test.mjs`, which matches `_shared` as well — 51 paths for 37 files.
  // Measured before it was called a defect: `node --test` runs a repeated path once, so the old form
  // executed nothing twice. Building the list here makes that a property rather than a coincidence.
  return [...out].sort();
}

/**
 * A workspace with no `test:full`, whose tests another corpus already runs.
 * `reaches` is the claim this command verifies on every run — not documentation.
 */
export const COVERED_ELSEWHERE = [
  {
    workspace: "providers/oauth-mcp-bridge",
    corpus: "providers",
    why: "a workspace for its dependencies, not for a suite of its own: its tests sit in "
      + "providers/<name>/test like every other adapter's and run with them. A script here would "
      + "split one corpus across two mechanisms.",
  },
];

/**
 * The corpora, discovered from the manifest rather than listed.
 *
 * `providerFiles` is injectable for one reason: the exemption check below compares the covering
 * corpus's file list against the workspace's own directory, and if both are always read from the
 * same place the comparison can never fail — coverage in appearance with nothing underneath. The
 * state worth refusing is a NARROWED corpus, which is an edit to `providerTestFiles`, so an arm has
 * to be able to hand in a narrowed list and see the refusal.
 */
export function plan(root = ROOT, { providerFiles } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const workspaces = manifest.workspaces ?? [];
  const corpora = [];
  const faults = [];

  for (const ws of workspaces) {
    let scripts = null;
    try { scripts = JSON.parse(readFileSync(join(root, ws, "package.json"), "utf8")).scripts ?? {}; }
    catch { scripts = null; }
    // A DECLARED WORKSPACE WITH NO READABLE MANIFEST IS A FAULT, not a skip. The old command could
    // not tell this apart from a workspace that simply had nothing to run.
    if (scripts === null) { faults.push(`${ws} is a declared workspace and its package.json could not be read`); continue; }

    if (scripts["test:full"]) {
      corpora.push({ name: ws, kind: "workspace", argv: ["npm", "run", "test:full", "-w", ws] });
      continue;
    }

    const cover = COVERED_ELSEWHERE.find((c) => c.workspace === ws);
    if (!cover) {
      faults.push(`${ws} is a declared workspace and defines no \`test:full\` script. Either give it `
        + `one, or add it to COVERED_ELSEWHERE in scripts/test-full.mjs naming the corpus that runs `
        + `its tests — which is checked, so the claim has to be true.`);
      continue;
    }
    corpora.push({ name: ws, kind: "covered", cover });
  }

  const files = providerFiles ?? providerTestFiles(root);
  corpora.push({
    name: "providers",
    kind: "files",
    files,
    argv: ["node", "scripts/test-run.mjs", "node", "--test", ...files],
  });

  // ── THE EXEMPTIONS, CHECKED ────────────────────────────────────────────────────────────────────
  for (const c of corpora.filter((x) => x.kind === "covered")) {
    const covering = corpora.find((x) => x.name === c.cover.corpus);
    if (!covering || !Array.isArray(covering.files)) {
      faults.push(`${c.name} is recorded as covered by the \`${c.cover.corpus}\` corpus, and this `
        + `command has no such corpus with a file list to check that against.`);
      continue;
    }
    const own = covering.files.filter((f) => f.startsWith(c.name + "/"));
    // BOTH HALVES. A workspace that lost its own tests would pass a check that only asked whether
    // the covering corpus was missing any of them, because nothing is missing from nothing.
    const here = existsSync(join(root, c.name, "test"))
      ? readdirSync(join(root, c.name, "test")).filter((f) => f.endsWith(".test.mjs")).length : 0;
    if (!here) {
      faults.push(`${c.name} is recorded as covered by the \`${c.cover.corpus}\` corpus, but it has `
        + `no test files of its own, so that claim covers nothing. Remove the entry or restore the tests.`);
    } else if (own.length !== here) {
      faults.push(`${c.name} is recorded as covered by the \`${c.cover.corpus}\` corpus, which reaches `
        + `${own.length} of its ${here} test file(s). The exemption is no longer true.`);
    }
    c.reaches = own.length;
    c.hasTests = here;
  }

  return { corpora, faults };
}

function main() {
  const only = (() => { const i = process.argv.indexOf("--only"); return i === -1 ? null : process.argv[i + 1]; })();
  const listOnly = process.argv.includes("--list");
  const { corpora, faults } = plan();

  // FAULTS BEFORE ANYTHING RUNS. A missing corpus discovered after a green suite reads as an
  // afterthought; discovered first, it is the answer.
  if (faults.length) {
    console.error(`\ntest-full: ${faults.length} declared workspace(s) this command cannot account for:\n`);
    for (const f of faults) console.error(`  - ${f}`);
    console.error("");
    process.exit(1);
  }

  const chosen = only ? corpora.filter((c) => c.name === only || c.name.endsWith("/" + only)) : corpora;
  if (only && !chosen.length) {
    console.error(`test-full: no corpus named ${only}. Known: ${corpora.map((c) => c.name).join(", ")}`);
    process.exit(2);
  }

  if (listOnly) {
    for (const c of chosen) {
      console.log(c.kind === "covered"
        ? `  ${c.name}: covered by the ${c.cover.corpus} corpus (${c.reaches}/${c.hasTests} file(s))`
        : `  ${c.name}: ${c.kind === "files" ? `${c.files.length} file(s)` : "workspace script"}`);
    }
    return;
  }

  const ran = [];
  for (const c of chosen) {
    if (c.kind === "covered") { ran.push({ ...c, status: "covered" }); continue; }
    console.log(`\n──── ${c.name} ────`);
    // STDIO INHERITED, NOT CAPTURED. CI reads the child stream for the corpus-guard markers, and a
    // runner that buffered its children would take those markers out of the log the check greps.
    const r = spawnSync(c.argv[0], c.argv.slice(1), { cwd: ROOT, stdio: "inherit" });
    ran.push({ ...c, status: r.status === 0 ? "ok" : "FAILED", code: r.status });
  }

  // ── THE SUMMARY, AT THE END, ON STDOUT ─────────────────────────────────────────────────────────
  // The point of the whole file. A reader who scrolls to the bottom of a long run sees every corpus
  // this command knows about and what became of it, so "the full suite is green" is a claim they can
  // check rather than one they have to trust.
  console.log(`\n──── what test-full ran ────`);
  for (const c of ran) {
    if (c.status === "covered") {
      console.log(`  covered  ${c.name} — ${c.hasTests} file(s), run by the ${c.cover.corpus} corpus: ${c.cover.why}`);
    } else {
      const n = c.kind === "files" ? `${c.files.length} file(s)` : "workspace suite";
      console.log(`  ${c.status === "ok" ? "ran    " : "FAILED "}  ${c.name} — ${n}${c.code ? ` (exit ${c.code})` : ""}`);
    }
  }
  const bad = ran.filter((c) => c.status === "FAILED");
  console.log(bad.length ? `\n${bad.length} corpus/corpora failed.` : `\nEvery corpus above was run or accounted for.`);
  if (bad.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

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
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

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

/**
 * ── SHARDING, AND WHY IT CANNOT SILENTLY DROP A FILE ──────────────────────────────────────────────
 *
 * The offline suite was the whole wall clock of CI: 12.8 minutes against 4.3 for the portal bundle and
 * under one each for the other two jobs, which run beside it. Nearly all of that is `driver`, 925 of the
 * ~980 test files in the tree, executed in one serial job. Agents write faster than that gate opens, so
 * the gate — not the work — set the pace of the day.
 *
 * A shard is DEALT BY MEASURED DURATION: the files go out longest first, each to the shard with the
 * least time dealt so far, ties to the lower shard, from the table in `scripts/test-durations.json`.
 * Every file is dealt exactly once, so the shards are exhaustive and disjoint by construction, for any
 * n and any table — the union of the shards is the whole list as a property of the deal, not as
 * something a check has to confirm afterwards. Every shard reads the same committed table, so every
 * shard computes the same deal.
 *
 * It replaced a slice by index (`index % n`), which interleaved the sorted list and still left the
 * longest shard about twice the shortest: measured over 38 green runs, 2026-11-11 to 2026-11-17, a
 * median of 10.4 minutes against 5.3, while the four summed to 29.1. The required checks wait for the
 * longest.
 *
 * A TABLE THAT IS STALE COSTS BALANCE, NEVER COVERAGE. A file the table does not name is dealt at the
 * median of the files it does name, so it lands in exactly one shard like any other, and every shard's
 * log says how many files that was. `scripts/measure-test-durations.mjs --run <id> --write` rebuilds the
 * table from what a CI run measured.
 *
 * WHAT IS NOT SHARDED, and why that is stated rather than assumed. Only a corpus whose own test script
 * is the plain `node --test test/*.test.mjs` shape can be expressed as an explicit file list and cut up
 * this way. `portal-ui` runs a typecheck first and drives `.test.ts` through `--experimental-strip-types`,
 * so it is not that shape: it runs WHOLE, on shard 1, and says so on every other shard rather than
 * disappearing from them. Anything else that stops matching the shape falls into the same branch and is
 * reported, never quietly skipped.
 */
const PLAIN_GLOB = /^node \.\.\/scripts\/test-run\.mjs node --test test\/\*\.test\.mjs$/;

export const DURATIONS_FILE = "scripts/test-durations.json";

/** The measured table (milliseconds per file), or an empty one: a missing table deals every file at one cost. */
export function readDurations(root = ROOT) {
  try {
    const table = JSON.parse(readFileSync(join(root, DURATIONS_FILE), "utf8"));
    return { measured: table.measured ?? null, ms: table.ms ?? {} };
  } catch { return { measured: null, ms: {} }; }
}

const timed = (ms, f) => Number.isFinite(ms[f]) && ms[f] >= 0;

/** Shard i of n of `list`, dealt by `ms` (see above). Returned in `list`'s own order. */
export function shardByDuration(list, i, n, ms = {}) {
  const known = list.filter((f) => timed(ms, f)).map((f) => ms[f]).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 1;
  const deal = list.map((f, at) => ({ f, at, cost: timed(ms, f) ? ms[f] : median }))
    .sort((a, b) => b.cost - a.cost || a.at - b.at);
  const load = new Array(n).fill(0);
  const owner = new Map();
  for (const { f, cost } of deal) {
    let k = 0;
    for (let j = 1; j < n; j++) if (load[j] < load[k]) k = j;
    load[k] += cost;
    owner.set(f, k);
  }
  return list.filter((f) => owner.get(f) === i - 1);
}

/** How many files of `list` the table does not name. */
export const untimedCount = (list, ms = {}) => list.filter((f) => !timed(ms, f)).length;

function workspaceTestFiles(root, ws) {
  const dir = join(root, ws, "test");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => `${ws}/test/${f}`);
}

/** Is this workspace's `test:full` the plain shape we can express as a file list? */
function isShardable(root, ws) {
  try {
    const scripts = JSON.parse(readFileSync(join(root, ws, "package.json"), "utf8")).scripts ?? {};
    let cmd = scripts["test:full"] ?? "";
    // `test:full` is often just `npm run test`; follow that one hop.
    const hop = cmd.match(/^npm run (\S+)$/);
    if (hop) cmd = scripts[hop[1]] ?? "";
    return PLAIN_GLOB.test(cmd.trim());
  } catch { return false; }
}

/** Every file the shards deal, corpus by corpus: what `measure-test-durations` needs a figure for. */
export function shardableFiles(corpora, root = ROOT) {
  return corpora.flatMap((c) => (c.kind === "files" ? c.files
    : c.kind === "workspace" && isShardable(root, c.name) ? workspaceTestFiles(root, c.name) : []));
}

/**
 * Rewrite the plan for one shard. Every corpus stays in the list and is reported; what changes is how
 * many of its files THIS shard runs, and how many of them the table did not name.
 */
export function applyShard(corpora, { i, n }, root = ROOT, ms = readDurations(root).ms) {
  return corpora.map((c) => {
    if (c.kind === "covered") return c;
    if (c.kind === "files") {
      const mine = shardByDuration(c.files, i, n, ms);
      return { ...c, files: mine, total: c.files.length, untimed: untimedCount(c.files, ms),
               argv: ["node", "scripts/test-run.mjs", "node", "--test", ...mine] };
    }
    if (c.kind === "workspace" && isShardable(root, c.name)) {
      const all = workspaceTestFiles(root, c.name);
      const mine = shardByDuration(all, i, n, ms);
      return { ...c, kind: "files", files: mine, total: all.length, untimed: untimedCount(all, ms),
               argv: ["node", "scripts/test-run.mjs", "node", "--test", ...mine] };
    }
    // Not expressible as a file list: run it whole, once, on shard 1.
    return { ...c, wholeOnShard: 1, skippedHere: i !== 1 };
  });
}

function main() {
  const only = (() => { const i = process.argv.indexOf("--only"); return i === -1 ? null : process.argv[i + 1]; })();
  const listOnly = process.argv.includes("--list");
  const shard = (() => {
    const i = process.argv.indexOf("--shard");
    if (i === -1) return null;
    const m = String(process.argv[i + 1] ?? "").match(/^(\d+)\/(\d+)$/);
    if (!m) { console.error("test-full: --shard wants i/n, e.g. --shard 2/4"); process.exit(2); }
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a < 1 || b < 1 || a > b) { console.error(`test-full: --shard ${a}/${b} is not a shard of anything`); process.exit(2); }
    return { i: a, n: b };
  })();
  const { corpora: full, faults } = plan();
  const durations = readDurations(ROOT);
  const corpora = shard ? applyShard(full, shard, ROOT, durations.ms) : full;

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

  // SAID BEFORE A LISTING TOO, so the deal and how much of it the table measured can be read without running a shard.
  if (shard) {
    const dealt = corpora.filter((c) => c.kind === "files");
    const total = dealt.reduce((a, c) => a + c.total, 0);
    const untimed = dealt.reduce((a, c) => a + c.untimed, 0);
    console.log(`\ntest-full: shard ${shard.i} of ${shard.n} — files are dealt by measured duration, longest first to the `
      + `shard with the least so far, so the shards are disjoint and their union is the whole list. `
      + `${DURATIONS_FILE} (measured ${durations.measured ?? "never"}) names ${total - untimed} of the ${total} file(s); `
      + `${untimed} have no recorded duration and were dealt at the median.`);
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
    if (c.skippedHere) { ran.push({ ...c, status: "elsewhere" }); continue; }
    if (c.kind === "files" && c.files.length === 0) { ran.push({ ...c, status: "empty" }); continue; }
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
    } else if (c.status === "elsewhere") {
      console.log(`  shard ${c.wholeOnShard}  ${c.name} — not expressible as a file list, so it runs WHOLE on shard ${c.wholeOnShard}, not here. It is not missing from this run; it is somewhere else in it.`);
    } else if (c.status === "empty") {
      console.log(`  none     ${c.name} — 0 of ${c.total} file(s) fell in this shard. Not an absence: the other shards hold them.`);
    } else {
      const n = c.kind === "files"
        ? `${c.files.length}${c.total != null ? ` of ${c.total}` : ""} file(s)`
        : "workspace suite";
      console.log(`  ${c.status === "ok" ? "ran    " : "FAILED "}  ${c.name} — ${n}${c.code ? ` (exit ${c.code})` : ""}`);
    }
  }
  const bad = ran.filter((c) => c.status === "FAILED");
  console.log(bad.length
    ? `\n${bad.length} corpus/corpora failed.`
    : shard
      ? `\nEvery corpus above was run, accounted for, or named as belonging to another shard. This shard alone is not the suite: the gate is every shard green.`
      : `\nEvery corpus above was run or accounted for.`);
  if (bad.length) process.exit(1);
}

if (isEntrypoint(import.meta.url)) main();

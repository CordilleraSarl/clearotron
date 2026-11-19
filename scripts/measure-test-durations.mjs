#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// measure-test-durations.mjs — build the table `test-full --shard` deals files by, from what a CI run measured.
//
//   node scripts/measure-test-durations.mjs --run <CI run id> [--repo <owner/name>] [--write]
//
// MEASURED WHERE THE SHARDS RUN. Each shard of the offline suite runs with `CT_DURATIONS_DIR` set, so
// `scripts/test-durations-reporter.mjs` writes every file's test time beside the shard's log, and CI keeps both. This
// downloads those files with `gh run download`, takes one figure per file, and writes `scripts/test-durations.json`.
// A table timed on a developer's machine measures that machine and whatever else it was running; the hosted runners
// are the machines whose wait the deal is meant to shorten.
//
// NOT A MINTER. Nothing here derives from the tree: the same tree measures differently from run to run. So it is not
// named `mint-*` and `generated-files-are-current` does not run it. A stale table costs balance, never coverage: a file
// it does not name still lands in exactly one shard, at the median, and the shard's log says how many did.
//
// A RUN THAT MEASURED TOO LITTLE IS REFUSED, not written: a table naming a fraction of the files would deal the rest at
// a median taken from a few, which is a guess presented as a measurement. Below nine in ten, it exits 1.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
import { plan, shardableFiles, DURATIONS_FILE, ROOT } from "./test-full.mjs";

const argAfter = (flag, fallback = null) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
};

/** Every `*.jsonl` line under `dir`, at any depth, as `{file, ms}`. */
function readMeasured(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { out.push(...readMeasured(p)); continue; }
    if (!name.endsWith(".jsonl")) continue;
    for (const line of readFileSync(p, "utf8").split("\n").filter(Boolean)) {
      try { const row = JSON.parse(line); if (row.file && Number.isFinite(row.ms)) out.push(row); } catch { /* a torn last line */ }
    }
  }
  return out;
}

/** PURE. One figure per file, the larger where a file was measured twice, keyed in sorted order. */
export function tableOf(rows) {
  const ms = new Map();
  for (const { file, ms: v } of rows) ms.set(file, Math.max(ms.get(file) ?? 0, v));
  return Object.fromEntries([...ms.keys()].sort().map((f) => [f, ms.get(f)]));
}

function main() {
  const run = argAfter("--run");
  const repo = argAfter("--repo", "CordilleraSarl/clearotron");
  if (!/^\d+$/.test(String(run))) { console.error("measure-test-durations: --run wants a CI run id"); process.exit(2); }
  const { corpora, faults } = plan();
  if (faults.length) { console.error(`measure-test-durations: test-full cannot account for its corpora:\n  ${faults.join("\n  ")}`); process.exit(2); }
  const dealt = new Set(shardableFiles(corpora));

  const dir = mkdtempSync(join(tmpdir(), "test-durations-"));
  let rows;
  try {
    execFileSync("gh", ["run", "download", run, "-R", repo, "-p", "suite-log-*", "-D", dir], { stdio: ["ignore", "ignore", "inherit"] });
    rows = readMeasured(dir);
  } catch (e) {
    console.error(`measure-test-durations: could not download run ${run}'s shard files from ${repo}: ${e.message.split("\n")[0]}`);
    process.exit(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const ms = Object.fromEntries(Object.entries(tableOf(rows)).filter(([f]) => dealt.has(f)));
  const named = Object.keys(ms).length;
  const total = Object.values(ms).reduce((a, b) => a + b, 0);
  console.log(`measure-test-durations: run ${run} measured ${named} of the ${dealt.size} file(s) the shards deal, ${Math.round(total / 1000)} s of test time in all`);
  if (named < dealt.size * 0.9) {
    console.error("measure-test-durations: fewer than nine in ten files were measured, so this run cannot stand for the suite. Nothing written.");
    process.exit(1);
  }
  if (!process.argv.includes("--write")) { console.log("measure-test-durations: dry run, nothing written. Pass --write to replace the table."); return; }
  const table = { measured: new Date().toISOString().slice(0, 10), run: Number(run), files: named, ms };
  writeFileSync(join(ROOT, DURATIONS_FILE), `${JSON.stringify(table, null, 1)}\n`);
  console.log(`measure-test-durations: wrote ${DURATIONS_FILE}`);
}

if (isEntrypoint(import.meta.url)) main();

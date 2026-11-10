// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ladder-record.mjs — what the stage ladder does on every repair path, written down so a change can be compared.
//
//   node driver/test/ladder-record/ladder-record.mjs <checkout> <out-dir> [--jobs N] [--only id,id]
//   node driver/test/ladder-record/ladder-record.mjs compare <out-dir-before> <out-dir-after>
//
// The behaviour snapshot runs every scenario with retries off, so it never reaches the ladder's retries and rescues.
// This drives runStage (gateway.mjs) directly with a scripted engine and retries on, one scenario per path, and
// records each turn's arguments, the stage rows, the run events, the files and the return value. `compare` prints
// the scenarios whose records differ. Each record also lists the code lines of runStage, runStageLadder and the
// modules carved out of it under driver/ladder/ that no scenario reached: equal means equal on the lines that ran.
// No engine or register is called, and the network is refused: an attempt is written into the scenario's record.
// It reports and does not judge.
import { execFile } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { SCENARIOS } from "./scenarios.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
if (process.argv[2] === "compare") {
  const [a, b] = process.argv.slice(3);
  const names = (d) => readdirSync(d).filter((f) => f.endsWith(".json")).sort();
  const all = [...new Set([...names(a), ...names(b)])];
  const differ = all.filter((f) => { try { return readFileSync(join(a, f), "utf8") !== readFileSync(join(b, f), "utf8"); } catch { return true; } });
  for (const f of differ) console.log(`differs: ${f.replace(/\.json$/, "")}`);
  console.log(`ladder-record: ${differ.length} of ${all.length} scenario(s) differ`);
  process.exit(0);
}
const [repo, outDir, ...rest] = process.argv.slice(2);
const jobs = Number(rest[rest.indexOf("--jobs") + 1]) || 3;
const only = rest.includes("--only") ? rest[rest.indexOf("--only") + 1].split(",") : null;
rmSync(outDir, { recursive: true, force: true });
const cov = join(outDir, "coverage");
mkdirSync(cov, { recursive: true });
const ids = Object.keys(SCENARIOS).filter((id) => !only || only.includes(id));
// A fixed-length name: the messages a turn receives carry this path, and a dispatch record counts their bytes.
const scratch = join(tmpdir(), `ladder-${createHash("sha256").update(`${outDir}:${process.pid}`).digest("hex").slice(0, 12)}`);

const runOne = (id) => new Promise((done) => {
  const root = join(scratch, id), home = join(scratch, `${id}-home`);
  mkdirSync(home, { recursive: true });
  execFile(process.execPath, [join(HERE, "scenario.mjs"), repo, id, join(outDir, `${id}.json`), root], {
    cwd: repo, timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
    // The snapshot's own network guard: a connection to anywhere but this machine is refused and written to the
    // log, which the scenario copies into its record, so "no network is called" is checked rather than stated.
    env: { PATH: process.env.PATH, HOME: home, TMPDIR: join(scratch, `${id}-tmp`), LANG: "C.UTF-8", TZ: "UTC", NODE_V8_COVERAGE: cov,
      NODE_OPTIONS: `--import=${join(HERE, "..", "snapshot", "no-network.mjs")} --no-warnings`, BEHAVIOUR_SNAPSHOT_NET_LOG: join(scratch, `${id}-net.log`) },
  }, (err, stdout, stderr) => done({ id, err: err ? `${err.code ?? ""} ${String(stderr).slice(-400)}` : null }));
});
for (const id of ids) mkdirSync(join(scratch, `${id}-tmp`), { recursive: true });
const results = [];
for (let i = 0; i < ids.length; i += jobs) results.push(...await Promise.all(ids.slice(i, i + jobs).map(runOne)));
for (const r of results) if (r.err) console.log(`FAILED ${r.id}: ${r.err}`);

// Which code lines of runStage and runStageLadder no scenario reached.
const { executedLines } = await import(pathToFileURL(join(repo, "driver/test/snapshot/behaviour-snapshot.mjs")).href);
const gwPath = join(repo, "driver/gateway.mjs");
const src = readFileSync(gwPath, "utf8");
const seen = new Set();
for (const f of readdirSync(cov)) for (const e of JSON.parse(readFileSync(join(cov, f), "utf8")).result ?? [])
  if (e.url === pathToFileURL(gwPath).href) for (const l of executedLines(src, e.functions)) seen.add(l);
const lines = src.split("\n");
const start = lines.findIndex((l) => l.startsWith("export async function runStage(")) + 1;
const ladder = lines.findIndex((l) => l.startsWith("async function runStageLadder(")) + 1;
let end = ladder; while (lines[end - 1] !== "}") end++;
const code = (t) => { const x = t.trim(); return x && !x.startsWith("//") && !x.startsWith("*") && !x.startsWith("/*") && !/^[})\];,]+$/.test(x); };
const unreached = [];
for (let n = start; n <= end; n++) if (code(lines[n - 1]) && !seen.has(n)) unreached.push(n);
const total = [...Array(end - start + 1).keys()].map((k) => k + start).filter((n) => code(lines[n - 1])).length;
// And every code line of the modules carved out of the ladder, under driver/ladder/.
const carvedDir = join(repo, "driver/ladder");
const carved = [];
try {
  for (const f of readdirSync(carvedDir).filter((x) => x.endsWith(".mjs")).sort()) {
    const p = join(carvedDir, f), text = readFileSync(p, "utf8"), ls = text.split("\n"), hit = new Set();
    for (const c of readdirSync(cov)) for (const e of JSON.parse(readFileSync(join(cov, c), "utf8")).result ?? [])
      if (e.url === pathToFileURL(p).href) for (const l of executedLines(text, e.functions)) hit.add(l);
    ls.forEach((t, k) => { if (code(t) && !/^(import|export \{)/.test(t.trim()) && !hit.has(k + 1)) carved.push(`ladder/${f}:${k + 1}: ${t.trim().slice(0, 120)}`); });
  }
} catch { /* no carved modules yet */ }
writeFileSync(join(outDir, "unreached.txt"), [...unreached.map((n) => `gateway.mjs:${n}: ${lines[n - 1].trim().slice(0, 140)}`), ...carved].join("\n") + "\n");
console.log(`carved-module code lines unreached: ${carved.length}`);
console.log(`scenarios ${ids.length}, failed ${results.filter((r) => r.err).length}; ladder code lines ${total}, unreached ${unreached.length}`);
rmSync(scratch, { recursive: true, force: true });

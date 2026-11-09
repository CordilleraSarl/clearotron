// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish-compare.mjs — does a saved run still publish to the same page, workbook and email?
//
//   node driver/test/snapshot/publish-compare.mjs record --out <dir> [--repo <checkout>] [--run <saved-run-dir>]...
//   node driver/test/snapshot/publish-compare.mjs compare <base-dir> <head-dir>
//
// Each sample is copied, then published under a frozen clock into a throwaway report folder. Nothing is normalised but the
// throwaway folder's own name and a workbook's two generation stamps, so a changed date, word or cell shows as a difference.
// A saved run is a folder holding `meta.json` and `run/`, the shape `demo/` uses. It makes no model turn and no register call.
//
// IT REPORTS AND DOES NOT JUDGE: exit 0 means no difference was found in the samples given, and a sample that could not
// publish is a could-not-look, which exits 2.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { workbookEntryText, zipEntries } from "./workbook-entries.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const sha = (b) => createHash("sha256").update(b).digest("hex");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out.sort();
}

/** One published file's fingerprint: text exactly, a workbook entry by entry, anything else by its bytes. */
function fingerprint(file, root) {
  const buf = readFileSync(file);
  const clean = (t) => t.split(root).join("<ROOT>");
  if (file.endsWith(".xlsx")) return Object.fromEntries(zipEntries(buf).map(([n, b]) => [n, sha(clean(workbookEntryText(n, b)))]));
  return /\.(html?|md|json|txt|csv|svg)$/.test(file) ? sha(clean(buf.toString("utf8"))) : sha(buf);
}

function recordSample(sample, repo, out) {
  const root = mkdtempSync(join(tmpdir(), "publish-compare-"));
  try {
    const copy = join(root, "sample"), pool = join(root, "pool"), home = join(root, "home"), resultFile = join(root, "result.json"), specFile = join(root, "spec.json");
    cpSync(sample.dir, copy, { recursive: true });
    mkdirSync(pool); mkdirSync(home);
    writeFileSync(specFile, JSON.stringify({ driver: join(repo, "driver"), metaFile: join(copy, "meta.json"), runDir: join(copy, "run"), pool, resultFile }));
    const env = { PATH: process.env.PATH, HOME: home, TMPDIR: root, TZ: "UTC", CLEAROTRON_NO_ENV_FILE: "1" };
    execFileSync(process.execPath, [join(HERE, "publish-scenario.mjs"), specFile], { env, cwd: root, stdio: ["ignore", "ignore", "pipe"], timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
    const files = Object.fromEntries(walk(pool).map((f) => [relative(pool, f).split(sep).join("/"), fingerprint(f, root)]));
    const { email } = JSON.parse(readFileSync(resultFile, "utf8"));
    const record = { name: sample.name, files, email: Object.fromEntries(Object.entries(email).map(([k, v]) => [k, sha(String(v).split(root).join("<ROOT>"))])) };
    writeFileSync(join(out, `${sample.name}.json`), JSON.stringify(record, null, 1) + "\n");
    return { name: sample.name, files: Object.keys(files).length };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function differences(a, b, path = "") {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b ? [] : [path];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((k) => differences(a[k] ?? null, b[k] ?? null, path ? `${path} › ${k}` : k));
}

function main(argv) {
  const at = (flag) => { const i = argv.indexOf(flag); return i < 0 ? null : argv[i + 1]; };
  if (argv[0] === "record") {
    const repo = resolve(at("--repo") ?? join(HERE, "..", "..", ".."));
    const out = resolve(at("--out"));
    mkdirSync(out, { recursive: true });
    const demo = join(repo, "demo");
    const samples = readdirSync(demo).filter((n) => existsSync(join(demo, n, "meta.json"))).map((n) => ({ name: n, dir: join(demo, n) }));
    argv.forEach((a, i) => { if (a === "--run") samples.push({ name: basename(resolve(argv[i + 1])), dir: resolve(argv[i + 1]) }); });
    let failed = 0;
    for (const s of samples) {
      try { const r = recordSample(s, repo, out); console.log(`${r.name}: published ${r.files} file(s)`); }
      catch (e) { failed++; console.error(`${s.name}: COULD NOT PUBLISH: ${String(e?.stderr ?? e?.message ?? e).slice(-1200)}`); }
    }
    return failed ? 2 : 0;
  }
  if (argv[0] === "compare") {
    const [base, head] = [argv[1], argv[2]].map((d) => resolve(d));
    const names = [...new Set([...readdirSync(base), ...readdirSync(head)])].filter((n) => n.endsWith(".json")).sort();
    if (!names.length) { console.error("publish-compare: neither folder holds a record; this is a could-not-look, not a clean comparison"); return 2; }
    const read = (d, n) => (existsSync(join(d, n)) ? JSON.parse(readFileSync(join(d, n), "utf8")) : {});
    let total = 0;
    for (const n of names) {
      const diff = differences(read(base, n), read(head, n));
      total += diff.length;
      console.log(`${n.replace(/\.json$/, "")}: ${diff.length} difference(s)`);
      for (const d of diff) console.log(`  ${d}`);
    }
    console.log(`publish-compare: ${total} difference(s) across ${names.length} sample(s)`);
    return total ? 1 : 0;
  }
  console.error("usage: publish-compare.mjs record --out <dir> [--repo <checkout>] [--run <saved-run-dir>]...\n       publish-compare.mjs compare <base-dir> <head-dir>");
  return 2;
}

process.exit(main(process.argv.slice(2)));

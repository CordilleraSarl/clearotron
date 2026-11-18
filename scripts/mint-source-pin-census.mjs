#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// RE-MINT THE SOURCE-PIN CENSUS — which test files pin product source text, and how many pins each holds. A floor.
//
//   node scripts/mint-source-pin-census.mjs            # report the delta, change nothing
//   node scripts/mint-source-pin-census.mjs --check    # ... and exit 1 if the file is out of date
//   node scripts/mint-source-pin-census.mjs --apply    # write it
//
// WHY A COUNT. A test that asserts on a product file's TEXT goes red when that text moves, reflows or is renamed, though
// no run behaves differently, and every carve of a long function has to repoint such pins before it can land. About one
// test file in five pinned source on 2026-11-18 and nothing counted them, so the number could only grow unseen. Each pin is
// retired by the change that makes its behaviour reachable by a test; this records where they are so that can be seen.
//
// WHAT THE MATCHER SEES, said rather than found later. Two shapes, per test file under `driver/test` and `mcp-server/test`:
//   - a call to `driverSource(` (driver/test/driver-source.mjs), the house helper for reading the driver's text;
//   - a `readFileSync(` whose own argument names a product file by a path literal: a `../…` path outside any `test/`
//     folder, a path under `driver/`, `bin/`, `shared/`, `scripts/`, `mcp-server/`, `providers/` or `portal-ui/`, or a
//     `join(…, "<folder>", …, "<file>.mjs")`.
// A test that reads source through a variable holding the path is not seen, so the true count is at least this floor.
// Measured on 2026-11-18: 299 files (151 call `driverSource`, 148 read a product file by a literal path), against the
// 317 an audit counted by hand.
//
// THE ONLY REASON TO RUN `--apply` IS THAT THE NUMBER WENT DOWN. The floor arm in
// driver/test/the-tests-that-pin-source-are-a-floor.test.mjs reads the committed file and refuses a file that pins more
// than it is recorded with, so minting upward records a regression rather than absorbing it.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { publishedOf, publishedReader } from "../shared/reference-guard-classes.mjs";
import { trackedFiles, skipReason } from "../shared/tracked-files.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE = join(ROOT, "driver/test/fixtures/source-pin-census.json");
const GUARD = "source-pin-census";

const PRODUCT_PATH = new RegExp([
  String.raw`["'\x60](?:\.\.\/)+(?![\w-]*\/?test\/)[\w./-]+\.(?:mjs|js|ts|tsx|css)["'\x60]`,
  String.raw`["'\x60](?:driver|bin|shared|scripts|mcp-server|providers|portal-ui)\/(?![\w./-]*\btest\/)[\w./-]+\.(?:mjs|js|ts|tsx|css)["'\x60]`,
  String.raw`join\([^)]*["'](?:driver|bin|shared|scripts|mcp-server|providers|portal-ui)["'][^)]*["'][\w.-]+\.(?:mjs|js|ts|tsx|css)["']\)`,
].join("|"));

/** [driverSource calls, literal source reads] in one test file's text. PURE. */
export function pinsIn(text) {
  const s = String(text ?? "");
  const calls = (s.match(/\bdriverSource\(/g) ?? []).length;
  let reads = 0;
  for (const m of s.matchAll(/readFileSync\(([^;\n]{0,240})/g)) if (PRODUCT_PATH.test(m[1])) reads++;
  return [calls, reads];
}

/** The tree's census: { total: files that pin, files: { path: [calls, reads] } }, or null outside a checkout. */
export function mint(root = ROOT) {
  const tracked = trackedFiles(GUARD, { root, pathspec: ["driver/test", "mcp-server/test"] });
  if (tracked === null) return null;
  const p = publishedOf(tracked.filter((f) => f.endsWith(".test.mjs")), root);
  if (p.error) throw new Error(`mint-source-pin-census: ${p.error}`);
  // Test files the index carries and HEAD does not are laid over this checkout, not published in it: said, and not counted.
  if (p.laid) console.log(`mint-source-pin-census: ${p.laid} tracked test file(s) are not in HEAD — laid over this checkout and not counted`);
  const read = publishedReader(root, (f) => readFileSync(join(root, f), "utf8"));
  const files = {};
  for (const f of [...p.files].sort()) {
    const counts = pinsIn(read(f));
    if (counts[0] || counts[1]) files[f] = counts;
  }
  return { total: Object.keys(files).length, files };
}

function main() {
  const apply = process.argv.includes("--apply");
  const check = process.argv.includes("--check");
  let now;
  try { now = mint(); } catch (e) { console.error(e.message); process.exit(2); }
  if (now === null) { console.error(`mint-source-pin-census: ${skipReason(GUARD)}`); process.exit(2); }
  let was = null;
  try { was = JSON.parse(readFileSync(FIXTURE, "utf8")); } catch { /* first mint */ }
  const calls = Object.values(now.files).filter(([c]) => c).length;
  console.log(`source pins: ${now.total} test file(s), ${calls} calling driverSource, ${now.total - calls} reading a product file by path`);
  const next = JSON.stringify(now, null, 2) + "\n";
  if (was && JSON.stringify(was, null, 2) + "\n" === next) { console.log("the census is current"); return; }
  if (was) console.log(`total ${was.total} → ${now.total}`);
  if (apply) { writeFileSync(FIXTURE, next); console.log("written"); return; }
  console.log("re-run with --apply to write it");
  if (check) process.exit(1);
}

if (isEntrypoint(import.meta.url)) main();

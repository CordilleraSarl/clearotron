// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A dynamic import() of a FILESYSTEM PATH must go through pathToFileURL.
//
// `import("C:\\Users\\x\\clearotron\\driver\\publish\\report-registry.mjs")` is not a specifier the ESM
// loader accepts: a drive-letter path parses as a URL whose scheme is `c:`, and the loader refuses that
// scheme. The demo crashed on the owner's own machine at the first such call. On POSIX the same code works
// by accident, because there an absolute path and a relative specifier are close enough to get away with
// it — which is exactly why this cannot be left to review to catch.
//
// ✕ A RELATIVE SPECIFIER IS NOT THE DEFECT AND IS NOT SWEPT. `import("../driver/profiles.mjs")` is a
// module specifier, is portable, and is correct as written. The defect is a computed absolute PATH.
//
// THE GUARD ACCOUNTS FOR EVERY COMPUTED IMPORT rather than matching one spelling. It used to match
// `import(join(`, the shape the original sweep repaired, and so could not see a path built any other way:
// two tests imported a raw path from inside a template, and read nothing wrong. Now every import( argument
// in the tracked corpus is either a form that is portable by construction, or named in ACCOUNTED with the
// reason it is safe. Anything else is unaccounted, and the guard says where.
//
// NO WINDOWS MACHINE RUNS THIS. What is proved here is proved on Linux: that Node's loader refuses a raw
// drive-letter path for its scheme (the crash, reproduced), that the same path as a file URL gets past that
// check, and that Windows paths round-trip through a file URL. Together with the guard — every site builds
// its specifier that way — that is the argument for Windows. A network share is proved by the round trip
// only: this platform's loader refuses any file URL with a host, so importing one here would fail for "this
// is Linux", not for the property.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { trackedFiles } from "../../shared/tracked-files.mjs";
import { ENGINE_BINARIES, engineAdapterSpecifier } from "../driver.config.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const GUARD = "a dynamic import of a path is a file url";

// ✕ THIS FILE IS EXCLUDED FROM ITS OWN POPULATION, and the exclusion is the point rather than a
// convenience: it quotes the shapes it looks for, so it would flag itself. That is invisible until the
// file is COMMITTED — `git ls-files` cannot see an untracked file — so it would pass locally on the run
// that writes it and fail in CI on the run that lands it. Excluded by path, which is checkable.
const SELF = "driver/test/a-dynamic-import-of-a-path-is-a-file-url.test.mjs";

// Every import( on a code line, with its argument read to the matching paren. Quote-aware, so a paren
// inside a string does not end it; comment lines are skipped because they describe imports, not make them.
function importsIn(src) {
  const out = [];
  src.split("\n").forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    for (const m of l.matchAll(/\bimport\s*\(/g)) {
      let j = m.index + m[0].length, depth = 1, q = null, arg = "";
      for (; j < l.length; j++) {
        const c = l[j];
        if (q) { if (c === "\\") { arg += c + (l[j + 1] ?? ""); j++; continue; } if (c === q) q = null; }
        else if (c === "'" || c === '"' || c === "`") q = c;
        else if (c === "(") depth++;
        else if (c === ")") { depth--; if (!depth) break; }
        arg += c;
      }
      out.push({ line: i + 1, arg: arg.trim(), closed: depth === 0 });
    }
  });
  return out;
}

// Portable by construction. An import written into a child script's source is judged by what it writes.
function portable(a) {
  const child = /^\$\{JSON\.stringify\((.*)\)\}$/.exec(a);
  if (child) return portable(child[1]);
  return /^(['"])(\.\.?\/[^'"]*|node:[^'"]*|@?[a-z][^'":]*)\1$/.test(a)     // a quoted relative, built-in or bare specifier; a bare one has no colon
    || /^`\.\.?\//.test(a)                                                  // a template that opens relative
    || /^pathToFileURL\(.*\)\.href$/.test(a)                                // a file URL from pathToFileURL
    || /^`\$\{pathToFileURL\(.*\)\.href\}/.test(a)                          // …heading a template that adds a query
    || /^new URL\((['"])\.\.?\/[^'"]*\1,\s*import\.meta\.url\)\.href$/.test(a); // a relative URL against this module
}

// The computed imports that are safe for a reason their shape cannot show. Keyed by file and by the
// argument exactly as written, so a line moving does not stale an entry and the argument changing does.
const ACCOUNTED = [
  ["driver/driver.config.mjs", "mod",
    "a lane core named by a relative specifier in the fixed call-site table beside it — portable as written"],
  ["driver/engine/jx-turn.mjs", "engineAdapterSpecifier(engine)", "a file URL from pathToFileURL — driven below"],
  ["driver/engine/probe.mjs", "engineAdapterSpecifier(engine)", "a file URL from pathToFileURL — driven below"],
  ["providers/_shared/lane-probe.mjs", "u",
    "the default for an injected importer; what it is handed is built by pathToFileURL, driven in lane-probe's own tests"],
  ["scripts/e2e.mjs", 'origin.protocol === "https:" ? "node:https" : "node:http"', "one of two built-in modules"],
  ["driver/test/owner-descriptor-claims-only-what-it-observes.test.mjs", "PRODUCER_URL.href", "a URL, not a path"],
  ["driver/test/preflight-engine-binary.test.mjs", "specifier", "an engine adapter specifier, asserted to be a file URL on the line before"],
  ["driver/test/product-identity.test.mjs", `'" + pathToFileURL(join(bare, "shared", "product-identity.mjs")).href + "'`,
    "a file URL from pathToFileURL, concatenated into a child script"],
];

test("every computed import() in the tracked corpus is a file URL, a portable specifier, or accounted for", (t) => {
  const all = trackedFiles(GUARD, { root: REPO, pathspec: ["*.mjs", "*.js"] });
  // null means NO CHECKOUT to read the corpus from. That is a could-not-look and it is skipped LOUDLY
  // rather than passing on an empty list — a guard whose population is zero reports a clean tree.
  if (all === null) return t.skip("no tracked corpus in this tree — the guard could not look");
  assert.ok(all.length > 100, `the tracked corpus reads as ${all.length} files — too few to be the real tree`);
  assert.ok(all.includes(SELF), "this guard's own file is not in the corpus — the exclusion is aimed at nothing");

  const sites = [];
  for (const rel of all) {
    if (rel === SELF) continue;
    let src;
    try { src = readFileSync(join(REPO, rel), "utf8"); } catch { continue; }
    for (const s of importsIn(src)) sites.push({ rel, ...s });
  }
  // THE FLOOR, on the population this guard is about. An extractor that read nothing would report a clean
  // tree; far fewer than the tree holds means the reading broke, not that the tree improved.
  const computed = sites.filter((s) => !/^(['"])[^'"]*\1$/.test(s.arg));
  assert.ok(computed.length >= 100, `only ${computed.length} computed import() arguments were read — the extractor is not reading the tree`);

  const used = new Set(), unaccounted = [];
  for (const s of sites) {
    if (!s.closed) { unaccounted.push(`${s.rel}:${s.line}  an argument that runs past its line — put it on one line or account for it`); continue; }
    if (portable(s.arg)) continue;
    const k = ACCOUNTED.findIndex(([f, a]) => f === s.rel && a === s.arg);
    if (k >= 0) { used.add(k); continue; }
    unaccounted.push(`${s.rel}:${s.line}  ${s.arg.slice(0, 100)}`);
  }
  assert.deepEqual(unaccounted, [],
    `neither a file URL nor a portable specifier, and nothing accounts for them — a raw path here fails on Windows:\n  ${unaccounted.join("\n  ")}`);
  const stale = ACCOUNTED.filter((_, k) => !used.has(k)).map(([f, a]) => `${f}  ${a}`);
  assert.deepEqual(stale, [], `ACCOUNTED names imports that are no longer there, and an entry that accounts for nothing hides the next one:\n  ${stale.join("\n  ")}`);
});

test("the engine adapter specifier the table relies on is a file URL for every engine this driver ships", () => {
  const ids = Object.keys(ENGINE_BINARIES);
  assert.ok(ids.length >= 2, `the engine table reads as ${ids.length} engine(s) — too few to be the real one`);
  for (const id of ids) assert.match(engineAdapterSpecifier(id) ?? "", /^file:\/\//, `${id}: its adapter specifier is not a file URL`);
});

test("the transformation this sweep applied is the one the loader accepts", () => {
  // The control, so the guard above is not asserting a spelling nobody checked. A file URL round-trips
  // to the same path, and the href is a string the loader takes.
  const p = join(REPO, "shared", "tracked-files.mjs");
  const href = pathToFileURL(p).href;
  assert.match(href, /^file:\/\//, "pathToFileURL must produce a file: URL, which is what import() accepts");
  assert.equal(fileURLToPath(href), p, "the URL must name the same file the path did");
});

test("importing by that specifier actually resolves a real module", async () => {
  // Drives it rather than asserting the string shape: the sweep is only worth anything if a module
  // imported this way loads.
  const mod = await import(pathToFileURL(join(REPO, "shared", "tracked-files.mjs")).href);
  assert.equal(typeof mod.trackedFiles, "function");
});

// The demo launcher's own import, where a Windows install puts it: a user name with a space, under the
// cache npx unpacks into.
const WIN_ROOT = "C:\\Users\\a b\\AppData\\Local\\npm-cache\\_npx\\1f2e\\node_modules\\clearotron";
const WIN_MODULE = win32.join(WIN_ROOT, "driver", "publish", "report-registry.mjs");

test("the demo launcher's import as a raw drive-letter path is refused for its scheme — the Windows crash, reproduced here", async () => {
  await assert.rejects(import(WIN_MODULE), (e) => e.code === "ERR_UNSUPPORTED_ESM_URL_SCHEME",
    "the loader must refuse the raw path for its `c:` scheme; that refusal is the crash this file exists for");
});

test("the same import as a file URL passes the scheme check, and all that is left is that this box has no such file", async () => {
  const href = pathToFileURL(WIN_MODULE, { windows: true }).href;
  assert.match(href, /^file:\/\/\/C:\//, `a drive-letter path must become file:///C:/…, got ${href}`);
  await assert.rejects(import(href), (e) => e.code === "ERR_MODULE_NOT_FOUND",
    "a file URL is a scheme the loader takes; the only failure left on Linux is the missing file");
});

test("Windows paths round-trip through a file URL — a space, a #, a % and a network share included", () => {
  for (const p of [WIN_MODULE,
    "C:\\Users\\a b\\my#repo\\clearotron\\bin\\example.mjs",
    "D:\\100%real\\clearotron\\shared\\tracked-files.mjs",
    "\\\\server\\share\\clearotron\\driver\\driver.config.mjs"]) {
    const href = pathToFileURL(p, { windows: true }).href;
    assert.equal(new URL(href).hash, "", `part of ${p} became a URL fragment: ${href}`);
    assert.equal(fileURLToPath(href, { windows: true }), p, `${p} did not come back from ${href}`);
  }
});

test("a quoted drive-letter path is not a package name, in either case", () => {
  // The bare branch once took any quoted specifier opening with a lower-case letter, so a lower-case
  // c:\\x\\y.mjs read as a package while the same path with C: was named, and the loader refuses both
  // for their scheme. A bare specifier carries no colon, and node: has its own branch.
  for (const a of [String.raw`"c:\\x\\y.mjs"`, String.raw`'c:/x/y.mjs'`, String.raw`"C:\\x\\y.mjs"`, String.raw`'C:/x/y.mjs'`])
    assert.equal(portable(a), false, `${a} read as portable`);
  for (const a of [`"exceljs"`, `'@modelcontextprotocol/sdk/client/index.js'`, `"node:fs"`, `"./x.mjs"`, `'../x.mjs'`])
    assert.equal(portable(a), true, `${a} read as not portable`);
});

#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// COUNT THE TESTS THAT WRITE OUT A MANUAL'S SENTENCES — per manual, how many test files hold a sentence of it as a string,
// and how many sentences.
//
//   node scripts/count-manual-pins.mjs                     # every manual under driver/skills
//   node scripts/count-manual-pins.mjs <manual.md> ...     # just these
//
// WHY. A test that writes out a manual's sentence goes red when the sentence is reworded, so a ruled wording change in a
// heavily pinned manual meant editing many test files. A manual whose pins are gathered keeps them in one fixture,
// `driver/test/ruled-sentences-<manual>.mjs`, and the tests name them from there: a wording change is one edit. This shows
// how far that has gone, manual by manual.
//
// WHAT IT SEES, said once. A string, or a chain of strings joined by `+`, of at least 25 characters and 4 words, found word
// for word in the manual with its runs of white space read as one space, in a test file that names the manual: its folder,
// and its file name unless that is SKILL.md. A test that never opens a manual and shares a string with it, a table header
// or an example label, holds nothing of the manual. A string inside a comment or a regular expression is not counted, and
// neither is one built from a variable, so the true count is at least this.
import { readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../shared/tracked-files.mjs";
import { publishedOf, publishedReader } from "../shared/reference-guard-classes.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = "count-manual-pins";

/** The manuals whose sentences are gathered, each with its fixture. */
export const GATHERED = Object.freeze({
  "driver/skills/clearance-register/unit.md": "driver/test/ruled-sentences-unit.mjs",
  "driver/skills/clearance-register/digest.md": "driver/test/ruled-sentences-digest.mjs",
  "driver/skills/clearance-common-law/SKILL.md": "driver/test/ruled-sentences-common-law.mjs",
  "driver/skills/clearance-variants/SKILL.md": "driver/test/ruled-sentences-variants.mjs",
  "driver/skills/knockout-assess/SKILL.md": "driver/test/ruled-sentences-knockout-assess.mjs",
  "driver/skills/placement-inquiry/SKILL.md": "driver/test/ruled-sentences-placement-inquiry.mjs",
  "driver/skills/clearance-register/SKILL.md": "driver/test/ruled-sentences-register.mjs",
  "driver/skills/narrative-refutation/SKILL.md": "driver/test/ruled-sentences-narrative-refutation.mjs",
  "driver/skills/clearance-register/register-recipes.md": "driver/test/ruled-sentences-register-recipes.mjs",
  "driver/skills/clearance-search/phase2-execution.md": "driver/test/ruled-sentences-phase2-execution.mjs",
  "driver/skills/clearance-search/synthesis-rules.md": "driver/test/ruled-sentences-synthesis-rules.mjs",
  "driver/skills/matter-frame/SKILL.md": "driver/test/ruled-sentences-matter-frame.mjs",
  "driver/skills/blind-frame/SKILL.md": "driver/test/ruled-sentences-blind-frame.mjs",
  "driver/skills/clearance-register/providers/corsearch.md": "driver/test/ruled-sentences-corsearch.mjs",
  "driver/skills/clearance-register/providers/signa.md": "driver/test/ruled-sentences-signa.mjs",
  "driver/skills/clearance-search/firm-wide-reasoning.md": "driver/test/ruled-sentences-firm-wide-reasoning.mjs",
  "driver/skills/knockout-frame/SKILL.md": "driver/test/ruled-sentences-knockout-frame.mjs",
});

const LIT = String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\x60(?:\\.|[^\x60\\$\n])*\x60`;
const CHAIN = new RegExp(`(?:${LIT})(?:\\s*\\+\\s*(?:${LIT}))*`, "g");
const flat = (s) => String(s).replace(/\s+/g, " ");
// A string's value with its escapes read: the ones a sentence in a test uses. PURE.
const ESCAPES = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
const unescape = (body) => body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e) =>
  /^u\{/.test(e) ? String.fromCodePoint(parseInt(e.slice(2, -1), 16)) : /^[ux]./.test(e) ? String.fromCharCode(parseInt(e.slice(1), 16)) : ESCAPES[e] ?? e);
const valueOf = (src) => src.match(new RegExp(LIT, "g")).map((p) => unescape(p.slice(1, -1))).join("");

/** The strings in a test file's text long enough to count, outside comments and regular expressions. PURE. */
export function heldStrings(text) {
  const s = String(text ?? "");
  const out = [];
  for (const x of s.matchAll(CHAIN)) {
    const before = s.slice(s.lastIndexOf("\n", x.index) + 1, x.index);
    if (/^\s*(\/\/|\*)/.test(before) || /\/\/[^\n]*$/.test(before)) continue;
    if (/(^|[=:,([!&|?{};]|return)\s*\/(?:[^/\n\\]|\\.)+$/.test(before)) continue;
    const v = valueOf(x[0]);
    if (v && v.length >= 25 && v.split(/\s+/).length >= 4) out.push(v);
  }
  return out;
}

/** Whether a test file's text names this manual: its folder, and its file name unless that is SKILL.md. PURE. */
export function namesManual(text, manual) {
  const [folder, file] = String(manual).split("/").slice(-2);
  return String(text).includes(folder) && (file === "SKILL.md" || String(text).includes(file));
}

/** Per manual: `{ files: { test: count } }` for the test files that name it and hold its sentences; null outside a checkout. */
export function manualPins(manuals, root = ROOT) {
  const tracked = trackedFiles(GUARD, { root, pathspec: ["driver/test", "mcp-server/test", "driver/skills"] });
  if (tracked === null) return null;
  // WHAT THIS CHECKOUT PUBLISHES, not what an overlay laid beside it: a private test or manual laid into the tree is not
  // the product's, and its own repository holds its own wording (the source-pin census reads the tree the same way).
  const p = publishedOf(tracked, root);
  if (p.error) throw new Error(`count-manual-pins: ${p.error}`);
  const read = publishedReader(root, (f) => readFileSync(join(root, f), "utf8"));
  const tests = p.files.filter((f) => f.endsWith(".test.mjs"));
  const texts = new Map(tests.map((f) => [f, read(f)]));
  const held = new Map([...texts].map(([f, t]) => [f, heldStrings(t)]));
  const out = {};
  for (const m of manuals ?? p.files.filter((f) => f.startsWith("driver/skills/") && f.endsWith(".md"))) {
    const text = flat(read(m));
    const files = {};
    for (const [f, vs] of held) {
      if (!namesManual(texts.get(f), m)) continue;
      const n = vs.filter((v) => text.includes(flat(v))).length;
      if (n) files[f] = n;
    }
    out[m] = { files };
  }
  return out;
}

function main() {
  const asked = process.argv.slice(2);
  const pins = manualPins(asked.length ? asked : null);
  if (pins === null) { console.error(`count-manual-pins: ${skipReason(GUARD)}`); process.exit(2); }
  const rows = Object.entries(pins).map(([m, { files }]) => [m, Object.keys(files).length, Object.values(files).reduce((a, b) => a + b, 0)])
    .filter(([, n]) => n || asked.length).sort((a, b) => b[1] - a[1]);
  for (const [m, n, s] of rows)
    console.log(`${m}: ${n} test file(s), ${s} sentence(s)${GATHERED[m] ? `, gathered in ${basename(GATHERED[m])}` : ""}`);
  if (!rows.length) console.log("no test writes out a manual's sentence");
}

if (isEntrypoint(import.meta.url)) main();

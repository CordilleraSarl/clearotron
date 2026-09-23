#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT THIS CHANGE ADDS TO A CUSTOMER SURFACE IS REFUSED. What is already here is not this check's business.
//
//   node scripts/writing-standard-check.mjs [--base <ref>]
//
// The standard is `docs/writing-standard.md`, and the prose rules under it are `docs/writing-rules.md`.
// This refuses the five classes a machine can judge; the classes and the reasoning behind each site rule
// are in `shared/writing-standard-classes.mjs`, next to the table, because that is where the next person
// changing one will be looking.
//
// ── WHY THIS IS DIFF-SHAPED AND NOT A SWEEP ──────────────────────────────────────────────────────
//
// Three of the five classes have a standing population in this tree — the knockout's scope block and the
// clearance renderer's coverage caveat are the very sentences the standard quotes as what not to write,
// and they are still on the page. A guard that refused them all would refuse every pull request from its
// first day, and a guard everybody bypasses protects nothing. So this one asks the smaller question that
// has a clean answer: did THIS change add another.
//
// The standing population is not thereby accepted. It is counted, per file and per class, in
// `driver/test/fixtures/writing-standard-backlog.json`, and the floor beside it refuses any file that
// grows. Between the two the number can only fall.
//
// ── TWO SHAPES OF CLASS, AND WHY THE SECOND CANNOT BE A LINE READ ───────────────────────────────
//
// `engineering-identifier`, `internal-marker` and `known-caveat` are properties of text, so an added line
// carries them. `eyebrow-heading` and `restating-lede` are not: "this screen writes its own page heading"
// is a property of a FILE, and "this lede restates its title" needs the two lines at once. Adding a lede
// under an existing title adds one line and creates the offence; a line-only reading would miss it.
//
// So both shapes are evaluated against the file as it stands at HEAD, and the DIFF decides only whether
// this change is answerable for what it finds: a line class must have its line in the added set; a block
// class must have its file in the changed set. That is a deliberate widening of "reads the lines a change
// adds", and it is the only way the last two classes mean anything.
//
// ── AN EMPTY DIFF IS A LEGITIMATE PASS, AND IT IS PRINTED AS ONE ────────────────────────────────
//
// A pull request can touch only files this check does not read. The count is printed either way, so a
// reader can tell "looked and found nothing" from "had nothing to look at".
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CLASSES, fileOffences, isExempt } from "../shared/writing-standard-classes.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const baseArg = () => {
  const i = process.argv.indexOf("--base");
  return i === -1 ? null : process.argv[i + 1];
};

/**
 * The added lines of a diff, as `{ path, lines: Set<number> }` per file.
 *
 * `--unified=0` so nothing but genuinely added text is read: with context lines a neighbouring sentence
 * would be reported as though this change wrote it, and a guard that blames the wrong line is one people
 * learn to ignore. The hunk header carries the new-side start and count, which is what maps an added line
 * back to its number in the file at HEAD.
 */
export function addedByFile(diffText) {
  const out = new Map();
  let path = null;
  let nextLine = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ b/")) { path = line.slice(6); if (!out.has(path)) out.set(path, new Set()); continue; }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) { nextLine = Number(hunk[1]); continue; }
    if (line.startsWith("+") && path) { out.get(path).add(nextLine); nextLine++; continue; }
    if (line.startsWith("-")) continue;
    nextLine++;
  }
  return out;
}

function main() {
  const base = baseArg() || "origin/main";
  let diff;
  try {
    diff = execFileSync("git", ["diff", "--unified=0", `${base}...HEAD`], { encoding: "utf8", maxBuffer: 1 << 28 });
  } catch (e) {
    console.error(`writing-standard-check: cannot diff against ${base}: ${e.message.split("\n")[0]}`);
    process.exit(2);
  }

  const added = addedByFile(diff);
  const lineClasses = new Set(["engineering-identifier", "internal-marker", "known-caveat"]);
  const hits = [];
  let read = 0;

  for (const [path, lines] of added) {
    if (isExempt(path)) continue;
    let text;
    try { text = readFileSync(path, "utf8"); } catch { continue; }   // deleted in this change
    read += lines.size;
    for (const o of fileOffences(path, text)) {
      // A LINE CLASS ANSWERS FOR ITS LINE; A BLOCK CLASS ANSWERS FOR ITS FILE. Holding a block class to
      // the added-line test would excuse the case it exists for — a lede added under a title that was
      // already there, where the offending pair is one new line and one old one.
      if (lineClasses.has(o.id) && !lines.has(o.line)) continue;
      hits.push({ path, ...o });
    }
  }

  console.log(`writing-standard-check: read ${read} added line(s) in ${added.size} file(s) against ${base}`);
  if (!hits.length) return;

  // GROUPED BY CLASS, because the remedy is per class and a flat list makes the reader derive it five
  // times. Each heading is said once, then the lines it applies to.
  console.error(`\n${hits.length} line(s) added that a customer surface must not carry:\n`);
  for (const { id, why } of CLASSES) {
    const mine = hits.filter((h) => h.id === id);
    if (!mine.length) continue;
    console.error(`  ${id} — ${why}`);
    for (const h of mine) console.error(`    ${h.path}:${h.line}\n      ${h.token}`);
    console.error("");
  }
  console.error("  The standard is docs/writing-standard.md. It never rewrites: a rewritten sentence is a");
  console.error("  sentence nobody reviewed, and a report is the one document a reader may trust literally.\n");
  process.exit(1);
}

if (isEntrypoint(import.meta.url)) main();

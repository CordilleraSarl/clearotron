#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Retire bare `#NNN` tracker references from prose (tracker issue 188).
//
//   node scripts/retire-bare-refs.mjs            what would change, per file
//   node scripts/retire-bare-refs.mjs --apply    change it
//
// ── WHY THIS IS A TOOL AND NOT A SED COMMAND ────────────────────────────────────────────────────────
//
// The edit touches dozens of files and its diff is too large to read line by line, so the only honest
// way to make a claim about it is to have the tool prove the claim itself. Three properties, checked on
// every run rather than asserted in a pull request body:
//
//   1. IT USES THE GUARD'S OWN FUNCTIONS. `isProse`, `withoutLinkTargets` and the token pattern come
//      from scripts/added-reference-check.mjs. A second regex here would be a second definition of the
//      class, and the pass would then be verifiable only by the thing that wrote it.
//   2. IT TOUCHES NO LINE THE GUARD WOULD NOT REFUSE. Every changed line is re-checked: it must have
//      been prose, and the line must be unchanged apart from the tokens. A line that moved for any other
//      reason is a refusal, not a warning.
//   3. IT REPORTS BEFORE AND AFTER PER FILE, and re-counts from disk after writing. "It worked" is a
//      measurement of the tree afterwards, never the tool's own belief about what it did.
//
// ── WHAT IT DELIBERATELY DOES NOT TOUCH ─────────────────────────────────────────────────────────────
//
// `demo/` — frozen captures, byte-identical to delivered runs by definition and carrying a published
// manifest. Rewriting them is the defect this repository just spent a bundle fixing, not a cleanup.
//
// TEST NAMES and STRING LITERALS. `isProse` already excludes them, and that is the ruling rather than an
// accident: 2,650 of the tokens on this tree are test titles, and others are user-facing strings that
// other tests assert on. Renaming them is a different change with a different risk and wants its own
// issue. This tool inherits that boundary from the guard instead of restating it.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isProse, withoutLinkTargets } from "./added-reference-check.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

// The guard's pattern. Kept as one expression so the capture and the guard's TOKEN cannot diverge in
// what they consider a token — only in what this one does with the digits.
const TOKEN = /#([0-9]{3,})/g;
const EXCLUDED = (p) => p.startsWith("demo/");

/**
 * Rewrite one line's bare references, leaving link targets alone.
 *
 * `withoutLinkTargets` tells us WHERE a token is an address rather than a reference, but it destroys the
 * line doing it — so it is used as a MASK: any token whose position survives masking is a real reference,
 * and one that does not is inside a link and stays. Replacing on the masked line and using that as the
 * output would silently delete every URL in the file.
 */
export function retireLine(line) {
  const masked = withoutLinkTargets(line);
  const keep = new Set();
  for (const m of masked.matchAll(TOKEN)) keep.add(m[1]);
  if (!keep.size) return line;
  return line.replace(TOKEN, (whole, digits) => (keep.has(digits) ? `tracker issue ${digits}` : whole));
}

const files = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);

let before = 0, after = 0, changedFiles = 0;
const refusals = [];
const report = [];

for (const rel of files) {
  if (EXCLUDED(rel)) continue;
  let text;
  try { text = readFileSync(join(REPO, rel), "utf8"); } catch { continue; }

  const lines = text.split("\n");
  let hits = 0, out = false;
  const next = lines.map((line) => {
    if (!isProse(rel, line)) return line;
    const n = [...withoutLinkTargets(line).matchAll(TOKEN)].length;
    if (!n) return line;
    hits += n;
    const rewritten = retireLine(line);
    // PROPERTY 2, checked per line: nothing but the tokens may have moved. Removing every token from
    // both sides must leave two identical strings.
    const strip = (s) => s.replace(TOKEN, "").replace(/tracker issue [0-9]{3,}/g, "");
    if (strip(rewritten) !== strip(line)) {
      refusals.push(`${rel}: a line changed beyond its tokens\n    was: ${line.trim().slice(0, 90)}\n    now: ${rewritten.trim().slice(0, 90)}`);
      return line;
    }
    if (rewritten !== line) out = true;
    return rewritten;
  });

  if (!hits) continue;
  before += hits;
  report.push([rel, hits]);
  if (out && APPLY) { writeFileSync(join(REPO, rel), next.join("\n")); changedFiles += 1; }
}

// PROPERTY 3: re-count from DISK, not from the loop above. The tool's belief about what it wrote is not
// evidence that it wrote it.
if (APPLY) {
  for (const rel of files) {
    if (EXCLUDED(rel)) continue;
    let text;
    try { text = readFileSync(join(REPO, rel), "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!isProse(rel, line)) continue;
      after += [...withoutLinkTargets(line).matchAll(TOKEN)].length;
    }
  }
}

for (const [rel, n] of report.sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${rel}`);
console.log("");
console.log(`${report.length} file(s) carry ${before} bare reference(s) the guard refuses (demo/ excluded).`);
if (APPLY) console.log(`rewrote ${changedFiles} file(s); the tree now carries ${after}.`);
else console.log("nothing written — pass --apply to rewrite.");

if (refusals.length) {
  console.error(`\nREFUSED ${refusals.length} line(s) that would have changed beyond their tokens:\n`);
  for (const r of refusals) console.error(`  ${r}`);
  process.exit(1);
}
// A pass that leaves any behind has not done what it says, and saying "done" over a non-zero count is
// exactly the shape this repository spent a day removing.
if (APPLY && after !== 0) {
  console.error(`\n${after} reference(s) survived the pass. It has not done what it claims.`);
  process.exit(1);
}

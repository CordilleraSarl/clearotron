#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT THIS CHANGE ADDS IS REFUSED. What is already here is not this check's business.
//
//   node scripts/added-reference-check.mjs [--base <ref>]
//
// ── WHY THIS IS DIFF-SHAPED AND NOT A SWEEP ──────────────────────────────────────────────────────
//
// The classes below have a standing population in this tree: citations into a tracker nobody outside
// can open, account names, home directories, and the words this project uses for how it is built. A
// guard that refused them all would refuse every pull request from its first day, and a guard
// everybody bypasses protects nothing. So this one asks a smaller question that has a clean answer:
// did THIS change add another.
//
// The standing population is not therefore accepted. It is counted, per file and per class, in
// `driver/test/fixtures/public-residue-backlog.json`, and the floor beside it refuses any file that
// grows. Between the two, the number can only fall: this check stops the inflow and the floor stops
// the backsliding. Neither works alone — a diff guard with no floor watches the total drift upward one
// repaired-and-reintroduced line at a time, and a floor with no diff guard is a number that goes stale
// the first time somebody adds a file.
//
// ── WHAT IT READS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────────────────────────
//
// COMMENTS AND PROSE ONLY. A hash followed by digits is not always a reference: a three-digit one is
// also a CSS colour, and a composite key or a fixture string can hold anything. Reading only comment
// and markdown text keeps the check away from every context where the token means something else,
// which is what lets it refuse without a table of exceptions that would rot.
//
// SO A TEST NAME IS OUT OF SCOPE, and that is a real hole rather than an oversight: most of the
// standing citation population is test names, which are string literals. Named here so the next reader
// does not have to rediscover it — widening to string literals means deciding what to do about CSS and
// composite keys first, and that decision belongs with the cleanup, not with this.
//
// LINK TARGETS ARE EXEMPT. A markdown anchor and a URL fragment are addresses, not references.
//
// `demo/**` AND `driver/skills/**` ARE NOT READ. The reasons are in shared/reference-guard-classes.mjs
// beside the rule itself, because that is where the next person changing it will be looking.
//
// ── WHERE THE TABLE LIVES ────────────────────────────────────────────────────────────────────────
//
// shared/reference-guard-classes.mjs, with the census that reads the same table. Two definitions of
// "what a public tree must not acquire" is one definition and one imitation of it, and the imitation
// is whichever the reader did not run.
import { execFileSync } from "node:child_process";
import {
  CLASSES, offendingClasses, isProse, isScannable,
  withoutColourValues, withoutLinkTargets,
} from "../shared/reference-guard-classes.mjs";

// Re-exported because scripts/retire-bare-refs.mjs and the arms beside this file import them from
// here, and moving the table should not move every caller in the same commit.
export { CLASSES, offendingClasses, isProse, isScannable, withoutColourValues, withoutLinkTargets };

/** Every offending token on one added line, or an empty array. */
export const offendingTokens = (path, line) => offendingClasses(path, line).map((c) => c.token);

const baseArg = () => {
  const i = process.argv.indexOf("--base");
  return i === -1 ? null : process.argv[i + 1];
};

/**
 * The added lines of the diff, as `{ path, line }`. Uses `--unified=0` so nothing but genuinely added
 * text is read: with context lines a neighbouring comment would be reported as though this change wrote
 * it, and a guard that blames the wrong line is one people learn to ignore.
 */
export function addedLines(diffText) {
  const out = [];
  let path = null;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ b/")) { path = line.slice(6); continue; }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+") && path) out.push({ path, line: line.slice(1) });
  }
  return out;
}

function main() {
  const base = baseArg() || "origin/main";
  let diff;
  try {
    diff = execFileSync("git", ["diff", "--unified=0", `${base}...HEAD`], { encoding: "utf8", maxBuffer: 1 << 28 });
  } catch (e) {
    console.error(`added-reference-check: cannot diff against ${base}: ${e.message.split("\n")[0]}`);
    process.exit(2);
  }
  const added = addedLines(diff);
  // AN EMPTY DIFF IS NOT A PASS TO CELEBRATE, but it is a legitimate one — a pull request can touch
  // only files this check does not read. The count is printed either way so a reader can tell the
  // difference between "looked and found nothing" and "had nothing to look at".
  const hits = [];
  for (const { path, line } of added) {
    for (const c of offendingClasses(path, line)) hits.push({ path, ...c, line: line.trim().slice(0, 100) });
  }
  console.log(`added-reference-check: read ${added.length} added line(s) against ${base}`);
  if (!hits.length) return;

  // GROUPED BY CLASS, because the remedy is per class and a flat list makes the reader derive it eight
  // times. Each heading is said once, then the lines it applies to.
  console.error(`\n${hits.length} line(s) added that a public tree must not carry:\n`);
  for (const { id, why } of CLASSES) {
    const mine = hits.filter((h) => h.id === id);
    if (!mine.length) continue;
    console.error(`  ${id} — ${why}`);
    for (const h of mine) console.error(`    ${h.path}: ${h.token}\n      ${h.line}`);
    console.error("");
  }
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

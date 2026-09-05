#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A BARE `#NNN` ADDED IN A DIFF IS REFUSED. What is already here is not this check's business.
//
//   node scripts/added-reference-check.mjs [--base <ref>]
//
// ── WHY THIS IS DIFF-SHAPED AND NOT A SWEEP ──────────────────────────────────────────────────────
//
// This tree carries 3,828 of these tokens across 542 files. They are opaque numbers into an archived
// tracker — no client data and no private name — and they are the residual the export's ratchet
// accepted, not a leak. A guard that refused them all would refuse every pull request from its first
// day, and a guard everybody bypasses protects nothing. So this one asks a smaller question that has a
// clean answer: did THIS change add another one.
//
// The 3,828 are somebody's work, filed and costed. When they go, the allowlist below goes with them and
// this check widens to the whole tree in the same pull request.
//
// ── WHAT IT READS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────────────────────────
//
// COMMENTS AND PROSE ONLY. A hash followed by digits is not always a reference: a three-digit one is
// also a CSS colour, and a composite key or a fixture string can hold anything. Reading only comment
// markdown keeps the check away from every context where the token means something else, which is what
// lets it refuse without a table of exceptions that would rot.
//
// SO A TEST NAME IS OUT OF SCOPE, and that is a real hole rather than an oversight: 2,650 of the 3,828
// are test names, which are string literals. Named here so the next reader does not have to rediscover
// it — widening to string literals means deciding what to do about CSS and composite keys first, and
// that decision belongs with the cleanup, not with this.
//
// LINK TARGETS ARE EXEMPT. A markdown anchor and a URL fragment are addresses, not references.
//
// AND `tracker issue NNN` PASSES, because it carries no `#` at all. That is the form this project
// writes, and the guard exists to make the wrong form loud rather than to ban the number.
import { execFileSync } from "node:child_process";

// THE TWELVE FILES RESTORED VERBATIM FROM THE FROZEN TIP AND KEPT. Thirteen were restored; the
// duplicate-skip arms were dropped in the same branch, so twelve reach main. They came across
// byte-exact, which is what made their arms trustworthy and also brought their references with them.
// Exempted for that one merge and removed by the cleanup; see the note above.
const RESTORED_VERBATIM = new Set([
  "driver/test/a-bail-on-an-unmeetable-precondition-is-a-skip.test.mjs",
  "driver/test/a-signal-immune-fixture-is-reaped-by-its-owner.test.mjs",
  "driver/test/a-wait-the-driver-could-not-measure-says-so.test.mjs",
  "driver/test/browser-check-membership.test.mjs",
  "driver/test/commonlaw-reconciliation-callsite.test.mjs",
  "driver/test/e2e-assertions.test.mjs",
  "driver/test/engine.anthropic.test.mjs",
  "driver/test/engine.openai.integration.test.mjs",
  "driver/test/floor-duty.test.mjs",
  "driver/test/pipeline.mock.test.mjs",
  "driver/test/render-frozen.test.mjs",
  "driver/test/suite-ledger-is-not-the-box-ledger.test.mjs",
]);

const TOKEN = /#[0-9]{3,}/g;

/** Is this added line one the check reads at all? Comments in source, everything in markdown. */
export const isProse = (path, line) => {
  if (/\.mde?$/.test(path) || path.endsWith(".md")) return true;
  const t = line.trim();
  if (/\.(ya?ml)$/.test(path)) return t.startsWith("#");
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
};

/** Strip the spans where a `#NNN` is an address rather than a reference. */
export const withoutLinkTargets = (line) => line
  .replace(/\]\([^)]*\)/g, "]()")                 // markdown link targets, anchors included
  .replace(/https?:\/\/\S+/g, "")                  // bare URLs and their fragments
  .replace(/<[^>]*>/g, "");                        // angle-bracket autolinks

/** Every offending token on one added line, or an empty array. */
export const offendingTokens = (path, line) => {
  if (!isProse(path, line)) return [];
  return [...withoutLinkTargets(line).matchAll(TOKEN)].map((m) => m[0]);
};

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
    if (RESTORED_VERBATIM.has(path)) continue;
    for (const token of offendingTokens(path, line)) hits.push({ path, token, line: line.trim().slice(0, 100) });
  }
  console.log(`added-reference-check: read ${added.length} added line(s) against ${base}`);
  if (!hits.length) return;
  console.error(`\n${hits.length} bare reference(s) added in comments or prose:\n`);
  for (const h of hits) console.error(`  ${h.path}: ${h.token}\n    ${h.line}`);
  console.error("\nWrite `tracker issue NNN` instead. A bare `#NNN` linkifies into whatever repository "
    + "renders it, which is not the one the number belongs to, and it lives on in public history.");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();

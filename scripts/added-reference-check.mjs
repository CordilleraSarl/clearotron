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
// RESTORED_VERBATIM IS GONE (tracker issue 188). It exempted twelve files by literal path so that a
// byte-for-byte restoration could land without the guard refusing its own restored text. Their tokens
// are now retired like everything else, so the list exempts nothing real — and a stale exemption list is
// worse than none: it silently covers files nobody is checking any more, and it is invisible in a diff
// that does not touch this file.

const TOKEN = /#[0-9]{3,}/g;

// A `#` COMMENT IS A COMMENT WHEREVER THE FILE FORMAT SAYS SO, not only in YAML (tracker issue 188).
//
// This read `#` as a comment for YAML alone, so the same sentence was refused in a .yml file and waved
// through in .env.example, a systemd unit or a shell script. Those comments are exactly as publicly
// visible, and `# REQUIRED — tracker issue 774 removed the code default` was sitting in .env.example on the public
// tree while this guard reported the tree clean. Found while measuring the class for the retirement pass:
// the guard's own rule flagged 359 tokens, and thousands more sat in files it had never classified.
//
// Extensionless is deliberate: a systemd unit or a dotfile often has no extension worth matching, so the
// KNOWN `#`-comment names are listed and everything else keeps the source rule.
const HASH_COMMENT = /(^|\/)(\.env[^/]*|[^/]*\.(ya?ml|sh|bash|service|timer|path|socket|conf|ini|toml|properties)|Dockerfile[^/]*|Makefile|\.gitignore|\.gitattributes)$/;

/** Is this added line one the check reads at all? Comments in source, everything in markdown. */
export const isProse = (path, line) => {
  if (/\.mde?$/.test(path) || path.endsWith(".md")) return true;
  const t = line.trim();
  if (HASH_COMMENT.test(path)) return t.startsWith("#");
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
};

// ── A COLOUR IS NOT A CITATION, AND THE DIGITS ALONE CANNOT SAY WHICH ───────────────────────────
//
// `TOKEN` matches digits only, so a six-digit hex colour is read as its leading digits and refused as a
// reference. An earlier sweep acted on exactly that reading and rewrote sixteen colour literals as issue
// text, two of them live mermaid `classDef` directives — so the documentation's diagrams rendered
// broken, and thirteen comments stated a value that was no longer there. Restoring them then hit this
// guard, whose refusal told the author to write the very text that had caused it.
//
// TWO RULES, and between them they settle every case without a table of exceptions:
//
//   1. A hex colour may contain a-f; an issue number is decimal. A token carrying a letter cannot be a
//      reference whatever its length, and no reading of the digits is needed to know it.
//   2. For the all-digit case — three digits is both a short colour and a plausible issue number — the
//      SITE settles it: a value whose property is a colour is a colour. Same rule and the same property
//      list as the guard in `driver/test/prompt-payload-names-no-tracker-issue.test.mjs`, which already
//      plants both and requires them told apart.
//
// This does NOT widen to bare digits in prose. A reference in a comment is still refused, which is the
// whole point of the check, and the arm asserts that direction too.
const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const COLOUR_PROPERTY = /(?:^|[;{\s(,])(?:color|background|background-color|border|border-color|fill|stroke|outline|box-shadow|text-shadow)\s*:\s*$/i;

/** Strip hex colours, so what remains is only tokens that could be a reference. */
export const withoutColourValues = (line) => String(line).replace(HEX_COLOUR, (m, offset, whole) => {
  if (/[a-fA-F]/.test(m.slice(1))) return "";                              // letters ⇒ not a decimal number
  return COLOUR_PROPERTY.test(whole.slice(0, offset)) ? "" : m;            // all digits ⇒ the property decides
});

/** Strip the spans where a `#NNN` is an address rather than a reference. */
export const withoutLinkTargets = (line) => line
  .replace(/\]\([^)]*\)/g, "]()")                 // markdown link targets, anchors included
  .replace(/https?:\/\/\S+/g, "")                  // bare URLs and their fragments
  .replace(/<[^>]*>/g, "");                        // angle-bracket autolinks

/** Every offending token on one added line, or an empty array. */
export const offendingTokens = (path, line) => {
  if (!isProse(path, line)) return [];
  return [...withoutColourValues(withoutLinkTargets(line)).matchAll(TOKEN)].map((m) => m[0]);
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

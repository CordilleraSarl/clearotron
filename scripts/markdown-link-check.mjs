#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// markdown-link-check.mjs — every relative markdown link in the tracked tree resolves to something
// on disk.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
//
// Nothing verified them. 169 tracked markdown files carry hundreds of relative links, and until this
// script every one was an assertion nobody had checked — a README citing `bootstrap.mjs` four times,
// twice as a runnable command, for a file that is not in the tree. A stranger's first five
// minutes are spent following exactly those links, and a dead one reads as "this project does not
// work" rather than "this line is stale".
//
// The failure is silent by construction: a broken link renders as a link. Nothing goes red, no test
// covers it, and the reader is the first person to find out.
//
// ── WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────────────
//
// CHECKED: inline links and images — `[text](path)`, `![alt](path)` — and reference definitions
// (`[label]: path`), in every tracked `*.md` file, where the destination is a relative path. The
// destination must exist on disk. A directory counts.
//
// NOT CHECKED, each for a reason:
//
//   · `http(s)://` and every other `scheme:` destination (`mailto:`, `tel:`, …). CI has no network,
//     and a link check that needs one is a check that goes red when a third party has an outage —
//     which is how a gate gets ignored. Protocol-relative `//host/path` is treated the same way.
//   · Anchors. `#section` alone, and the `#fragment` on a path, are stripped and the FILE is
//     validated. Resolving a heading would mean reimplementing GitHub's slug rules, and getting them
//     subtly wrong makes this loud in the one direction that trains people to override it.
//   · Destinations containing `<` or `>`. The skills corpus writes prose templates with
//     angle-bracket placeholders — `[<register> · <id>](<composed record URL>)` in
//     driver/skills/prelim-search/delivery-contract.md is an instruction to a model, not a path.
//     No real path contains those characters, so the exclusion costs nothing.
//
// ── THE ALLOWLIST IS SELF-INVALIDATING ───────────────────────────────────────────────────────────
//
// A lint that greenlights every hole it finds on day one certifies the problem instead of reporting
// it. So the pre-existing backlog is written out below, entry by entry, each with the reason it is
// still there — never a silent skip, never a pattern broad enough to hide the next one.
//
// And an allowlist entry that matches nothing is itself a failure. A stale entry silently re-covers
// a hole that moved: the link gets fixed, the entry stays, and the next broken link at that path
// passes. Fixing a listed link means deleting its entry in the same commit, and this script makes
// you.
//
// Usage:  node scripts/markdown-link-check.mjs [--json]

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles } from "../shared/tracked-files.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = "markdown-link-check";

// ── The known backlog ────────────────────────────────────────────────────────────────────────────
//
// `file` is repo-relative, `link` is the destination exactly as written. Both must match for an
// entry to fire, so an entry cannot spread to a link it was not written for.
//
// Every entry needs a reason a reader can act on: what the link was for, and what has to happen for
// the entry to go away.
const ALLOWED = [
  {
    file: "mcp-server/test/fixtures/report.internal.md",
    link: "perplexity_research",
    // NOT a documentation defect, and not this script's to fix. The engine emitted
    // `[perplexity_research pro-search](perplexity_research (pro-search): Abu Dhabi DoH reference
    // price list, İlaç Rehberi)` — a citation label in the destination slot, where a URL belongs.
    // The fixture is a VERBATIM excerpt of a real run (mcp-server/test/scrub.test.mjs says so, and
    // says why: invented fixtures only carry the shapes you thought of). Editing it to satisfy a
    // lint would make the fixture stop being evidence of what the engine produced, and scrub.test
    // asserts on this exact text surviving the scrubber.
    //
    // Goes away when the engine stops emitting a citation as a link destination and this fixture is
    // recaptured from a run that does —. Deleting this entry is part of that change, and the
    // stale-entry check below will insist on it.
    //
    // THE PRODUCER FIX HAS LANDED; THE ENTRY HAS NOT FALLEN YET, AND BOTH ARE CORRECT.
    // delivery-contract.md's "Checks we ran" section now carries the arm it was missing: a source that
    // is a SEARCH rather than a page has no URL and is cited as TEXT, never as a link whose
    // destination is the citation label. That changes what the engine EMITS from here on. It cannot
    // change this file, which is a frozen excerpt of a run that already happened — so the entry stays
    // valid and load-bearing until someone recaptures the fixture from a post-fix run. Deleting it now
    // would turn this check red against a fixture that legitimately still holds the old shape.
    reason: "verbatim real-run fixture; the malformed link is the engine's output, and the fixture is the evidence",
  },
];

const isAllowed = (file, link) => ALLOWED.some((a) => a.file === file && a.link === link);

// ── Parsing ──────────────────────────────────────────────────────────────────────────────────────

// Fenced blocks first, then inline code spans. A bash recipe full of `$(...)` and `[ -f x ]` is not
// prose, and across 169 files a regex that reads code as links produces a wall of false positives —
// which is the same as no check at all. Blank the content, KEEP the newlines, so reported line
// numbers still point at the right line.
const blankKeepingLines = (s) => s.replace(/[^\n]/g, " ");

function stripCode(src) {
  // ``` or ~~~ fences, at least three, closed by a run of the same character at least as long.
  let out = src.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\2[^\n]*$|(?![\s\S]))/gm, blankKeepingLines);
  // Inline spans: a run of N backticks closed by the same run, on one line.
  out = out.replace(/(`+)(?:(?!\1)[^\n])*\1/g, blankKeepingLines);
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

/** Destinations that are not this repo's to resolve. */
function skipReason(dest) {
  if (!dest) return "empty";
  if (dest.startsWith("#")) return "anchor-only";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(dest)) return "external scheme";
  if (dest.startsWith("//")) return "protocol-relative";
  if (dest.includes("<") || dest.includes(">")) return "angle-bracket placeholder";
  return null;
}

/**
 * Strip the `#fragment` and `?query`, then percent-decode.
 *
 * No angle-bracket unwrapping here: `skipReason` has already dropped every destination containing
 * `<` or `>`, so a `[x](<a b>)` form never reaches this function. Unwrapping it anyway would be a
 * branch that reads as support for a syntax this script deliberately does not resolve.
 */
function toPath(dest) {
  const p = dest.split("#")[0].split("?")[0].trim();
  try { return decodeURIComponent(p); } catch { return p; }  // a malformed escape stays as written
}

/**
 * Destinations in one markdown source.
 *
 * Inline `](dest)` and `](<dest>)`, plus reference definitions `[label]: dest`. The inline
 * destination stops at the first `)` or whitespace — markdown's own balanced-paren rule is not worth
 * reimplementing, and a path with a bare `(` in it is not a path anyone should be writing.
 */
function destinations(src) {
  const found = [];
  for (const m of src.matchAll(/\]\(\s*(<[^>\n]*>|[^)\s]*)/g)) {
    found.push({ dest: m[1], line: lineOf(src, m.index) });
  }
  for (const m of src.matchAll(/^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]+(<[^>\n]*>|\S+)/gm)) {
    found.push({ dest: m[2], line: lineOf(src, m.index) });
  }
  return found;
}

// ── The walk ─────────────────────────────────────────────────────────────────────────────────────

const asJson = process.argv.includes("--json");

const files = trackedFiles(GUARD, { root: ROOT, pathspec: ["*.md"] });
if (files === null) {
  // trackedFiles has already printed the SKIPPED marker and why. In a suite that skip is right; here
  // it is not. This script's whole job is to read the tracked corpus, so failing to read it is a
  // result, not a pass — CI runs it on a checkout and a green from a corpus of zero files means
  // nothing.
  console.error(
    `${GUARD}: cannot enumerate tracked markdown, so nothing was checked. ` +
    `That is a failure here rather than a skip — a link check over zero files reports the same green as a clean tree.`,
  );
  process.exit(1);
}

const broken = [];
const usedAllows = new Set();
let checked = 0;

for (const file of files) {
  const src = stripCode(await readFile(join(ROOT, file), "utf8"));
  const dir = dirname(join(ROOT, file));
  for (const { dest, line } of destinations(src)) {
    if (skipReason(dest)) continue;
    const rel = toPath(dest);
    if (!rel) continue;
    checked += 1;
    const target = rel.startsWith("/") ? join(ROOT, rel) : resolve(dir, rel);
    if (existsSync(target)) continue;
    if (isAllowed(file, dest)) { usedAllows.add(`${file}\u0000${dest}`); continue; }
    broken.push({ file, line, link: dest, resolved: relative(ROOT, target) || "." });
  }
}

// A stale entry is the failure this check exists to stop, wearing the check's own uniform.
const stale = ALLOWED.filter((a) => !usedAllows.has(`${a.file}\u0000${a.link}`));

if (asJson) {
  console.log(JSON.stringify({ files: files.length, checked, broken, stale }, null, 2));
} else {
  console.log(`${GUARD}: ${checked} relative link(s) across ${files.length} tracked markdown file(s).`);
  if (ALLOWED.length) console.log(`${GUARD}: ${ALLOWED.length} allowlisted, ${usedAllows.size} of them still firing.`);
  for (const b of broken) {
    console.log(`::error file=${b.file},line=${b.line}::broken relative link [${b.link}] — nothing at ${b.resolved}`);
    console.log(`  ${b.file}:${b.line}  ${b.link}  →  ${b.resolved} (absent)`);
  }
  for (const s of stale) {
    console.log(`::error file=scripts/markdown-link-check.mjs::stale allowlist entry: ${s.file} → ${s.link} now resolves (or moved).`);
    console.log(`  stale allowlist entry: ${s.file} → ${s.link}`);
  }
  if (broken.length) {
    console.log(
      `\n${broken.length} relative link(s) point at nothing. Fix the path, or — if the target is gone for good — ` +
      `say so in the prose and give the reader the route that replaced it. A deleted instruction with no ` +
      `replacement leaves them exactly as stuck.`,
    );
  }
  if (stale.length) {
    console.log(
      `\n${stale.length} allowlist entry/entries matched nothing. Delete them: an entry that fires on no link ` +
      `still covers its path, so the next broken link there would pass unnoticed.`,
    );
  }
  if (!broken.length && !stale.length) console.log(`${GUARD}: clean.`);
}

process.exit(broken.length || stale.length ? 1 : 0);

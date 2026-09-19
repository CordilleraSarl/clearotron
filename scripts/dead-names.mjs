#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A DEAD NAME MUST STAY DEAD — and git history is permanent, so re-introduction is not undoable.
//
//   node scripts/dead-names.mjs            report; exit 1 if a dead name is back
//   node scripts/dead-names.mjs --json     the same, as JSON
//
// The owner ruled Lore and Aughra dead names that may appear nowhere, and the purge is done: the issue's
// own pattern returned 58 files when it was written and ONE when this guard landed, a dictionary snippet
// about hunting inside captured search results. What does not exist is anything to keep it that way. A
// name published once stays published, so the cost of a re-introduction is not a revert — it is a name
// in the history of a repository that is about to be cut in public.
//
// ── THE HARD PART IS THE FALSE POSITIVES, AND THE ISSUE SAYS SO ──────────────────────────────────────
//
// `grep -i lore` returns 15 files in this tree and every one is innocent: `explore`, `Flores`, `lorem`,
// `folklore`, `Florence`, `unexplored`, `recolored`, and `WarframeLore` — a synthetic mark in a test
// fixture, which is a trademark search engine's fixture doing exactly its job. A guard that fired on
// those would be turned off within a week, and a guard that is off is worse than none because its
// presence reads as coverage.
//
// So the patterns are the issue's own, anchored, plus a NAMED exemption list where a true match is
// genuinely third-party content. Every exemption carries its reason in words and is asserted to still
// be needed (dead-names.test.mjs) — an exemption that has stopped matching is deleted, not carried.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { trackedFiles } from "../shared/tracked-files.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const GUARD = "dead-names (#853)";

/**
 * The dead names, as the issue defines them. `\blore\b` is the loose arm and it is why the exemptions
 * below exist; every other arm is specific enough to have no innocent match.
 */
// `aughra` carries a LEADING boundary only: `AUGHRA_HOME` and `aughra.timer` are exactly the shapes
// the issue names as deployed surfaces, and `_` is a word character, so a trailing `\b` would miss the
// environment variable while catching the prose. No English word begins with those six letters, so the
// leading boundary is all the protection the arm needs — measured: zero hits in the tree either way.
// A PER-PERSON IDENTITY IS THE SAME KIND OF NAME, AND IT IS NOT WRITTEN HERE. An agent identity named
// after a real person must never reappear either, and the mechanism is identical. But a public guard
// that spells out a person's name publishes the name it exists to keep out, so no such arm is written
// into this file: `deadNameHits` takes its pattern as an argument, and the test drives the mechanism
// with an invented identity. `alex` and `sam`, the names the tests give agents and requesters, are
// invented.
export const DEAD_NAME_RE = /lorestar|lore_(pool|url|flags)|clearance_lore|lorectl|loreurl|lorecontrols|trademark-lore|\blore\b|\baughra/i;

/**
 * Where a true match is somebody else's word rather than our dead name. NAMED, with the reason, and
 * scoped to the file — never a blanket pattern, because a blanket would re-admit the name everywhere.
 * The first exemption was a dictionary snippet in the demo's captured common-law results; the demo was
 * re-captured without it, so that exemption was deleted rather than carried.
 */
export const EXEMPTIONS = [
  {
    file: "driver/wordlists/en.txt",
    why: "the engine's list of ordinary English words, the dictionary of the one-letter neighbourhood "
      + "filter. `lore` is an ordinary English word and sits on it. The list only ever removes queries, "
      + "so taking the word out would change which searches a run makes, to satisfy a lint.",
  },
];

const exemptionFor = (file) => EXEMPTIONS.find((e) => e.file === file) ?? null;

/** Every dead-name hit in a corpus of {file, text}, against DEAD_NAME_RE unless a pattern is given. PURE. */
export function deadNameHits(corpus, pattern = DEAD_NAME_RE) {
  const out = [];
  for (const { file, text } of corpus ?? []) {
    if (exemptionFor(file)) continue;
    const lines = String(text ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) out.push({ file, line: i + 1, text: lines[i].trim().slice(0, 160) });
    }
  }
  return out;
}

/** The tracked corpus, minus this guard and its test — they name the names in order to ban them. */
export function corpusOf(root = ROOT) {
  const files = trackedFiles(GUARD, { root });
  if (files == null) return null;
  const out = [];
  for (const f of files) {
    if (/(^|\/)(dead-names\.mjs|dead-names\.test\.mjs)$/.test(f)) continue;
    try { out.push({ file: f, text: readFileSync(join(root, f), "utf8") }); } catch { /* binary or unreadable */ }
  }
  return out;
}

function main() {
  const corpus = corpusOf();
  if (corpus == null) { console.log("dead-names did not run — no tracked corpus. This is a SKIP, not a pass."); process.exit(0); }
  const hits = deadNameHits(corpus);
  const payload = { files: corpus.length, hits, exemptions: EXEMPTIONS };
  if (process.argv.includes("--json")) { console.log(JSON.stringify(payload, null, 2)); process.exit(hits.length ? 1 : 0); }
  console.log(`dead names (#853) — ${corpus.length} tracked file(s), ${hits.length} hit(s)`);
  for (const h of hits) console.log(`  ${h.file}:${h.line}\n    ${h.text}`);
  for (const e of EXEMPTIONS) console.log(`\n  exempt: ${e.file}\n    ${e.why}`);
  process.exit(hits.length ? 1 : 0);
}

if (isEntrypoint(import.meta.url)) main();

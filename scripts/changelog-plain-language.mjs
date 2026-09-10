// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// changelog-plain-language.mjs — property 3: every changelog line a reader sees is plain
// English, held by a gate rather than by a style guide.
//
// WHY THIS REFUSES RATHER THAN REWRITES. The issue calls this "an automated rewrite pass at compile
// time" and then says how to judge it: "Prove the plain-language pass can fail. Put jargon through it
// and watch it stop. A rewrite step nobody has seen refuse is not a check." Those are two different
// builds and only the second is testable — a rewriter's output is a new sentence nobody reviewed, and a
// changelog is the one document a reader is entitled to trust literally. So this refuses, names the
// line, and prints what matched. The author fixes the note. That is the reading taken, stated here
// rather than left for someone to infer from the code.
//
// IT MUST HOLD REGARDLESS OF WHO OR WHAT WROTE THE NOTE — the issue's words. So it runs at compile time
// against the assembled changelog, not against a contributor's discipline, and it is deliberately blind
// to who wrote the line.
import { readFileSync } from "node:fs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
import { lineFindings, sourceDirectories, userDocs } from "./plain-language-rules.mjs";

// THE RULES live in plain-language-rules.mjs, shared with the note lint, so a note CI passes cannot turn
// this gate red after the merge. BANNED_WORDS is re-exported for the callers that read it from here.
export { BANNED_WORDS } from "./plain-language-rules.mjs";


/**
 * Every reason this text may not be shown to a reader. Empty means it may.
 *
 * The line rules are plain-language-rules.mjs's, the same ones the note lint applies on the pull request.
 */
export function findings(text, { sourceDirs = sourceDirectories(), docs = userDocs() } = {}) {
  const out = [];
  const lines = text.split("\n");
  for (const [i, raw] of lines.entries()) {
    // A heading is changesets' own furniture ("## 0.2.0", "### Patch Changes"), not authored prose.
    if (/^\s*#{1,6}\s/.test(raw)) continue;
    for (const f of lineFindings(raw, { sourceDirs, docs })) out.push({ line: i + 1, kind: f.kind, match: f.match, text: raw.trim() });
  }
  return out;
}

/** The findings as sentences a note's author can act on without opening this file. */
export function sentences(found) {
  return found.map((f) => `line ${f.line}: ${f.kind} "${f.match}" — a reader of the changelog does not `
    + `have the tree open. Say what changed for them.\n    ${f.text}`);
}

function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error("changelog-plain-language <file>... — refuses if a changelog line is not plain English");
    process.exitCode = 2;
    return;
  }
  let bad = 0;
  for (const p of paths) {
    let text;
    // A FILE THAT CANNOT BE READ IS NOT A PASS. Exit 2 is could-not-look, and it is not exit 0.
    try { text = readFileSync(p, "utf8"); }
    catch (e) { console.error(`could not read ${p}: ${e.code || e.message}`); process.exitCode = 2; return; }
    const found = findings(text);
    if (!found.length) { console.log(`  ok    ${p} — every line is plain English`); continue; }
    bad += found.length;
    console.error(`  REFUSED  ${p}`);
    for (const s of sentences(found)) console.error("    " + s);
  }
  if (bad) {
    console.error(`\nchangelog-plain-language: ${bad} line(s) a reader could not act on. `
      + "Rewrite the note, not this check.");
    process.exitCode = 1;
  }
}

if (isEntrypoint(import.meta.url)) main();

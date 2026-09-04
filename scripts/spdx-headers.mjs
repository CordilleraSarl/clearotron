#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// spdx-headers.mjs — put the licence notice at the top of every source file we author, and keep it
// there.
//
// ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
//
// AGPL-3.0 §5(a) requires a modified work to carry prominent notices of its licensing, and the
// licence's own appendix recommends a per-file header naming the licence and its version..
//
// The identifier is AGPL-3.0-ONLY, not -or-later, and the difference is a commitment rather than a
// spelling: -or-later accepts in advance whatever the FSF publishes next. Owner-ruled 2026-08-16.
//
// The header is the easy half. The half that decides whether this was worth doing is `--check`, run
// by CI: a licence header present on 80% of files is worse than a policy nobody claimed to have,
// because it reads as a decision that was made and then quietly wasn't. Nothing else in the tree
// would notice a new file arriving without one — this is a pure comment change with no runtime
// consequence, so no test, no type, and no reviewer's eye is reliably on it.
//
// ── WHAT COUNTS AS "WE AUTHORED IT" ──────────────────────────────────────────────────────────────
//
// Every tracked `.mjs`, `.js`, `.ts`, `.tsx`, `.jsx` file, minus the exclusions below. The
// exclusions are STATED HERE rather than assumed, and each one has a reason, because an exclusion
// list is where a guard goes to die:
//
//   · `portal-ui/dist/` — the BUILT bundle. It is committed on purpose (the deploy pulls it rather
//     than building it) but nobody wrote it, vite rewrites it wholesale on every build, and any
//     header added here is gone at the next `npm run build`. Claiming copyright in a generated
//     artifact's minified body is also just noise.
//   · `node_modules/` — never tracked, listed for the reader who wonders.
//
// There is no "vendored" exclusion because there is no vendored source in this tree: a sweep for
// third-party/vendor/generated paths over all 867 candidates returned exactly one file, and it was
// the dist bundle above. If vendored code arrives later it needs a line here WITH ITS PROVENANCE,
// not a widened glob.
//
// ── WHERE THE HEADER GOES ────────────────────────────────────────────────────────────────────────
//
// After the shebang, when there is one — 70 files here start `#!/usr/bin/env node`, and a comment
// above that line stops the kernel from finding the interpreter. Otherwise first line, before the
// file's own explanatory banner, because a licence notice that sits below three screens of prose is
// one a reader has to go looking for.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   //

export const SPDX = "// SPDX-License-Identifier: AGPL-3.0-only";
export const COPYRIGHT = "// Copyright 2026 Cordillera Sàrl";

// THIS LINE IS WHAT CARRIES THE ADDITIONAL TERMS OUT OF THE REPOSITORY, and its wording is counsel's.
//
// It is NOT what makes them apply. ADDITIONAL-TERMS.md clause 1 applies them to every portion of the
// Project developed by Cordillera Sàrl, notice or no notice — it was rewritten to say so on 2026-08-24,
// because a per-file marker as the ONLY route left the doctrine, the Markdown and the JSON outside the
// terms while the JavaScript was inside them.
//
// What the line does is TRAVEL. AGPL software is copied file by file: somebody lifts one .mjs into
// their own project, and a notice on that file goes with it where a statement in a document at the
// repository root does not. That is why the sweep still runs over 1,418 files after the clause changed
// — belt and braces on the files most likely to be extracted.
//
// Approved by counsel 2026-08-24 as the text that refers to the terms for clause 1's purposes. DO NOT
// REWORD IT for tone, line length or house style. The check below cannot tell a phrasing that works
// from one that reads better and does not.
export const TERMS_TEXT = "Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md";

// COUNSEL'S SENTENCE, ON THE COPYRIGHT LINE RATHER THAN ITS OWN. The wording above is approved and is
// never reworded; where it SITS is this script's choice, and the choice was measured rather than styled.
//
// On its own line it adds a line to all 1,418 authored files, and every line-numbered citation in the
// repository then points one line high — 598 of them target files this sweep touches. Trialled: on the
// swept tree `citation-line-check` went from exit 0 to exit 1 with 30 findings, and that instrument says
// in its own closing paragraph that it only recognises a citation landing on blank or brace-only
// punctuation. The other ~568 would have drifted onto real lines and read as correct. A whole-tree
// off-by-one in the audit trail, 30 of it visible.
//
// Carried on the copyright line the notice travels with the file exactly as well — it is the same line
// count, so nothing moves. The joiner is punctuation and is layout, not counsel's text.
export const COPYRIGHT_WITH_TERMS = `${COPYRIGHT}. ${TERMS_TEXT}`;
const HEADER = `${SPDX}\n${COPYRIGHT_WITH_TERMS}\n`;

// A HEADER THAT IS PRESENT BUT WRONG IS NOT A MISSING HEADER, and before the AGPL flip this script
// could not tell the difference: it asked only "is our exact SPDX line here?", and on a no it PREPENDED.
// Run once over a tree carrying the previous identifier, that gives every file two SPDX lines — the new
// one on top, the old one still underneath, and the check green because the line it looks for is now
// there. A file declaring two different licences is worse than a file declaring none, and nothing would
// have said so. So a stale identifier is detected as its own state and REPLACED in place.
const SPDX_LINE_RE = /^\/\/ SPDX-License-Identifier: .+$/;
const spdxLinesIn = (text) =>
  text.split("\n", 5).map((l, i) => [i, l.trim()]).filter(([, l]) => SPDX_LINE_RE.test(l));

const EXTENSIONS = /\.(mjs|js|ts|tsx|jsx)$/;
export const EXCLUDED_PREFIXES = ["portal-ui/dist/", "node_modules/"];
export const isExcluded = (path) => EXCLUDED_PREFIXES.some((p) => path.startsWith(p));

/** Tracked, authored source files. `git ls-files` rather than a directory walk: an untracked file is
 *  not shipped, and a guard that walks the filesystem reports on scratch nobody publishes. */
export function authoredFiles(cwd = process.cwd()) {
  return execFileSync("git", ["ls-files"], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n").filter((f) => f && EXTENSIONS.test(f) && !isExcluded(f));
}

/** Already headed? Checked on the SPDX line alone — the copyright year will move and the check must
 *  not start failing every January over a line the licence does not require to be any particular
 *  text. */
export const hasHeader = (text) => text.split("\n", 6).some((l) => l.trim() === SPDX);

/** The additional-terms notice, separately. A file can carry the licence line and not this one — that is
 *  every file that existed before the notice did, and it is the state the sweep exists to clear. It is
 *  asked SEPARATELY from hasHeader on purpose: folding the two together would report those files as
 *  MISSING A HEADER, which is a different defect with a different cause, and the count would then read
 *  as "1,418 files have no licence" on the day this lands. */
export const hasTerms = (text) => text.split("\n", 6).some((l) => l.includes(TERMS_TEXT));

/** Carries an SPDX line, but not ours — a licence flip that has not reached this file yet. */
export const hasStaleHeader = (text) => !hasHeader(text) && spdxLinesIn(text).length > 0;

/** The header, placed or corrected. Returns the new text, or null when it is already right. */
/** The notice as its OWN line — the shape this script wrote before the placement was measured. */
const TERMS_OWN_LINE = `// ${TERMS_TEXT}`;

export function withHeader(text) {
  // FOLD AN OWN-LINE NOTICE ONTO THE COPYRIGHT LINE. Files written between the machinery being drafted
  // and the placement being settled carry the notice on a line of its own, and they are already "termed"
  // — so without this they would be skipped and the tree would end up with two header shapes, one of
  // which a reader would copy into the next new file. Self-healing beats hand-patching a list that grows
  // while you are looking at it.
  if (hasHeader(text) && text.split("\n", 6).some((l) => l.trim() === TERMS_OWN_LINE)) {
    const lines = text.split("\n");
    const own = lines.findIndex((l) => l.trim() === TERMS_OWN_LINE);
    const c = lines.slice(0, 6).findIndex((l) => /^\/\/ Copyright /.test(l.trim()));
    if (c !== -1) {
      lines[c] = `${lines[c].trimEnd()}. ${TERMS_TEXT}`;
      lines.splice(own, 1);
      return lines.join("\n");
    }
  }
  if (hasHeader(text) && hasTerms(text)) return null;
  // Headed, but from before the notice existed. Insert after the LAST line of the existing header
  // rather than prepending: prepending would put the notice above the licence it refers to, and above
  // a shebang.
  if (hasHeader(text)) {
    const lines = text.split("\n");
    // APPEND to the copyright line wherever there is one — that is what keeps the file's line count, and
    // every citation into it, exactly where it was. Found by PREFIX: seven files spell the holder without
    // its accent, and an exact match would have silently skipped them and left them outside the terms.
    const c = lines.slice(0, 6).findIndex((l) => /^\/\/ Copyright /.test(l.trim()));
    if (c !== -1) {
      lines[c] = `${lines[c].trimEnd()}. ${TERMS_TEXT}`;
      return lines.join("\n");
    }
    // No copyright line at all — two files, both carrying SPDX and nothing else, which is a gap of its
    // own. They get the full line, which is the only case in the tree where this sweep changes a line
    // COUNT. Checked before choosing this: no citation anywhere points into either file.
    const at = lines.findIndex((l) => l.trim() === SPDX);
    lines.splice(at + 1, 0, COPYRIGHT_WITH_TERMS);
    return lines.join("\n");
  }
  if (hasStaleHeader(text)) {
    // In place, so the file's own banner ordering and its shebang are untouched: the licence changed,
    // nothing else did, and the diff should say exactly that.
    const lines = text.split("\n");
    for (const [i] of spdxLinesIn(text)) lines[i] = SPDX;
    return lines.join("\n");
  }
  if (text.startsWith("#!")) {
    const nl = text.indexOf("\n");
    if (nl === -1) return `${text}\n${HEADER}`;
    return `${text.slice(0, nl + 1)}${HEADER}${text.slice(nl + 1)}`;
  }
  return `${HEADER}${text}`;
}

function main(argv, cwd = process.cwd()) {
  const check = argv.includes("--check");
  const files = authoredFiles(cwd);
  const missing = [];
  const stale = [];
  const untermed = [];
  let written = 0;
  let corrected = 0;

  for (const f of files) {
    const path = `${cwd}/${f}`;
    let text;
    try { text = readFileSync(path, "utf8"); } catch { continue; }
    const wasStale = hasStaleHeader(text);
    const wasUntermed = hasHeader(text) && !hasTerms(text);
    const next = withHeader(text);
    if (next === null) continue;
    if (check) { (wasStale ? stale : wasUntermed ? untermed : missing).push(f); continue; }
    writeFileSync(path, next);
    if (wasStale) corrected++; else written++;
  }

  if (check) {
    console.log(`spdx-headers: ${files.length} authored source file(s) checked against ${SPDX}`);
    // Reported apart, because they are different mistakes with different causes: a new file nobody ran
    // the script over, versus a licence flip that did not reach every file. A single count would let
    // half a flip read as a handful of new files.
    for (const [label, list] of [["MISSING the header", missing], ["carrying a DIFFERENT SPDX identifier", stale],
      ["MISSING the additional-terms notice — ADDITIONAL-TERMS.md does not apply to these", untermed]]) {
      if (!list.length) continue;
      console.log("");
      console.log(`${label} — ${list.length} file(s):`);
      for (const f of list.slice(0, 40)) console.log(`  ${f}`);
      if (list.length > 40) console.log(`  … and ${list.length - 40} more`);
    }
    // UNTERMED GATES, and it did not when this machinery was first written — the check listed every
    // file missing the notice and then returned 0, printing "every authored source file carries it."
    // directly beneath a list of 1,410 files that did not. A check that reports a finding and exits
    // clean is the shape this repository has a rule about: exit 0 must mean nothing was flagged.
    //
    // It also makes this branch's own claim true rather than aspirational. The notice sweep is meant to
    // be enforced from the moment the machinery lands, so that a file added next month without the line
    // is caught by the same check rather than by nobody.
    if (missing.length || stale.length || untermed.length) {
      console.log("");
      console.log("Fix them with:  node scripts/spdx-headers.mjs");
      return 1;
    }
    console.log("every authored source file carries the licence line and the additional-terms notice.");
    return 0;
  }

  console.log(`spdx-headers: ${written} file(s) given the header, ${corrected} corrected from another ` +
    `identifier, ${files.length - written - corrected} already had it`);
  return 0;
}

// — DECIDING BY FILENAME IS THE SEVENTH SPELLING, and it is the one the
// entry-point census could not see: it compares argv[1] to a literal name and never mentions
// `import.meta.url`, which is half of that guard's population test. Measured — this file under any
// other name exited 0 with ZERO BYTES of output, and comparing basenames also answers TRUE for an
// unrelated script that happens to share the name. `isEntrypoint` realpaths both sides.
if (isEntrypoint(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}

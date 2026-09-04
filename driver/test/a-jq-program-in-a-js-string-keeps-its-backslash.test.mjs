// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a jq program written in a JS string loses its backslashes, silently.
//
// `\(` INSIDE A JAVASCRIPT STRING IS NOT AN ESCAPE. JS drops the backslash and hands jq a bare `(`, so
// `"\(.number)"` reaches jq as the LITERAL text `(.number)` and jq dutifully returns that text for every
// input. The result is not an error and not an empty result — it is a plausible-looking list of constant
// strings, which downstream code compares against real values and never matches.
//
// MEASURED: `scripts/merge-preflight.mjs` shipped with this on the line that enumerates open pull
// requests. The rule it feeds — "no other ready pull request has a run in flight" — printed its green
// line every time it ever ran, and a merge moved the tip under another pull request's live run because
// of it. The SAME FILE had the correct `\\(` two calls further down, which is exactly why review passed
// over it: the right spelling was on screen, a few lines below the wrong one.
//
// So this is a corpus arm, not a line fix. It closes the class.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every tracked `.mjs`. Tracked, so an untracked scratch file cannot make this pass or fail. */
// THIS FILE EXCLUDES ITSELF, and that is the third trap the rename codemod's author wrote down: never
// run a detector over the file that holds its specimen ON PURPOSE. Two lines here trip it — the shape
// pattern on line 39 (a REGEX, where an escaped paren is correct and required) and the deliberately
// BROKEN fixture below. Reporting either would be a false positive on the one file that must contain
// them. What keeps this file honest instead is its own second arm, which drives the detector against
// both spellings and a regex, so a detector that stopped working reds there rather than going quiet.
const SELF = "driver/test/a-jq-program-in-a-js-string-keeps-its-backslash.test.mjs";
const GUARD = "jq-backslash (tracker issue 1889)";
/** Null means NO CHECKOUT — a stated skip, never an empty corpus reading as clean. */
const sources = () => {
  const all = trackedFiles(GUARD, { root: ROOT, pathspec: ["*.mjs"] });
  return all === null ? null : all.filter((f) => f !== SELF);
};

// A jq PROGRAM, told from ordinary prose by the syntax only jq uses. Deliberately narrow: this arm is
// about strings handed to jq, and a wider net over every `\(` in the tree would drag in regex literals,
// where `\(` is a real escape and entirely correct.
// `.[]` IS DELIBERATELY NOT IN THIS LIST, and that was measured rather than guessed: the first cut
// included it and immediately reported a REGEX in signa-mock-lane-is-unreachable-from-a-run.test.mjs,
// whose character class `[.[]` contains those three characters in that order. In a regex `\(` is a real
// escape and entirely correct, so that was a false positive on the one construct this arm must never
// touch. The tokens below are jq's alone and do not occur in a JS regex by accident.
const JQ_SHAPE = /\|\s*join\(|select\(\.|sort_by\(|\.workflow_runs|--jq/;
// A backslash that JS will eat: exactly one before the paren, never two.
const LONE = /(^|[^\\])\\\((?!\()/;

/** Offending {file, line, text} across the corpus. */
export function jqStringsLosingABackslash(files, read) {
  const out = [];
  for (const rel of files) {
    let text; try { text = read(rel); } catch { continue; }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!JQ_SHAPE.test(line)) continue;
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;   // a comment explaining the hazard is not the hazard
      if (!LONE.test(line)) continue;
      out.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
    }
  }
  return out;
}

test("#1889 no jq program in a JS string loses its backslash — the corpus", (ctx) => {
  const files = sources();
  if (files === null) return ctx.skip(`${GUARD}: not a git checkout — the corpus cannot be read`);
  assert.ok(!files.includes(SELF), "the self-exclusion must actually apply, or the arm below is testing "
    + "a filter that does nothing");
  // A COLLAPSED READER IS NOT A CLEAN CORPUS. If `git ls-files` returned nothing the loop below would
  // find nothing and pass having read no file at all — the same shape as the bug it hunts.
  assert.ok(files.length > 50, `only ${files.length} tracked .mjs file(s) — the reader has broken, not the tree`);
  const hits = jqStringsLosingABackslash(files, (rel) => readFileSync(join(ROOT, rel), "utf8"));
  assert.deepEqual(hits.map((h) => `${h.file}:${h.line}  ${h.text}`), [],
    "a `\\(` inside a JS string is not an escape: JS drops the backslash and jq is handed a literal "
    + "`(`, so the filter returns constant text for every input and every comparison against it fails "
    + "quietly. Write `\\\\(`. This fails by file and line because the symptom — a plausible empty "
    + "result — never reaches a log.");
});

test("#1889 the detector fires on the exact line that shipped, and spares the correct one", () => {
  // Driven against both spellings, because a detector that cannot tell them apart is worse than none.
  const BROKEN = String.raw`      '[.[]|select(.draft==false)|"\(.number) \(.head.sha)"]|join("|")').split("|")`;
  const FIXED = String.raw`      '[.[]|select(.draft==false)|"\\(.number) \\(.head.sha)"]|join("|")').split("|")`;
  const read = (rel) => (rel === "broken.mjs" ? BROKEN : FIXED);
  assert.equal(jqStringsLosingABackslash(["broken.mjs"], read).length, 1, "the shipped bug must be caught");
  assert.equal(jqStringsLosingABackslash(["fixed.mjs"], read).length, 0, "the correct spelling must not be");

  // And a REGEX literal, where `\(` is a real escape and correct, is not dragged in by the jq shape.
  assert.equal(jqStringsLosingABackslash(["r.mjs"], () => String.raw`const re = /select\(\./;`).length, 0,
    "a regex escaping a paren is legitimate and must not be reported");
});

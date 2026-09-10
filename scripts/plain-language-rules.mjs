// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// plain-language-rules.mjs — the line rules a release note and the assembled changelog are both held to.
//
// ONE LIST, TWO READERS. `release-notes-lint.mjs` reads each note on the pull request that adds it, and
// `changelog-plain-language.mjs` reads the assembled changelog for `release-version.mjs` after the merge.
// They held two lists, and the release's refused any two words joined by a slash as a path, where the
// lint's refused only a path into our tree. So a note CI passed turned main's Release red after it merged:
// "a yes/no question", 2026-09-10. Every line rule both of them apply lives here, and a test feeds the
// same notes to both.
//
// THE PATH RULE IS THE LINT'S, the narrow one, because that is the one ruled on (2026-09-05): what a reader
// types or opens is allowed, our tree is not, and ordinary prose with a slash in it is not a path.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The four the issue names, plus the two spellings each of the -ise/-ize pair it names once. A word
// list is checked whole: "implementation" is jargon, "implement" inside "implemented" is the same word,
// but "complement" is not, which is why this is a boundary match and not a substring one.
export const BANNED_WORDS = [
  "refactor", "refactors", "refactored", "refactoring",
  "implement", "implements", "implemented", "implementing", "implementation", "implementations",
  "leverage", "leverages", "leveraged", "leveraging",
  "optimise", "optimises", "optimised", "optimising", "optimisation",
  "optimize", "optimizes", "optimized", "optimizing", "optimization",
  "utilise", "utilises", "utilised", "utilising", "utilisation",
  "utilize", "utilizes", "utilized", "utilizing", "utilization",
];

// A FILE NAME is the thing a reader cannot act on: they do not have the tree open. Matched by
// extension, because a bare word with a dot in it is how every file name in this repository reads.
const FILE_NAME_RE = /\b[\w.-]+\.(mjs|js|cjs|ts|tsx|jsx|json|yml|yaml|md|sh|txt)\b/g;
// A FUNCTION NAME, in the two shapes this tree writes them: a call, and a bare camelCase identifier.
const FUNCTION_RE = /\b[a-z][A-Za-z0-9_]*\(\)|\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;
// A candidate PATH: slash-joined segments, which may open with `~`, `/`, `./` or `../`. Whether it IS one
// is decided below, by whose it is.
const PATH_TOKEN_RE = /(?:^|[\s`(])((?:~|\.{1,2})?\/?[\w.~-]+(?:\/[\w.~-]+)+\/?)/g;
const WORD_RE = new RegExp(`\\b(${BANNED_WORDS.join("|")})\\b`, "gi");

/**
 * The repository's own top-level source directories.
 *
 * A path whose first segment is one of these is a SOURCE-TREE path — `driver/test/…`, `scripts/…` — and
 * means nothing to somebody who has never opened this repository. A path that starts at the reader's own
 * home does not: `~/.config/clearotron/` is where THEIR settings are, and telling them is the note's job.
 * Ruling 2026-09-05, narrowing the contract's flat ban on "file paths": what a reader types or
 * opens is allowed; our tree is not.
 *
 * Derived from the tree rather than typed, so a directory added next month is covered without anybody
 * remembering to add it here.
 */
export function sourceDirectories(root = ROOT) {
  return new Set(readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
    .map((d) => d.name));
}

/** Everything the user documentation shows a reader, as one blob, for "is this documented" questions. */
export function userDocs(root = ROOT) {
  return readdirSync(root)
    .filter((n) => n.endsWith(".md"))
    .map((n) => readFileSync(join(root, n), "utf8"))
    .join("\n");
}

/**
 * Every line rule `raw` breaks, as `{kind, match}`, where `kind` is "jargon word", "file name", "path" or
 * "function name". PURE apart from the defaults, which read the tree; callers pass them once per run.
 *
 * Code spans are exempt from the word, file-name and function-name rules: a line that says
 * `` `clearotron framework <your-framework.md>` `` is telling a reader what to type, with a name of their
 * own in it. A path is judged wherever it sits, by whose it is: `~/.config/clearotron/` in a code span is
 * the reader's, and `driver/engine` is ours.
 */
export function lineFindings(raw, { sourceDirs = sourceDirectories(), docs = userDocs() } = {}) {
  const out = [];
  const spanless = String(raw).replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
  for (const m of spanless.matchAll(WORD_RE)) out.push({ kind: "jargon word", match: m[0] });
  for (const m of spanless.matchAll(FILE_NAME_RE)) out.push({ kind: "file name", match: m[0] });
  // A path, judged by WHOSE it is. The reader's own — `~/.config/clearotron/` — is the note's job to
  // give them. Ours is not, and "ours" is wider than this repository's directory names: an absolute
  // path into a server's filesystem is our deployment, not their machine.
  //
  // WHAT COUNTS AS A PATH AT ALL is deliberately narrow, because `and/or` is not one. A token qualifies
  // when it opens with `~`, `/`, `./` or `../`, when its first segment is one of our own directories,
  // or when a segment carries a dot. Ordinary prose with a slash in it does not.
  for (const m of String(raw).matchAll(PATH_TOKEN_RE)) {
    const path = m[1];
    if (/^https?:/.test(path)) continue;
    const segments = path.replace(/^[~./]+/, "").split("/").filter(Boolean);
    const looksLikePath = /^[~./]/.test(path) || sourceDirs.has(segments[0]) || segments.some((x) => x.includes("."));
    if (!looksLikePath) continue;
    if (path.startsWith("~")) continue;                       // the reader's own home
    if (docs.includes(path)) continue;                        // the user documentation shows it
    out.push({ kind: "path", match: path });
  }
  for (const m of spanless.matchAll(FUNCTION_RE)) out.push({ kind: "function name", match: m[0] });
  return out;
}

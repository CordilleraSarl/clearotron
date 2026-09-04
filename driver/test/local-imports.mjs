// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The transitive local-import set of a module, for fixtures that copy a real module into a temp tree.
//
// ── WHY THIS IS DERIVED AND NOT TYPED (, after) ────────────────────────────────────────
//
// A fixture that copies a module and then hand-lists the modules to copy beside it is correct exactly
// until somebody adds an import. Nothing in the diff that adds it touches the fixture, the PR that adds
// it can be green on a base that predates the fixture, and the failure is not a readable one: node dies
// on module resolution before printing anything, every arm in the file reads `undefined`, and the file
// reds for a reason with no relationship to what it tests. That is how merged green and left main
// red for five commits.
//
// The census guard's own fixture is the shape already having bitten: a `copyFileSync` line was added to
// a hand-list to fix precisely this, rather than being read as a reason for the list to stop being
// hand-written. The file it happened in does not cross the cut, so it is described rather than cited —
// a line reference a public reader cannot open tells them nothing.
//
// ── WHAT IT SEES, AND WHAT IT DOES NOT ───────────────────────────────────────────────────────────
//
// The reference implementation this replaces (`citation-line-check.test.mjs`) matched only
// `… from "./x.mjs"`. Over its own three-module graph that was complete, and it agreed with the truth
// for the wrong reason: it could not see a side-effect import, a dynamic one, or a static import whose
// `from` lands on a later line. A derivation with a hole in it is exactly as stale as the list it
// replaces, and worse, because it looks derived. All four forms are matched here and
// `local-imports.test.mjs` plants one of each.
//
// STILL NOT SEEN, and stated rather than assumed: a computed specifier (`import(`./${name}.mjs`)`),
// a re-export through a bare package name, and a specifier built at runtime. None is resolvable from
// source without evaluating it, so a fixture whose module does any of those has to say so — which is a
// better failure than a copy list that silently omits it.
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

// Four forms, one alternation, each capturing the specifier in a group. Anchored on a RELATIVE
// specifier (`./` or `../`) throughout: a bare package name is node_modules' problem, not a file to copy.
const SPECIFIERS = [
  // `import x from "./a.mjs"` · `export { y } from "./a.mjs"` — [\s\S] so a multi-line brace list is one
  // match rather than a miss, which the single-line reference form could not do.
  /\b(?:import|export)\b[\s\S]*?\bfrom\s*["'](\.[^"']+)["']/g,
  // `import "./a.mjs"` — a side-effect import, no bindings, no `from`.
  /\bimport\s*["'](\.[^"']+)["']/g,
  // `await import("./a.mjs")` · `import("./a.mjs")` — the dynamic form.
  /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
];

/**
 * Every local module `file` needs, transitively, as paths relative to `root` — `file` included.
 *
 * @param {string} file absolute path to the entry module
 * @param {string} root absolute repo root; every returned path is relative to it
 * @param {(p: string) => string} [read] injectable for the plant in local-imports.test.mjs
 * @returns {Set<string>} repo-relative paths, the entry first
 */
export function importsOf(file, root, read = (p) => readFileSync(p, "utf8"), seen = new Set()) {
  const rel = relative(root, file);
  if (seen.has(rel)) return seen;                 // a cycle is a graph, not a stack overflow
  seen.add(rel);
  const src = read(file);
  for (const re of SPECIFIERS) {
    // Fresh lastIndex per call: these are module-level /g regexes and a shared cursor would make the
    // second walk of the same file start halfway through it.
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) importsOf(resolve(dirname(file), m[1]), root, read, seen);
  }
  return seen;
}

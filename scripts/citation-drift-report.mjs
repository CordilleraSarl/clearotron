#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// citation-drift-report.mjs — CITATION DRIFT IS A RELATION BETWEEN TWO STATES.
//
//   node scripts/citation-drift-report.mjs --range <rev-range>
//
// `citation-line-check` walks ONE state of the tree and says so in its own CANNOT SEE paragraph: it
// cannot see a citation that drifted onto a different LIVE line, because there is nothing wrong with
// the line it now points at. That is a property of its shape, not a gap in its arms — no arm added to a
// tree-walking guard reaches a relation between a before and an after.
//
// A DIFF has both states. For a change, every citation pointing into a file it touches, below a net
// insertion, has moved. That needs no migration and covers all 697 citations in the tree, where
// symbol-anchoring reaches 73.
//
// ── A REPORT, NOT A GATE, AND THAT IS THE LOAD-BEARING DECISION ───────────────────────────────────
//
// 210 of 324 PR/file citation pairs move across the open queue, and most were STALE BEFORE ANYONE
// TOUCHED THEM: drift makes wrong citations wronger, it does not break correct ones. A refusal would
// stop the queue over a corpus nobody has migrated, so this exits 0 always.
//
// ── AND THE REMEDY IS THE SYMBOL, NEVER A NEW NUMBER ──────────────────────────────────────────────
//
// A renumber is the wrong repair twice: the number goes stale again at the next merge that moves the
// same file, and — measured — bumping a number that was ALREADY wrong carries a wrong citation to a new
// wrong line AND TURNS IT GREEN on the way, which is worse than leaving it. Per CONTRIBUTING the number
// is optional and the SYMBOL is the citation. A bare symbol leaves this guard's population entirely and
// cannot rot. So every PR that touches a file drains that file's citations off numbers, the guardable
// population grows as a by-product of ordinary work, and nothing is swept.
import { execFileSync } from "node:child_process";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
import { CITE_RE, indexByBasename, resolveCited, ROOT } from "./citation-line-check.mjs";

/** The hunks of one file's diff, as {oldStart, oldLines, newStart, newLines}. PURE. */
export function hunksOf(diffText) {
  const out = [];
  for (const line of String(diffText ?? "").split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    out.push({
      oldStart: Number(m[1]), oldLines: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]), newLines: m[4] === undefined ? 1 : Number(m[4]),
    });
  }
  return out;
}

/**
 * Where an OLD line ends up after these hunks.
 *
 *   { moved: false }                  nothing above it changed size
 *   { moved: true, to: <newLine> }    it shifted by a net insertion above it
 *   { inside: true }                  the cited line is INSIDE a changed hunk — the target itself moved
 *                                     or went, and this report cannot say where. Reported as its own
 *                                     kind rather than folded into "moved": a citation whose target was
 *                                     EDITED is a different conversation from one that merely slid.
 * PURE.
 */
export function whereItWent(hunks, oldLine) {
  let shift = 0;
  for (const h of (hunks ?? [])) {
    const oldEnd = h.oldStart + h.oldLines;              // exclusive
    if (oldEnd <= oldLine) { shift += h.newLines - h.oldLines; continue; }
    if (h.oldStart <= oldLine) return { inside: true };
  }
  return shift === 0 ? { moved: false } : { moved: true, to: oldLine + shift };
}

const sh = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });

/**
 * THE BASE IS THE MERGE BASE, NEVER THE ENDPOINT — and this was measured, not assumed.
 *
 * `git diff A..B` is an ENDPOINT comparison: on a branch that has fallen behind, everything the base
 * branch changed shows up as this change's work, reversed. Run on a branch four commits behind main,
 * the first cut of this report listed **24 modified files and 49 affected citations** where the branch
 * itself touched four files. Every one of those 45 extra rows was main's work presented as the
 * author's, and the remedy the report prints — drop the number, keep the symbol — would have been
 * aimed at citations nobody in this lane had gone near.
 *
 * `git merge-base` is what a pull request actually shows, and for the ordinary case where the base is
 * already an ancestor it resolves to the base itself, so nothing moves. Both spellings — `A..B` and
 * `A...B` — therefore mean the same correct thing here, which is the point: a report whose answer
 * depends on which dots the caller typed is a report nobody can quote.
 *
 * Returns { base, hunks } so the CORPUS is read at the same commit the hunks were computed against.
 * Reading it at `range.split("..")[0]` was the other half of the same bug.
 */
export function changedFileHunks(range, io = {}) {
  const git = io.git ?? sh;
  const [rawA, rawB] = String(range ?? "").split(/\.{2,3}/);
  const a = rawA || "HEAD", b = rawB || "HEAD";
  let base = a;
  try { base = git(["merge-base", a, b]).trim() || a; } catch { /* unrelated histories: the endpoint is all there is */ }
  const span = `${base}..${b}`;
  const files = git(["diff", "--name-only", "--diff-filter=M", span]).split("\n").filter(Boolean);
  const map = new Map();
  for (const f of files) map.set(f, hunksOf(git(["diff", "--unified=0", "--no-color", span, "--", f])));
  return { base, hunks: map };
}

/** Every citation on the BASE that points into one of the changed files. */
export function citationsIntoChanged(corpus, byBase, changed, exists) {
  const out = [];
  for (const { file, text } of corpus ?? []) {
    const lines = String(text ?? "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(CITE_RE)) {
        if (/^:\d+\)/.test(lines[i].slice(m.index + m[0].length))) continue;   // a stack frame is not a citation
        const r = resolveCited(m[1], byBase, exists);
        if (!r?.path || !changed.has(r.path)) continue;
        out.push({ from: file, atLine: i + 1, target: r.path, cited: Number(m[2]), text: lines[i].trim().slice(0, 120) });
      }
    }
  }
  return out;
}

/** Classify each citation against its target's hunks. PURE. */
export function driftRows(citations, changed) {
  const rows = [];
  for (const c of citations ?? []) {
    const w = whereItWent(changed.get(c.target) ?? [], c.cited);
    if (w.moved) rows.push({ ...c, kind: "moved", to: w.to });
    else if (w.inside) rows.push({ ...c, kind: "target-edited", to: null });
  }
  return rows;
}

export const REMEDY =
  "Drop the number and keep the symbol. CONTRIBUTING makes the number optional and the SYMBOL the "
  + "citation; a bare symbol leaves this report's population entirely and cannot go stale. Do NOT "
  + "renumber: the new number rots at the next merge that moves this file, and bumping one that was "
  + "already wrong carries a wrong citation to a new wrong line and turns it green on the way.";

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  const KNOWN = new Set(["--range", "--json"]);
  const unknown = argv.filter((a) => a.startsWith("--") && !KNOWN.has(a));
  if (unknown.length) {
    console.error(`citation-drift-report: unrecognised flag(s): ${unknown.join(", ")}`);
    console.error(`  This build accepts: ${[...KNOWN].join(" ")}`);
    process.exit(2);
  }
  const i = argv.indexOf("--range");
  const range = i >= 0 ? argv[i + 1] : null;
  if (!range) { console.error("citation-drift-report: usage: --range <rev-range> [--json]"); process.exit(2); }

  // AN UNREADABLE RANGE IS A COULD-NOT-LOOK, NOT A STACK TRACE. Caught in CI on this script's own PR:
  // the runner checks out at depth 1, so `HEAD~1` does not exist there and `git diff` died with
  // `fatal: Not a valid object name` — which surfaced as an uncaught `Command failed` and a Node stack.
  // A report that cannot read its range has nothing to say; saying so by name is the whole discipline
  // this script exists to serve, and a stack trace says it in the one form nobody can act on.
  //
  // Exit 2, not 0: this is the ONE case where a report must not exit 0. Exiting 0 here would print a
  // clean tick over a range it never read, which is precisely the defect the sibling half of this
  // change is about.
  let base, changed;
  try { ({ base, hunks: changed } = changedFileHunks(range)); }
  catch (e) {
    console.error(`citation-drift-report: cannot read ${range} — ${String(e?.message ?? e).split("\n")[0]}`);
    console.error("  That is a failure to look, not a clean report. A shallow checkout (depth 1) has no");
    console.error("  parent commits, so a range naming one cannot resolve there.");
    process.exit(2);
  }
  const tracked = sh(["ls-files"]).split("\n").filter((f) => /\.(mjs|js|md|json|ts|tsx|yml|yaml)$/.test(f));
  const byBase = indexByBasename(tracked);
  const corpus = [];
  for (const f of tracked) {
    // stdio "pipe" on stderr: a file added after the base makes `git show` fatal, and that is EXPECTED
    // — it simply carries no base citation. Letting it print would put fatals in a report that is fine.
    try { corpus.push({ file: f, text: execFileSync("git", ["show", `${base}:${f}`],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }) }); }
    catch { /* absent on the base — no base citation to drift */ }
  }
  // ✕ `exists: () => true` IS NOT A HARMLESS STUB. `resolveCited` short-circuits on it — any cited
  // string returns `{state:"exact", path:<the string>}` — so a citation written as a BARE BASENAME
  // resolved to that basename as a path, which is not a file, matched nothing in the changed map, and
  // the report printed a clean tick over a range with 57 hunks in a file cited from nine places. A
  // stub that makes every lookup succeed is the same as one that makes every lookup fail, except that
  // it looks like a pass.
  //
  // The example is described rather than written out, deliberately: an illustrative `file.mjs:N` in a
  // comment is a REAL citation to every guard that walks this tree, and the first draft of this note
  // was refused by citation-line-check for citing a blank span. A cautionary example lands as a live
  // one.
  //
  // The tracked SET is the honest predicate: it answers the question the default asks, without a
  // filesystem hit and without inventing a yes.
  const trackedSet = new Set(tracked);
  const rows = driftRows(citationsIntoChanged(corpus, byBase, changed, (pth) => trackedSet.has(pth)), changed);

  if (argv.includes("--json")) { console.log(JSON.stringify({ range, changed: [...changed.keys()], rows }, null, 2)); process.exit(0); }
  console.log(`citation-drift-report (tracker issue 1950): ${range}  (base ${base.slice(0, 8)})`);
  console.log(`  ${changed.size} modified file(s); ${rows.length} citation(s) affected`);
  if (!rows.length) {
    console.log("  ✓ no citation on the base points below a net insertion in a file this change touches.");
    process.exit(0);
  }
  for (const r of rows) {
    console.log(r.kind === "moved"
      ? `  ~ ${r.from}:${r.atLine} cites ${r.target}:${r.cited} — that line is now ${r.to}`
      : `  ~ ${r.from}:${r.atLine} cites ${r.target}:${r.cited} — that line is INSIDE this change; where its target went is not knowable from the diff`);
  }
  console.log(`\n  REPORTED, NOT REFUSED — this exits 0 and the merge proceeds.`);
  console.log(`  ${REMEDY}`);
  process.exit(0);
}

#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sarl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WHICH BARE CITATIONS COULD CARRY A SYMBOL, AND WHICH ONES DISAGREE WITH THEIR OWN PROSE.
//
//   node scripts/citation-anchor-report.mjs           the report
//   node scripts/citation-anchor-report.mjs --list    every row, not the first ten of each kind
//
// ── WHY THIS REPORTS AND DOES NOT REWRITE ────────────────────────────────────
//
// citation-line-check states its own blindness: it cannot see a citation pointing at the WRONG LIVE LINE
// while that line is real code, and it says the fix is to cite the symbol. The obvious next step is a
// codemod — the line is known and the file is known, so read the enclosing symbol out of the file and
// append it. Measured before building, that is the wrong move, and the measurement is worth keeping
// beside the thing it refutes.
//
// A codemod reads where the number CURRENTLY POINTS and writes that down. It cannot tell a citation that
// is right from one that has drifted, because both point somewhere, and appending the destination makes
// either self-consistent. Driven against the two citations a hand audit had already proved wrong:
//
//   verify.mjs:1539  would become "verify.mjs:1539 coverageEntryList" — the line is still
//                    `entries.push(e);` and the token it claims to site is minted three other places.
//   stages.mjs:844   would become "stages.mjs:844 inputsForReference" — the line is still a comment,
//                    and that citation carries `[citation unverified]` today, which is a reader having
//                    doubted it. The rewrite strips the doubt and leaves a green tick.
//
// So the mechanism turns roughly a hundred unverifiable citations into verified-looking ones. This script
// produces the same information as a WORKLIST instead, and changes nothing.
//
// ── WHAT IT MEASURES, AND THE TWO RULES THAT ARE NOT OBVIOUS ────────────────
//
// THE ANCHOR IS THE TOP-LEVEL DECLARATION, NOT THE INNERMOST ONE. The innermost is the literal reading of
// "the symbol enclosing that line" and it is wrong here: measured over this tree it names a local or a
// one-to-three-letter binding 29 times — `e`, `hit`, `ob`, `one`, `out`, `known`, `unplaced` — against 2
// for the top-level rule, over the same 115 citations. An anchor nobody would have written by hand is not
// an anchor; it is the number wearing a name.
//
// A CITATION POINTING INSIDE A FUNCTION IT NAMES IS CORRECT, and the innermost rule reports it as a
// disagreement. Two of this report's first six "confirmed" rows were that bug rather than a bad citation:
// publish-inputs.mjs cites mcp-server/lib/coverage.mjs:65 and names `assertValidatorCoverage`, declared at
// 63, which is exactly right. The rule below is why they no longer appear.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusOf, citationsIn, indexByBasename } from "./citation-line-check.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The gate's own matchers, restated here rather than imported because they are not exported: keeping them
// identical is the property, so any drift between the two is a defect in this file and not in the gate.
const ANY_DECL = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+[A-Za-z_$]/;
const NAME_OF = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const INDENT_OF = (l) => (String(l).match(/^[ \t]*/) || [""])[0].length;

/**
 * The top-level declaration whose span contains `line`, or null when the line is not in code at all.
 * The span ends at the next top-level declaration, which is constructRange's sibling rule at indent 0.
 * PURE.
 */
export function topLevelAnchor(lines, line) {
  let best = null;
  for (let d = 0; d < lines.length; d++) {
    if (!ANY_DECL.test(lines[d]) || INDENT_OF(lines[d]) !== 0) continue;
    const name = (lines[d].match(NAME_OF) || [])[1];
    if (!name) continue;
    let end = d + 1;
    while (end < lines.length && !(ANY_DECL.test(lines[end]) && INDENT_OF(lines[end]) === 0)) end++;
    if (line >= d + 1 && line <= end && (!best || d + 1 > best.declaredAt)) best = { name, declaredAt: d + 1, end };
  }
  return best;
}

/**
 * The identifiers the citing line CLAIMS, which is not every word in it. Only a backticked span or a name
 * shaped like code counts — camelCase, SCREAMING_SNAKE, or a `$`/`_` in it.
 *
 * MEASURED, NOT ASSUMED: taking every word put "spec", "one", "model", "skills" and "config" forward as
 * identifier claims, because each is also declared somewhere in some cited file, and the drifted count
 * went from a handful to 120. A report whose worklist is mostly English words is a worklist nobody reads.
 * Longest first, so a suffix never shadows its owner.
 */
const namesIn = (sentence) => {
  const s = String(sentence);
  const ticked = [...s.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]);
  const shaped = [...s.matchAll(/[A-Za-z_$][\w$]{2,}/g)].map((m) => m[0])
    .filter((n) => /[a-z][A-Z]/.test(n) || /^[A-Z0-9_]{3,}$/.test(n) || /[_$]/.test(n));
  return [...new Set([...ticked, ...shaped])].sort((a, b) => b.length - a.length);
};

/**
 * One row per bare citation whose target sits in code. PURE given its readers.
 *
 * `verdict` is one of:
 *   corroborated  the citing prose names the anchor — safe to append, and the only class that is
 *   silent        the prose names no identifier at all, so there is nothing to check the anchor against
 *   disagrees     the prose names something else that is NOT declared in the cited file — weak evidence,
 *                 because it is usually a caller or a type rather than a claim about this file
 *   drifted       the prose names something DECLARED ELSEWHERE in the cited file, and the citation does
 *                 not point inside it. That is the shape of a number that moved.
 */
export function anchorRows(citations, linesOf) {
  const rows = [];
  for (const c of citations) {
    if (c.symbols?.length) continue;                       // already checkable
    const target = linesOf(c.path ?? c.cited);
    if (!target) continue;
    const anchor = topLevelAnchor(target, c.start);
    if (!anchor) { rows.push({ ...c, verdict: "no-code", anchor: null }); continue; }
    const prose = namesIn(linesOf(c.from)?.[c.atLine - 1] ?? "");
    if (prose.includes(anchor.name)) { rows.push({ ...c, verdict: "corroborated", anchor }); continue; }
    const others = prose.filter((n) => n !== anchor.name);
    if (!others.length) { rows.push({ ...c, verdict: "silent", anchor }); continue; }
    let elsewhere = null;
    for (const n of others) {
      const decl = new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|const|let|var|class)\\s+${n.replace(/\$/g, "\\$")}\\b`);
      for (let i = 0; i < target.length; i++) {
        if (!decl.test(target[i])) continue;
        // THE CITATION POINTING INSIDE WHAT IT NAMES IS CORRECT, not drifted — see the header.
        const span = topLevelAnchor(target, i + 1);
        if (span && c.start >= span.declaredAt && c.start <= span.end) { elsewhere = null; i = target.length; n; break; }
        elsewhere = { name: n, declaredAt: i + 1 };
        break;
      }
      if (elsewhere) break;
    }
    rows.push({ ...c, verdict: elsewhere ? "drifted" : "disagrees", anchor, elsewhere });
  }
  return rows;
}

function main() {
  const loaded = corpusOf(ROOT);
  if (loaded == null) {
    console.log("citation-anchor-report did not run — no tracked corpus. This is a SKIP, not a pass.");
    process.exit(0);
  }
  const { files, corpus } = loaded;
  const text = new Map(corpus.map((c) => [c.file, c.text.split("\n")]));
  const linesOf = (p) => {
    if (text.has(p)) return text.get(p);
    try { const l = readFileSync(join(ROOT, p), "utf8").split("\n"); text.set(p, l); return l; } catch { return null; }
  };
  const citations = citationsIn(corpus, indexByBasename(files));
  const bare = citations.filter((c) => !c.symbols?.length);
  const rows = anchorRows(citations, linesOf);
  const by = (v) => rows.filter((r) => r.verdict === v);
  const all = process.argv.includes("--list");
  const show = (v) => (all ? by(v) : by(v).slice(0, 10));

  console.log(`citation-anchor-report — ${citations.length} citation(s), ${citations.length - bare.length} already name a symbol, ${bare.length} BARE`);
  console.log(`  ${by("no-code").length} of the bare point at prose, comments, skill documents or data — there is NO symbol to cite,`);
  console.log("      and the gate's own advice cannot be followed on them. That is a guard-design question, not a chore.");
  console.log(`  ${rows.length - by("no-code").length} point at a line inside code:`);
  console.log(`      corroborated  ${by("corroborated").length}  the citing prose names the enclosing symbol — appending it is safe`);
  console.log(`      drifted       ${by("drifted").length}  the prose names something declared ELSEWHERE in the cited file`);
  console.log(`      disagrees     ${by("disagrees").length}  the prose names something not declared there — usually a caller, weak evidence`);
  console.log(`      silent        ${by("silent").length}  the prose names nothing to check the anchor against`);

  if (by("drifted").length) {
    console.log("\nDRIFTED — read these first. Each names a symbol this file declares somewhere the citation does not point:");
    for (const r of show("drifted")) {
      console.log(`  ${r.from}:${r.atLine}`);
      console.log(`     cites ${r.cited}:${r.start}, which is inside ${r.anchor.name}`);
      console.log(`     names ${r.elsewhere.name}, declared at ${r.elsewhere.declaredAt}`);
    }
  }
  if (by("corroborated").length) {
    console.log("\nCORROBORATED — the anchor can be appended by hand with the prose as the check:");
    for (const r of show("corroborated")) console.log(`  ${r.from}:${r.atLine}  ${r.cited}:${r.start} → ${r.anchor.name}`);
  }
  if (!all && (by("drifted").length > 10 || by("corroborated").length > 10)) console.log("\n  (--list for every row)");

  // A REPORT EXITS 0. Its `drifted` class is evidence for a person, not a decidable defect: the prose can
  // name a symbol for a reason the citation is not about, and this file's own header records two rows it
  // got wrong before the rule was fixed. A worklist that fails a build teaches people to silence it.
  console.log("\nThis is a worklist, not a gate — it exits 0 on every finding. citation-line-check is the gate.");
  process.exit(0);
}

if (isEntrypoint(import.meta.url)) main();

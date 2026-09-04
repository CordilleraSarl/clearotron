// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — EVERY CITATION IN A STAGE-CONTRACT `why` STRING SAYS WHICH OF THREE STATES IT IS IN.
//
// A `why` string is prose a person reads to learn why an element is classified as it is. A citation
// inside one that has drifted is WORSE than no citation: it looks like evidence and sends the reader to
// plausible code that does not say what the entry claims, and nothing fails when it happens.
//
// Measured over all 81 citations in this table — by taking the phrase each entry QUOTES and finding
// where that phrase actually lives, never by reading the cited line: 28 agreed, 39 pointed elsewhere in
// the file, 14 named nothing joinable.
//
// The three states, and the invariant this file holds:
//
//   sym() in file.mjs           CONVERTED — resolved from what the entry quotes, checked by
//   SYM declared in file.mjs    citation-line-check.mjs against the declaration.
//
//   file.mjs:N                  a `.md` / `.json` target, which has no symbol to name.
//
//   file.mjs:N … [citation unverified]
//                               nothing in the entry joins to the cited file. NOT converted: reading the
//                               cited line and writing down whatever symbol sits there would encode a
//                               wrong anchor in a form the gate then certifies as correct.
//
// THE INVARIANT: a `why` string may not carry a line citation into CODE unless its entry is marked
// unverified. That is what stops the next edit adding a bare stale number back, which is how the corpus
// reached 39 wrong in the first place.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const STAGES_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "stages.mjs");
const LINE_CITE = /\b([A-Za-z0-9._-]+\.(?:mjs|json|md|ts))[:\s]?:(\d+)(?:-(\d+))?/g;
const SYMBOL_CITE = /\b[A-Za-z_$][A-Za-z0-9_$]*\(\)\s+in\s+[A-Za-z0-9._-]+\.mjs|\b[A-Za-z_$][A-Za-z0-9_$]*\s+declared\s+in\s+[A-Za-z0-9._-]+\.mjs/g;
const MARKER = "[citation unverified]";

function whyStrings() {
  return readFileSync(STAGES_SRC, "utf8").split("\n")
    .map((text, i) => ({ line: i + 1, text }))
    .filter((r) => /^\s*why: "/.test(r.text));
}

test("the corpus is still there — a matcher that stopped matching would pass every arm below", () => {
  // The instrument check, first. Every arm here is "no offenders", and an extractor returning nothing
  // satisfies all of them. This repo has been caught by that shape before.
  const w = whyStrings();
  assert.ok(w.length > 200, `only ${w.length} why strings found — the extractor broke, this is not a clean tree`);
  const syms = w.flatMap((r) => [...r.text.matchAll(SYMBOL_CITE)]);
  assert.ok(syms.length >= 30, `only ${syms.length} symbol citations — the conversion has been undone, not merely edited`);
});

test("no `why` string cites a LINE in code unless its entry is marked unverified", () => {
  // The growth property, and the whole point. Without it the next edit adds a bare `verify.mjs:1113`
  // back and nothing says a word — which is exactly how 39 of 81 came to point at the wrong place.
  const offenders = [];
  for (const r of whyStrings()) {
    if (r.text.includes(MARKER)) continue;
    LINE_CITE.lastIndex = 0;
    for (const m of r.text.matchAll(LINE_CITE)) {
      if (!/\.(mjs|ts)$/.test(m[1])) continue;         // a .md/.json target has no symbol to name
      offenders.push(`stages.mjs:${r.line} cites ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [],
    "these cite a code line from a why string and claim nothing about whether it is right. Either resolve "
    + "the citation from what the entry QUOTES and write it as `sym() in file.mjs`, or mark the entry "
    + `${MARKER} — never by reading the cited line, which is how a wrong anchor gets certified:\n  `
    + offenders.join("\n  "));
});

test("a marker means a LINE citation is still there — an orphan marker is a lie about work not done", () => {
  // The reverse arm. Once someone converts a marked entry they must take the marker with it, or the
  // table grows markers that describe nothing and the next reader learns to ignore them.
  const orphans = [];
  for (const r of whyStrings()) {
    if (!r.text.includes(MARKER)) continue;
    LINE_CITE.lastIndex = 0;
    const code = [...r.text.matchAll(LINE_CITE)].filter((m) => /\.(mjs|ts)$/.test(m[1]));
    if (!code.length) orphans.push(`stages.mjs:${r.line}`);
  }
  assert.deepEqual(orphans, [],
    `these carry ${MARKER} with no code line citation left to be unverified about. If the citation was `
    + "converted, remove the marker in the same edit:\n  " + orphans.join("\n  "));
});

test("a converted citation names no line — the number is the part that goes stale", () => {
  // A symbol form with a line number glued to the end would be the worst of both: it reads as anchored
  // and still rots. (Not written out here with a filename — this scanner would read the example itself
  // as a citation, which is the shape.)
  const hybrids = whyStrings().flatMap((r) =>
    [...r.text.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*(?:\(\))?\s+(?:declared\s+)?in\s+[A-Za-z0-9._-]+\.mjs):\d/g)]
      .map((m) => `stages.mjs:${r.line}: ${m[1]}:N`));
  assert.deepEqual(hybrids, [],
    "a symbol citation carrying a line number reads as anchored and still rots:\n  " + hybrids.join("\n  "));
});

test("the marker is spelled ONE way, so it can be found and worked off", () => {
  // A backlog nobody can enumerate is not a backlog. Variants like "[unverified citation]" would leave
  // rows out of every count, and this is a list somebody has to finish.
  const src = readFileSync(STAGES_SRC, "utf8");
  const variants = [...src.matchAll(/\[[^\]]*\bunverified\b[^\]]*\]/g)].map((m) => m[0]);
  const distinct = [...new Set(variants)];
  assert.deepEqual(distinct, [MARKER],
    `one spelling only, or the backlog cannot be counted: ${distinct.join(" | ")}`);
  assert.ok(variants.length >= 20,
    `${variants.length} markers — if this has fallen sharply, check the work was done rather than deleted`);
});

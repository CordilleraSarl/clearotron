#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Removes the internal citation OPENER from comments and prose in the tree (tracker issue 309).
//
// The form is `tracker issue NNN — ` standing at the head of a sentence, where the citation is not part
// of what the sentence says but a label in front of it. Stripping the opener leaves the sentence intact:
//
//     // tracker issue 1149 — the walk must start at the repository root
//     // the walk must start at the repository root
//
//     assert.ok(x, "Refs tracker issue 2075 — an absent file is a finding")
//     assert.ok(x, "an absent file is a finding")
//
// WHY THE PATTERN LOOKS OVER-SPECIFIED. Three parts of it are load-bearing and each was measured, not
// reasoned:
//
//   · THE CAPTURE GROUP. The match begins at the line opener — a comment leader, a quote, a bracket —
//     and the replacement is `$1`, which puts that opener back. Without the group the sweep deletes the
//     opening quote of every test name it touches, and a broken string literal is a syntax error in the
//     lucky cases and a changed assertion in the unlucky ones.
//   · `\s+` AFTER THE SEPARATOR, never `\s*`. `tracker issue 1149-12` is an ITEM suffix, not a citation
//     followed by prose: there is no space after its hyphen. `\s*` eats the item number.
//   · THE `i` FLAG. `Refs tracker issue NNN` is capitalised at the head of a commit-style line and is a
//     fifth of the corpus.
//
// WHAT IT WILL NOT TOUCH, and both exclusions are BY NAME rather than by pattern, because a pattern that
// could recognise them could also stop recognising them:
//
//   · THE FILES THAT USE A CITATION AS TEST DATA. Three tests feed a citation to the guard that refuses
//     citations and assert what comes back. A sweep that rewrites their fixtures edits the corpus the
//     guard is checked against, and the guard then passes on something it has stopped checking. That is
//     a green tick bought by deleting the question.
//   · THE FROZEN RENDERER. `driver/publish/render.mjs` is pinned at a content hash. Changing it reds its
//     freeze check, and the repair of a sentence is not worth spending a freeze on; touching it needs an
//     entry in the break ledger, which is a decision and not a sweep.
//
// USAGE
//
//     node scripts/strip-tracker-citations.mjs            # report only: per-class counts + hand-off list
//     node scripts/strip-tracker-citations.mjs --apply    # rewrite the mechanical cases
//
// The report is the default because the hand-off list is the point: the lines this cannot do are the
// ones a person has to read, and a sweep that rewrote first would bury them.
//
// THIS COUNTS EVERY LINE CARRYING THE FORM, including lines another stripper would also catch. That is
// deliberate and it is why this number will not match the reference-strip backlog's. A sweep STRIPS; a
// backlog SELECTS. Overlapping strippers cost nothing and a missed line ships a citation into a public
// tree, so the population here is the whole corpus rather than the residue left after other rules have
// taken their share. Reconciling the two numbers is a category error: they answer different questions.
//
// A NOTE ON THE OTHER RESIDUE, because the names invite the confusion. `driver/reference-strip-
// signatures.mjs` counts a DIFFERENT thing — sentences the earlier strip left unfinished, `'s` with
// nothing to possess and a dangling `pre- `. That is damage: a defect whether or not anyone rules on
// citations, with a floor that should fall to zero as sentences are repaired. This file's subject is
// intact text that a ruling removes, whose population goes to zero the day the sweep runs and then
// wants a guard against reintroduction rather than a backlog. Different residue, different repair.
import { readFileSync, writeFileSync } from "node:fs";
import { publishedPopulation } from "./published-population.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

// The mechanical case: a citation standing in front of a sentence, with the opener captured so it
// survives the replacement.
export const OPENER = /((?:^|["'`(\[]|\/\/|\/\*|#|\*|·|──)\s*)(?:refs\s+)?tracker issues?\s+\d+\s*[—:–-]\s+/i;

// Any remaining citation, mechanical or not. The difference between this count and the opener count is
// the hand-off: a citation inside a sentence cannot be removed without rewriting the sentence around it.
export const ANY_CITATION = /\btracker issues?\s+\d+/i;

export const EXCLUDED = [
  // Citations used as literal test DATA — the corpus the citation guard is checked against.
  "driver/test/a-bare-reference-added-in-a-diff-is-refused.test.mjs",
  "driver/test/prompt-payload-names-no-tracker-issue.test.mjs",
  "driver/test/euipo-environment-doctrine.test.mjs",
  // THIS RULE'S OWN DEFINITION, and it caught itself. Both files below QUOTE the residue in order to
  // define it — the specimens the sweep is tested against, and the worked examples in the header above.
  // Sweeping them rewrites the corpus this instrument is checked by, and it would then pass on something
  // it had stopped checking: the arms would assert that a stripped line equals a stripped line. The
  // sibling module that counts the earlier strip's residue learned the same lesson and names its own
  // three files for the same reason. Found by running the sweep after fixing its report, which is the
  // only reason it surfaced: before that, these lines were counted and never listed.
  "scripts/strip-tracker-citations.mjs",
  "driver/test/the-citation-strip-removes-openers-and-nothing-else.test.mjs",
  // Pinned at a content hash; a prose repair is not worth spending a freeze on.
  "driver/publish/render.mjs",
];

export const isScannable = (f) =>
  /\.(mjs|md|yml|ts|js|json)$/.test(f) && !f.startsWith("portal-ui/dist/") && !EXCLUDED.includes(f);

/** Per-file classification. PURE, and `read` is injected so an arm can drive it over a synthetic tree. */
export function surveyOf(files, read) {
  const stripped = {}, handoff = [], unreadable = [];
  let strippedTotal = 0, remainingTotal = 0;
  for (const f of files.filter(isScannable)) {
    let text;
    // AN UNREADABLE FILE IS A FINDING, NOT A QUIET SKIP. This used to `continue` into no counter and no
    // error channel, so "I could not open this" and "there was nothing to do here" produced identical
    // output — in the report whose whole job is to tell somebody a hundred-file rewrite is safe. The
    // count is reported before anything else when it is non-zero.
    try { text = read(f); } catch (e) { unreadable.push({ file: f, why: String(e?.message ?? e).slice(0, 120) }); continue; }
    let n = 0;
    // CLASSIFY AFTER REPLACING, NOT INSTEAD OF IT. The replacement is not global, so a line carrying an
    // opener AND a second citation further along was stripped once, counted as done, and never reached
    // the hand-off list a person is told to read — its survivor was invisible in the one place it should
    // have been named. Test the RESULT: a line can be both stripped and still owed to a reader.
    const out = text.split("\n").map((line, i) => {
      const after = OPENER.test(line) ? (n++, line.replace(OPENER, "$1")) : line;
      if (ANY_CITATION.test(after)) handoff.push({ file: f, line: i + 1, text: after.trim() });
      return after;
    });
    if (n) { stripped[f] = n; strippedTotal += n; }
    remainingTotal += out.filter((l) => ANY_CITATION.test(l)).length;
    if (APPLY && n) writeFileSync(join(ROOT, f), out.join("\n"));
  }
  return { strippedTotal, remainingTotal, stripped, handoff, unreadable };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // THE PUBLISHED POPULATION, NOT THE INDEX — see scripts/published-population.mjs. The counts this
  // prints are read as a statement about the public tree, and under an overlay `git ls-files` would
  // have made them a statement about the withheld corpus instead.
  const tracked = publishedPopulation(ROOT, {
    includeStaged: process.argv.includes("--include-staged"),
    what: "this survey",
  });
  const s = surveyOf(tracked, (f) => readFileSync(join(ROOT, f), "utf8"));
  // BEFORE ANYTHING ELSE, because every number under it is about the files that COULD be read.
  if (s.unreadable.length) {
    console.log(`${s.unreadable.length} file(s) COULD NOT BE READ — every count below excludes them:`);
    for (const u of s.unreadable) console.log(`  ${u.file}  ${u.why}`);
    console.log("");
  }
  console.log(`${APPLY ? "stripped" : "would strip"} ${s.strippedTotal} opener(s) across ${Object.keys(s.stripped).length} file(s)`);
  console.log(`${s.handoff.length} citation(s) are NOT openers and need a reader — the hand-off list:`);
  for (const h of s.handoff) console.log(`  ${h.file}:${h.line}  ${h.text.slice(0, 110)}`);
  console.log(`\n${s.remainingTotal} citation(s) would remain after this sweep.`);
  console.log(`excluded by name: ${EXCLUDED.join(", ")}`);
}

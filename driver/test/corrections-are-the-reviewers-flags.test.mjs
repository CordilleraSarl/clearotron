// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE CORRECTIVE CHANNEL READ THE REVIEWER'S SELF-CHECK QUESTIONS AS ITS CORRECTIONS.
//
// `parseCorrections` selected on `^(?:[-*•]|\d+[.)])\s+\S`. The reviewer writes its flags bold-numbered,
// `**1. [kind: coverage-disposition] [on: 4] …`, and against that line `^[-*•]` matches the first
// asterisk and then `\s+` meets the second: EVERY typed correction was skipped. On the preserved review
// this was found against — an R2 comparison round, 2026-08-22 — the parser returned 10 lines with 0
// carrying a `[kind:]` token, over a document holding 14 bold-numbered corrections of which 14 were typed.
//
// Three consumers, and only one is telemetry: the corrective pass's typed worklist, 's scope
// narrowing (which never obtained, because the matched lines carry no `[on:]` either), and the BLOCKING
// verdict's published `blockingGrounds` — which on that run were five self-check answers that all read as
// PASSING, over a review whose real ground was a wrong regulatory fact on the opening page.
//
// The fixture below is BUILT, not copied: same structure, invented content. The review it reproduces
// names a real third party and a run codename, and neither belongs in this tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCorrections, parseCorrectionKinds, countCitedDefects, correctionFlagContent, opensWithKind, NOT_A_CORRECTIONS_SECTION_RE } from "../verify.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// The three shapes that matter, in the arrangement the reviewer actually produces them:
//   - self-check questions, bulleted and bolded, in an EARLIER section;
//   - the PLAN-EXECUTION CHECK section, which was already excluded and must stay excluded;
//   - bold-numbered typed flags, one of which carries a nested bullet list of quoted excerpts in its body.
const REVIEW = `# BLOCKING

## Headline sanity — re-derived independently

- **Self-conflict?** Live, and handled correctly in the body.
- **Compared as wholes?** Yes. Nothing distinguished is rated above a bare identical.
- **Risk shape?** The shape is not overstated on this record set.
- **Probative grading?** No enforcement history is claimed that the files do not carry.

## PLAN-EXECUTION CHECK

- every planned slice was executed
- 3 deferred rows, each named

## Flagged corrections

**1. [kind: coverage-disposition] [on: 4] The narrative reads a deferred row as clean**
Quoted: *"the sweep returned nothing of note"*
The plan marks that slice deferred, so the ledger cannot support a negative.
**Fix:** state the deferral.

**2. [kind: fact] [on: 7] The registration date contradicts the record**
The record carries a later date than the narrative asserts.
**Fix:** correct the sentence.

**3. [kind: rating] [on: 2] The band is reached by averaging two reads**
**Fix:** state the two positions apart.

**4. [kind: narrative] [on: -] Ordering buries the adverse finding**
The strongest objection is introduced after two paragraphs of context.
**Fix:** lead with it.

**5. [kind: narrative] [on: -] Several sentences overstate the field's clarity**
- *"the position is settled"*
- *"no meaningful obstacle remains"*
- *"the field is clear on this point"*
**Fix:** qualify each.
`;

test("#1558 the reviewer's bold-numbered flags are the corrections, and all of them are typed", () => {
  const rows = parseCorrections(REVIEW);
  assert.equal(rows.length, 5, "five flags in the fixture — the bold-numbered ones");
  assert.equal(rows.filter((r) => r.typed).length, 5, "and every one of them carries its declared kind");
  assert.deepEqual(parseCorrectionKinds(REVIEW).counts,
    { "coverage-disposition": 1, fact: 1, rating: 1, narrative: 2 },
    "the histogram is the reviewer's own declaration, not the fail-safe");
});

test("#1558 the self-check questions are NOT corrections", () => {
  // Fixing the numerator without the denominator leaves the verdict grounds wrong: these lines are what
  // got published as the stated grounds of a BLOCKING verdict, and every one of them reads as passing.
  const rows = parseCorrections(REVIEW);
  for (const q of ["Self-conflict", "Compared as wholes", "Risk shape", "Probative grading"])
    assert.ok(!rows.some((r) => r.text.includes(q)), `${q} was selected as a correction`);
});

test("#1558 a quoted excerpt nested in a flag's body is body, not a sixth flag", () => {
  const rows = parseCorrections(REVIEW);
  assert.ok(!rows.some((r) => /^\*"/.test(r.text)), "a bullet inside a correction's body is not a correction");
  assert.ok(!rows.some((r) => /the position is settled/.test(r.text)));
});

test("#1558 the PLAN-EXECUTION CHECK section stays excluded", () => {
  const rows = parseCorrections(REVIEW);
  assert.ok(!rows.some((r) => /planned slice|deferred rows, each named/.test(r.text)));
});

test("#1558 #655's scope channel obtains — every flag declares which finding it is about", () => {
  // The matched lines used to carry no `[on:]` either, so `correctionScope` was always "" and the pass
  // fell back to the wide re-emit that measured at 683 s for one moved finding.
  const rows = parseCorrections(REVIEW);
  assert.equal(rows.filter((r) => r.ordinals !== null).length, 5, "all five declare a scope");
  assert.deepEqual(rows[0].ordinals, [4]);
  assert.deepEqual(rows[3].ordinals, [], "`[on: -]` is an explicit no-finding, and is not null");
});

test("#1558 untyped === total is reported as a parse failure, not as a histogram", () => {
  // A fail-safe that fires on every line is indistinguishable from a fail-safe that never fired. The
  // all-zero histogram catches is legible as an anomaly; `fact: 10` on a BLOCKING run is not.
  const untypedOnly = "# BLOCKING\n\n## Flagged corrections\n\n1. the narrative is wrong about the date\n2. the band is too high\n";
  const k = parseCorrectionKinds(untypedOnly);
  assert.equal(k.total, 2, "numbered flags are still selected — the skill promises that fail-safe");
  assert.equal(k.untyped, 2);
  assert.equal(k.ok, false, "and the parse says so");
  assert.match(k.why, /kind channel yielded nothing|untyped fail-safe/);
  // A healthy parse says ok and carries no reason.
  const good = parseCorrectionKinds(REVIEW);
  assert.equal(good.ok, true);
  assert.equal(good.why, undefined);
  assert.equal(parseCorrectionKinds("# CLEAR\n\nnothing here\n").ok, true, "an empty parse is not a failure");
});

test("#1558 countCitedDefects keeps its permissive walk — the two guards instruct opposite actions", () => {
  // It decides whether to REFUSE a BLOCKING verdict as degenerate. Being wrong there discards a real
  // review, so permissive evidence is correct — and it must NOT inherit this file's precision.
  assert.ok(countCitedDefects(REVIEW) > parseCorrections(REVIEW).length,
    "the degenerate check still counts every list line, including the ones that are not flags");
});

test("#1558 the flag predicate, on the shapes it has to tell apart", () => {
  // Two functions, because they answer two questions. `correctionFlagContent` asks "is this a list
  // item, and what does it say" — deliberately permissive, and the fix to the bug that started this:
  // it can now see a BOLD-numbered item, which the old selector could not.
  assert.equal(correctionFlagContent("**1. [kind: fact] [on: 2] wrong date**"), "[kind: fact] [on: 2] wrong date**");
  assert.equal(correctionFlagContent("1. [kind: fact] wrong date"), "[kind: fact] wrong date");
  assert.equal(correctionFlagContent("- [kind: fact] wrong date"), "[kind: fact] wrong date");
  assert.equal(correctionFlagContent("- **Risk shape?** the shape is fine"), "**Risk shape?** the shape is fine");
  assert.equal(correctionFlagContent("plain prose"), null);
  assert.equal(correctionFlagContent(""), null);
  assert.equal(correctionFlagContent(null), null);

  // `opensWithKind` asks the question the skill actually dictates: does this flag DECLARE itself.
  assert.equal(opensWithKind("[kind: fact] wrong date"), true);
  assert.equal(opensWithKind("**Risk shape?** the shape is fine"), false);
  assert.equal(opensWithKind('*"a quoted excerpt"'), false);
  assert.equal(opensWithKind("the owner is wrong, [kind: fact] belatedly"), false,
    "OPENS with, not contains — a token buried mid-sentence is prose, and the skill says the flag opens with it");
});

test("#1558 a review that types NOTHING keeps #571's fail-safe, and says the channel is empty", () => {
  // The rule is the skill's own: \"Either every flag has one or none of them do any work.\" With nothing
  // declared, every list item is a candidate flag routed to `fact` — a flag must never vanish for
  // lacking a token. What changes is that the counts no longer stand alone as if they meant something.
  const untyped = "BLOCKING\n\n- the owner is wrong\n- the tier is wrong\n";
  const k = parseCorrectionKinds(untyped);
  assert.equal(k.total, 2);
  assert.equal(k.untyped, 2);
  assert.equal(k.counts.fact, 2, "#571's contract, unchanged");
  assert.equal(k.ok, false, "but the parse now says the kind channel yielded nothing");
});

test("#1558 an untyped flag sitting AMONG typed ones still counts — #526's contract", () => {
  // The rule that would have been cleaner — "if anything is typed, only typed lines are flags" — breaks
  // exactly here, and fixed this on purpose. Kept as an arm so nobody re-derives it.
  const mixed = "BLOCKING\n\n## Corrections\n"
    + "- [kind: fact] the owner attribution is unsupported\n"
    + "- an untyped line that must still read as a fact correction\n"
    + "- [kind: rating] the band is averaged\n";
  const rows = parseCorrections(mixed);
  assert.equal(rows.length, 3, "all three are flags — the untyped one does not vanish for lacking a token");
  assert.equal(rows.filter((r) => r.typed).length, 2);
  assert.equal(parseCorrectionKinds(mixed).counts.fact, 2, "the untyped line lands on the fail-safe");
  assert.equal(parseCorrectionKinds(mixed).ok, true, "a partially typed review is not a parse failure");
});

test("#1558 a bulleted review never trips the body rule — every bullet stays a flag", () => {
  // The body rule keys on having seen an ENUMERATED flag — numbered or, since, lettered. A review
  // that writes its flags as bullets throughout has neither, so nothing is ever reclassified as body.
  // That is what keeps and intact.
  const bulleted = "BLOCKING\n\n- [kind: fact] one\n- [kind: rating] two\n- three, untyped\n";
  assert.equal(parseCorrections(bulleted).length, 3);
});

test("#1558 the excluded-section list is pinned to the skill's own headings", () => {
  // "A guard's subject list is as complete as whoever typed it." The exclusion in verify.mjs names the
  // reviewer's SELF-audit sections; if the skill grows another one and nobody updates that regex, its
  // bullets silently start feeding the corrective worklist and the verdict's grounds. So the skill is
  // read here and every heading must be classifiable — this fails on a heading it has never seen.
  const skill = readFileSync(join(HERE, "..", "skills", "narrative-refutation", "SKILL.md"), "utf8");
  const headings = skill.split("\n").filter((l) => /^#{2,4}\s+\S/.test(l)).map((l) => l.replace(/^#+\s*/, "").trim());
  assert.ok(headings.length >= 10, `expected the skill's section list, found ${headings.length}`);
  // The reviewer's own self-audit sections — these must be excluded, or their bullets become corrections.
  const selfAudit = headings.filter((h) => /headline sanity|self-coherence|your own output must be coherent|plan-execution/i.test(h));
  assert.ok(selfAudit.length >= 2, `the skill should carry the self-audit sections this guard excludes; found ${JSON.stringify(selfAudit)}`);
  for (const h of selfAudit)
    assert.ok(NOT_A_CORRECTIONS_SECTION_RE.test(h), `the skill has a self-audit section the exclusion does not match: "${h}"`);
  // And a findings section must NOT be excluded, or the guard would eat the flags it exists to keep.
  for (const h of ["Tier-inversion checks", "Content-model checks", "Overconfident-negative checks"])
    assert.ok(!NOT_A_CORRECTIONS_SECTION_RE.test(h), `"${h}" carries flags and must not be excluded`);
});

// ── criterion 5 — THE TELL HAS TO REACH AN ARTIFACT ────────────────────────────────────────────
//
// `parseCorrectionKinds().ok` is computed above and was, until this arm, recorded nowhere: the run.jsonl
// row hardcoded `ok: true`, and that key already means "the file parsed without throwing". So an artifact
// could read `ok: true` on a run whose kind channel yielded nothing — the exact inference the tell exists
// to prevent, with a name collision on top.
//
// A SOURCE SCAN, AND ITS LIMIT IS WORTH STATING: it proves the key is written at both arms of the call
// site, not that a real run emits it. Nothing in this suite drives that pipeline branch — which is how
// the hardcoded `ok: true` survived in the first place. A run-level assertion belongs to the test lane.
test("#1558 the kind-channel tell is recorded at the call site, on BOTH arms", () => {
  const src = readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");
  const rows = src.split("\n").filter((l) => /runLog\(.*event:\s*"correction-kinds"/.test(l));
  assert.equal(rows.length, 2, `expected the success and failure arms, found ${rows.length}`);
  for (const r of rows)
    assert.match(r, /kindChannelOk:/,
      "a row without the key reads as 'the channel was fine', which is the inference this closes");
  // And it must not be spelled as a reuse of `ok`, which carries a different fact.
  const success = rows.find((r) => /ok:\s*true/.test(r));
  assert.ok(success, "the success arm still records that the parse itself did not throw");
  assert.match(success, /kindChannelOk:\s*ck\.ok\s*!==\s*false/,
    "and the tell is taken from parseCorrectionKinds, not recomputed or hardcoded");
});

// ── — THE SELECTOR WAS A CLAIM ABOUT THE REVIEWER'S HANDWRITING, AND THE REVIEWER CHANGED HANDS ──
//
// taught the selector to see `**1.`. The reviewer also writes `**A.`, and against that form the
// parse returned the CLOSED resolution bullets from elsewhere in the document and none of the open
// defects: a worklist of already-fixed things, and an empty set for what still stands. Measured over the
// 27 distinct preserved reviews on the dev box, 3 documents change — two of which parsed to ZERO before,
// their whole corrections section being lettered.
//
// Built, not copied: same structure as the live review, invented content.
const LETTERED = `# CONDITIONAL

## Headline sanity — re-derived, unchanged

- **Risk shape?** Not overstated on this record set.

## Flagged corrections

**A. [kind: fact] [on: 6, 18]** — The demotion receipt asserts a negative the archive contradicts.
- \`_records/aa-0000000000000000000000000000000000.json\` (one live registration, word only)
- \`_records/bb-1111111111111111111111111111111111.json\` (a second, same class)
**Fix:** withdraw the receipt or cite the rows.

**B. [kind: coverage-disposition] [on: -]** — A stated coverage limit is false against the ledger.
**Fix:** state the deferral.

**C. [kind: narrative] [on: -]** — One engine-only noun survives on a client-facing line.
`;

test("#1674 a LETTERED flag is a flag — the enumeration style is the reviewer's, not the contract's", () => {
  const rows = parseCorrections(LETTERED);
  assert.equal(rows.length, 3, `the three open defects, not the self-audit bullet; got ${JSON.stringify(rows.map((r) => r.text.slice(0, 40)))}`);
  assert.equal(rows.filter((r) => r.typed).length, 3, "every one declares its kind — none reaches the untyped fail-safe");
  assert.deepEqual(rows.map((r) => r.kind), ["fact", "coverage-disposition", "narrative"]);
  assert.deepEqual(rows[0].ordinals, [6, 18], "#655's scope channel obtains on the lettered form too");
  assert.ok(rows.some((r) => /demotion receipt/.test(r.text)));
  assert.ok(!rows.some((r) => /Risk shape/.test(r.text)), "the self-audit section stays excluded");
});

test("#1674 the body rule widened WITH the selector — excerpts under a lettered flag are body", () => {
  // THE POINT OF THE ARM: widening the selector alone makes this worse, not better. If `**A.` becomes a
  // flag but does not arm the body rule, the two quoted record lines under it become flags of their own
  // and a lettered review inflates the published grounds exactly the way the numbered form did before
  // Rule 2. On the live specimen this is not hypothetical — those two rows were in the parse.
  const rows = parseCorrections(LETTERED);
  assert.ok(!rows.some((r) => /_records\//.test(r.text)),
    `a quoted record under a lettered flag is that flag's body, not a fourth correction; got ${JSON.stringify(rows.map((r) => r.text.slice(0, 50)))}`);
});

test("#1674 the numbered and bulleted contracts are byte-unchanged — the widening is additive", () => {
  // The regression pin. 's untyped-among-typed rule, 's fail-safe and 's body rule all key
  // on shapes this change touches, so they are re-asserted against the SAME fixtures here.
  // 5 at HEAD and 5 patched, measured by importing both copies of the module against this same
  // fixture — not counted by eye off the source, which is how this arm first got written with a 4 in it.
  assert.equal(parseCorrections(REVIEW).length, 5, "the bold-numbered fixture parses exactly as before");
  assert.equal(parseCorrections("BLOCKING\n\n- [kind: fact] one\n- [kind: rating] two\n- three, untyped\n").length, 3);
  assert.equal(parseCorrections("BLOCKING\n\n- the owner is wrong\n- the tier is wrong\n").length, 2, "#571's fail-safe");
});

test("#1674 correctionFlagContent, on the lettered shapes it now has to tell apart", () => {
  assert.equal(correctionFlagContent("**A. [kind: fact] [on: 2] wrong date**"), "[kind: fact] [on: 2] wrong date**");
  assert.equal(correctionFlagContent("A. [kind: fact] wrong date"), "[kind: fact] wrong date");
  assert.equal(correctionFlagContent("b) [kind: rating] the band is averaged"), "[kind: rating] the band is averaged");
  // The letter branch is a SINGLE letter followed by its own separator, which is what keeps ordinary
  // prose out. These are the near-misses, and each must stay prose.
  assert.equal(correctionFlagContent("The narrative asserts a date the record contradicts."), null);
  assert.equal(correctionFlagContent("e.g. the sweep returned nothing"), null, "no separator+space after a single letter");
  assert.equal(correctionFlagContent("**Fix:** state the deferral."), null);
  assert.equal(correctionFlagContent("Quoted: *\"the sweep returned nothing of note\"*"), null);
});

// ── — THE PERMISSIVE WALK WAS THE LESS PERMISSIVE OF THE TWO ────────────────────────────────────
//
// `countCitedDefects` is the evidence for the check that REFUSES a BLOCKING verdict as degenerate, and
// verify.mjs states the rule beside it: being wrong there discards a real review, so its evidence must be
// permissive. It was not. It kept the pre- selector — no `\*{0,2}` prefix — which itself
// recorded as unable to see `**1.`, the form every typed flag is written in. A BLOCKING review whose
// only list lines are its bold flags counted ZERO cited defects and was refused.
//
// It has not fired in the wild only because real reviews carry other list lines — self-check bullets,
// quoted excerpts — any one of which makes the count non-zero for reasons unrelated to whether a defect
// was cited. The TIDY review is the one that loses its verdict.
test("#1681 a BLOCKING review whose flags are all bold-enumerated is not refused as degenerate", () => {
  const only = (flags) => `# BLOCKING\n\n## Flagged corrections\n\n${flags}`;
  const shapes = {
    "bold-numbered": only("**1. [kind: fact] [on: 1]** the registration date contradicts the record\n\n**2. [kind: rating] [on: 2]** the band is averaged\n"),
    "bold-lettered": only("**A. [kind: fact] [on: 1]** the registration date contradicts the record\n\n**B. [kind: rating] [on: 2]** the band is averaged\n"),
    "plain bullets": only("- [kind: fact] the registration date contradicts the record\n- [kind: rating] the band is averaged\n"),
  };
  for (const [name, md] of Object.entries(shapes)) {
    assert.ok(countCitedDefects(md) > 0,
      `${name}: counted 0 cited defects, so the degenerate check discards this BLOCKING verdict — `
      + `the walk that decides whether to throw a review away must be the MORE permissive of the two, not the less`);
  }
});

test("#1681 the two walks still differ where they are meant to — by SECTION, not by line shape", () => {
  // They must not converge into one selector; is explicit that one selector for both directions IS
  // the bug. What separates them is the corrections-section allowlist and the body rule, which are
  // POLICY. Whether a line is a list item is not policy, and the two had disagreed about that.
  assert.ok(countCitedDefects(REVIEW) > parseCorrections(REVIEW).length,
    "the permissive walk still counts list lines outside the corrections section; the precise one does not");
});

test("#1681 three reviews identical but for enumeration style count EQUAL — the plant against a partial widening", () => {
  // The stronger form of the arm above, and the one that catches a HALF-done widening. Teaching one walk
  // a new line shape and not the other leaves a state worse than before: the flags parse, the cited count
  // is zero, and the degenerate check re-rolls a reasoned BLOCKING. Equality is what makes that
  // impossible to ship — a single shared marker is the only way all three can agree.
  const body = (m) => `# BLOCKING\n\n## Flagged corrections\n\n`
    + `${m(1)} [kind: fact] [on: 1] the registration date contradicts the record\n\n`
    + `${m(2)} [kind: rating] [on: 2] the band is averaged\n`;
  const styles = {
    numbered: body((i) => `**${i}.**`),
    bulleted: body(() => "-"),
    lettered: body((i) => `**${"AB"[i - 1]}.**`),
  };
  const counts = Object.fromEntries(Object.entries(styles).map(([k, md]) => [k, countCitedDefects(md)]));
  assert.equal(new Set(Object.values(counts)).size, 1,
    `the same two defects count differently by enumeration style — ${JSON.stringify(counts)}`);
  assert.ok(counts.numbered > 0, "and the shared count is not zero for all three, which would agree vacuously");
});

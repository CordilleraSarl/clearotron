// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// P6 (charter 2026-07-30 §7 + §L) — the house prose contract, pinned at BOTH levels.
//
// Why this file exists at all, given §7 rules the prose work "prompt-only, no new lint, no new gate":
// these are not gates on the deliverable. Nothing here inspects a report, blocks a delivery or adds a
// redelivery cycle — they assert that the INSTRUCTIONS still say what the owner ruled they say. The
// two rules most at risk of silently reverting are exactly the ones a string test can hold:
//
//   1. ONE READER. The two-audience premise outlived every other surface once ( collapsed the report
//      to one version; the premise survived in `client-summary` as a standing instruction to hedge MORE
//      for a second reader). It came back once already — it can come back again.
//   2. THE TWO-LEVEL RULE (charter Part E). stages.mjs carries a PATH LIST; the instructions the model
//      follows live in the skill files that list names. Before this package, three level-2 files taught
//      the OPPOSITE of level 1 — a "recommended action" in the caption (delivery-contract.md,
//      synthesis-rules.md) and a surface-specific "hedge exception (table only)" (worked-examples.md).
//      Editing one level and not the other is the failure this file makes loud.
//
// The hedge assertions are deliberately POSITIVE. §7's complaint was the DIFFERENTIAL ("hedge more here
// than there"), never the hedge itself: the calibrated register is the professional voice of an advisory
// preliminary assessment, and §L keeps "working draft for legal review". A future tightening pass that
// strips it would flatten the prose into bald assertion and collide with the claims-must-not-outrun-
// evidence discipline — so the register is pinned as REQUIRED, not merely permitted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STAGES, PROSE_VOICE } from "../stages.mjs";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "prelim-search");
const skill = (f) => readFileSync(join(SKILLS, f), "utf8");

// A paths object that answers any key with a plausible path (and reportCard as the per-axis function).
const P = new Proxy({}, { get: (_t, k) => (k === "reportCard" ? (a) => `/r/card-${String(a)}.md` : `/r/${String(k)}`) });
const msg = (stage, ctx = {}) => STAGES[stage].message({ paths: P, job: {}, axis: 1, finding: {}, ...ctx });

// The stages that author prose a reader sees. (`client-summary` was a fourth until 2026-08-01,
// when the stage was retired — its output reached no reader.)
const PROSE_STAGES = ["synthesis", "report-overview", "report-card"];

test("the house prose contract reaches every stage that writes reader-facing prose", () => {
  for (const s of PROSE_STAGES) {
    assert.ok(msg(s).includes(PROSE_VOICE), `${s} must carry PROSE_VOICE verbatim`);
  }
  // …and not the stages that write machine artifacts — the contract governs prose, and a search or
  // digest stage paying for it on every dispatch buys nothing.
  for (const s of ["matter-frame", "register-digest", "placement-inquiry"]) {
    assert.ok(!msg(s).includes(PROSE_VOICE), `${s} writes no reader prose and must not carry the contract`);
  }
});

test("the contract carries the word budgets, each-fact-once and the two RULED prohibitions", () => {
  assert.match(PROSE_VOICE, /20-25 words a sentence/, "the per-sentence budget is stated");
  assert.match(PROSE_VOICE, /80 words a paragraph/, "the per-paragraph budget is stated");
  // §7: the caption obeyed "3 sentences" with three 60-word sentences. A cap is not a budget.
  assert.match(PROSE_VOICE, /FOLD POINT and never the target/i, "a code cap is taught as a fold point, not a target");
  assert.match(PROSE_VOICE, /EACH FACT ONCE, AT ITS RANK/, "the repetition rule is stated");
  assert.match(PROSE_VOICE, /CROSS-REFERENCES IT BY ORDINAL/, "…with the mechanism that replaces retelling");
  // Ruling 4, both halves.
  assert.match(PROSE_VOICE, /NO PRESCRIPTIONS \(RULED\)/);
  assert.match(PROSE_VOICE, /we recommend/, "the banned advice grammar is named");
  assert.match(PROSE_VOICE, /NO DISCLAIMERS \(RULED\)/);
});

// The "ONE READER" test that stood here asserted the two-audience posture was gone from the
// `client-summary` stage message. That stage is RETIRED (2026-08-01), so the message it checked no
// longer exists. The doctrine it guarded is not orphaned: PROSE_VOICE still carries the hedge
// rules, and the tests above assert it reaches every surviving prose stage verbatim.

test("the coverage prose contract names the code-stamped line the prose must not re-type", () => {
  const syn = msg("synthesis");
  assert.match(syn, /COVERAGE PROSE/, "the coverage lane has its own prose contract");
  assert.match(syn, /STAMPED BY CODE/, "the coverage_line is identified as code's output");
  assert.match(syn, /Do NOT re-type its numbers/i);
  // The reason it needs saying at all: front-matter is stripped before the prose scan runs, so nothing
  // catches the duplicate (predelivery-lint.mjs stripFrontMatterBlock).
  assert.match(syn, /Nothing catches the duplicate for you/i);
  // §L: "searched, none exists" and "could not search" are different facts.
  assert.match(syn, /searched — none found/);
  assert.match(syn, /could not be searched/);
});

test("§L language rules ride the contract", () => {
  assert.match(PROSE_VOICE, /-formative rights/, "third-party rights are named as rights…");
  assert.match(PROSE_VOICE, /NEVER "<MARK>-branded"/, "…never as the client's brand");
  assert.match(PROSE_VOICE, /never as a relation to another level/, "say the level, not its neighbours");
  assert.match(PROSE_VOICE, /Cease-and-desist letters/, "a private act's absence proves nothing");
  assert.match(PROSE_VOICE, /well-accepted framework for confusion/, "the legal test is named in plain words");
  assert.match(PROSE_VOICE, /never recite a court's factor template/i);
  assert.match(PROSE_VOICE, /NO FILLER/);
  // Never assume a client fact — the ruling-4 aside, and the phrase that prompted it.
  assert.match(PROSE_VOICE, /NEVER ASSERT A FACT ABOUT THE CLIENT/);
  assert.match(PROSE_VOICE, /no coexistence agreement appears on the record searched/);

  // Per-site §L fixes, at the stage that owns each surface.
  assert.match(msg("synthesis"), /CONNOTATION LEADS WITH THE FLAGGED READING/,
    "connotation leads with the issue, never a list of what the mark is NOT");
  assert.match(msg("synthesis"), /"mark_assessment": \{"distinctiveness":"<1-2 sentences>","connotation":"<1-2 sentences>"\}/,
    "the mark-assessment budget is 1-2 sentences each (was 2-4 / 1-3)");
  assert.match(msg("synthesis"), /LAWYER ENGLISH, NEVER ENGINE ENGLISH/,
    "asks read as a lawyer would say them, never as an engine mechanism");
  assert.match(msg("report-card"), /NEVER \\?"Legal lever\\?"/,
    "the Full-detail risk bullet is 'Risk assessment', never 'Legal lever'");
  assert.match(msg("report-overview"), /neither party has challenged it/,
    "'undisturbed' is replaced by its plain meaning");
});

// ---- Level 2: the skill files stages.mjs tells each stage to read (charter Part E) ----

test("two-level rule: the skill files teach the same contract, never the retired opposite", () => {
  const delivery = skill("delivery-contract.md");
  const synthesis = skill("synthesis-rules.md");
  const worked = skill("worked-examples.md");

  // Each file states the contract at its own level…
  for (const [name, body] of [["delivery-contract.md", delivery], ["synthesis-rules.md", synthesis]]) {
    assert.match(body, /House prose contract/, `${name} carries the contract`);
    assert.match(body, /20–25 words a sentence/, `${name} carries the word budget`);
    assert.match(body, /No prescriptions \(ruled\)/i, `${name} carries ruling 4`);
  }

  // …and none of them still teaches the opposite. These three lines are the exact level-2 contradictions
  // that survived the earlier prose pass: a caption that ends in advice, and a per-surface hedge setting.
  assert.doesNotMatch(delivery, /\+ the recommended action/,
    "delivery-contract.md's caption spec must not ask for a recommended action");
  assert.doesNotMatch(delivery, /Say what it MEANS and what to DO/,
    "…nor for what to DO");
  assert.doesNotMatch(synthesis, /the one finding that drives it \+ the recommended action/,
    "synthesis-rules.md's caption spec must not ask for a recommended action");
  assert.doesNotMatch(worked, /Hedge exception \(table only\)/,
    "worked-examples.md must not teach a surface-specific hedge exception");

  // The worked examples are what the model imitates (§7) — the pairs must actually be there,
  // and must be labelled voice-only so they are not read as calibration exemplars.
  assert.match(worked, /## Voice — worked before \/ after pairs/, "the before/after pairs exist");
  assert.match(worked, /teach VOICE ONLY/, "…and are scoped to voice, not rating");
  assert.match(worked, /carry no rating, no band and no mitigant reasoning/,
    "…so one pair cannot become a template for a whole findings set");
  // The keep: website-use evidence was called out as exactly right and must survive the tightening.
  assert.match(worked, /Keep: website-use evidence/, "the walk-through's explicit KEEP is recorded");
});

// ----: the reader's KNOWLEDGE, held at both levels ----
//
// Same class as everything above, and for the same reason: this asserts that the INSTRUCTIONS still say
// what the owner ruled, never that a delivered report obeys them. There is no lint here and there must
// not be one — 's own ruling is that a word filter swaps a banned word for an unbanned one equally
// opaque, so the evidence for this half is a delivered report read against the standard, not an assertion.
//
// What a string test CAN hold is the two-level rule. The ruling lives in PROSE_VOICE and the mirrors in
// the four files stages.mjs names; a rule added at one level and lost at the other is exactly the drift
// that put a "recommended action" in the caption for two rounds.
test("#762 — the reader-owns-every-noun rule rides the contract at both levels", () => {
  assert.match(PROSE_VOICE, /THE READER OWNS EVERY NOUN/, "level 1 states the ruling");
  assert.match(PROSE_VOICE, /DESCRIBE the thing/,
    "…with the positive instruction — a rule that only forbids leaves the writer nothing to write");
  assert.match(PROSE_VOICE, /JUDGE THE SENTENCE, NEVER THE WORD/,
    "…and states it as a judgment on the sentence, never a vocabulary to avoid (the owner's ruling)");

  for (const [name, body] of [
    ["delivery-contract.md", skill("delivery-contract.md")],
    ["synthesis-rules.md", skill("synthesis-rules.md")],
    ["report-prose.md", skill("report-prose.md")],
  ]) {
    assert.match(body, /reader owns every noun/i, `${name} carries the level-2 mirror`);
  }
  // The worked pairs are what the model imitates (§7), so the contrast has to be one of them.
  assert.match(skill("worked-examples.md"), /Every noun is one the reader already owns/,
    "worked-examples.md carries the before/after pair for it");

  // The pre-existing translation tables are now subordinated to the rule rather than standing as the
  // test. Leaving them unsubordinated teaches "translate these listed tokens" beside "describe anything
  // the reader has no word for" — and a model takes the checkable one.
  for (const [name, body] of [
    ["delivery-contract.md", skill("delivery-contract.md")],
    ["synthesis-rules.md", skill("synthesis-rules.md")],
  ]) {
    assert.match(body, /The substitutions are illustration; the rule is the test/,
      `${name}'s plain-language list must be illustration, not the boundary`);
  }
});

test("#762 — the review step reads for it, and needs no new machinery to do so", () => {
  const refutation = msg("narrative-refutation", { intakeAsks: [] });
  assert.match(refutation, /READER-OWNED NOUNS/, "the lens rides the stage that already reviews the narrative");
  assert.match(refutation, /JUDGE MEANING IN CONTEXT, NEVER THE WORD/,
    "…as a model judgment — a mark called AXIS must sail through where the engine's own noun must not");
  assert.match(refutation, /\[kind: narrative\]/,
    "…typed into the CLOSED enum that already exists; a fifth kind would be a column the deployments cannot fill");
  // Level 2 for this stage is its own SKILL.md — the only file this seat reads.
  const skillMd = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills",
    "narrative-refutation", "SKILL.md"), "utf8");
  assert.match(skillMd, /FLAG \(unowned-noun\)/, "the skill names the flag");
  // The citation used to be part of this pattern. The owner ruled the issue numbers out of the skill
  // files on 2026-09-03, so the CLASSIFICATION is the thing to assert — it is what the verdict logic
  // reads, and it is what would actually be wrong if it changed.
  assert.match(skillMd, /`unowned-noun` is CONDITIONAL-class/,
    "…and places it in the verdict logic — an unclassified flag has no disposition");
});

test("#243 — neither level asks for a second summary of a finding it already summarised", () => {
  // This test used to pin a budget: "### The read" at 2 sentences / ~120 words, stated identically by
  // the skill and the stage. retired the section instead of re-tuning it. It was the THIRD
  // condensation of one finding — beside the card's own `- one:` line and the typed `net` — and a budget
  // on a duplicate only bounds how long the duplicate is allowed to be.
  //
  // So what is pinned now is the absence, on BOTH levels, because the skill tree and the stage prompt
  // drifting apart is what the original test existed to catch.
  for (const [where, text] of [["the skill", skill("delivery-contract.md")], ["the stage", msg("report-card")]]) {
    assert.doesNotMatch(text, /^\s*[-*]?\s*(?:Then\s+)?"?###\s+The read"?\s*=/im, `${where} must not spec a "### The read" section`);
    assert.doesNotMatch(text, /≤2 sentences \/ ~120 words/, `${where} must not carry the retired read budget`);
    assert.doesNotMatch(text, /- one: <the one-clause net/, `${where} must not spec an authored "- one:" line`);
  }
  // …and the stage says positively where the sentence comes from instead, so a model reading only the
  // prompt is not left to invent one.
  //
  // S2 WIDENED THESE TWO RATHER THAN RELAXING THEM. They used to quote the old dictation's own
  // sentences (`Do NOT emit "- one:"`, `STAMPS it onto this card`) — which pinned a PHRASING, and that
  // phrasing went when the whole meta block moved into code (card-frame.mjs). What the assertions were
  // protecting survives intact and is now stronger: the retired lines are still NAMED, so their absence
  // from the seat's output is deliberate rather than an omission, and the prompt still says POSITIVELY
  // where they come from instead of leaving a "do not" with no destination.
  const rc = msg("report-card");
  assert.match(rc, /"- one:"/, "the retired line is named as retired, not silently dropped");
  assert.match(rc, /"- net:"/, "the net line is still named, so its absence from the seat's output is deliberate");
  assert.match(rc, /composed by the driver from the record/,
    "the prompt says where the meta lines come from — a card author told only 'do not' writes something else");
  assert.match(rc, /STARTS at "### Full detail"/,
    "the positive instruction that replaced the frame dictation is what stops the seat inventing a head");
});

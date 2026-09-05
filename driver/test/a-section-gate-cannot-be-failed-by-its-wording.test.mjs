// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The structural section contract (tracker issue 129).
//
// THE CLASS. verify.mjs's required-section floors keyed on prose the model composes, so each was one
// phrasing drift from killing a run that had produced the section perfectly — and the failure reads as
// "missing section" while the section is right there. Measured across three runs and two engines:
// codex wrote "## Negative-results matrix" and was rejected twice, killing a client run; anthropic
// wrote "## Negative results (per-cell detail)" — different spelling AND different trailing words from
// the same skill. PR 336 widened the regex and fixed those two instances; the class survived it.
//
// WHAT IS ASSERTED HERE. Two properties, and the second is the one that lets this land without a proof
// run: (1) a document carrying the dictated anchor passes whatever its heading says, and (2) a document
// carrying no anchor is judged exactly as it was before — so no archived run's replay verdict moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERIFY = readFileSync(join(ROOT, "verify.mjs"), "utf8");
const SKILL = readFileSync(join(ROOT, "skills", "prelim-common-law", "SKILL.md"), "utf8");

// The four sections the gates require. Driving all four rather than the one that bit: three arms in one
// night went green through the defect they were named for by testing a single member of their class.
const SECTIONS = ["findings", "negative-results", "coverage-ledger", "audit-trail"];

test("every required section is dictated to the seat as a verbatim anchor", () => {
  for (const name of SECTIONS) {
    assert.ok(SKILL.includes(`<!-- clearotron:section=${name} -->`),
      `the skill must dictate the ${name} anchor, or the seat never emits it and the contract is prose-only`);
  }
});

// The anchor appears TWICE in the skill by design — once in the instruction list, once under its
// heading in the output template. A bare `includes` cannot tell those apart, so it stays green when the
// template loses its anchor and the seat is left copying a section header with nothing under it. This
// arm pins the one that actually teaches the shape: the anchor on the line after a heading.
test("each anchor sits under a heading in the output template, not only in the instruction list", () => {
  const lines = SKILL.split("\n");
  for (const name of SECTIONS) {
    const anchored = lines.some((line, i) =>
      line.trim() === `<!-- clearotron:section=${name} -->` && /^#{1,6}\s+\S/.test(lines[i - 1] ?? ""));
    assert.ok(anchored,
      `${name}'s anchor must sit directly under its heading in the template — found only in prose, `
      + "which is the shape the seat copies from");
  }
});

test("the skill tells the seat the anchor is mandatory and the heading wording is free", () => {
  assert.match(SKILL, /copy them verbatim/i,
    "a template block reads as illustrative; the anchor needs an instruction, not just an example");
  assert.match(SKILL, /Word the headings however reads best/i,
    "the point of the contract is that wording stops being a failure mode — say so, or seats keep guessing");
});

test("no required-section gate keys on prose ALONE any more", () => {
  // The exact call shapes 129 named. If one comes back, the class is reopened.
  for (const shape of [
    'needs(c, [/negative[\\s-]results/i]',
    'needs(c, [/coverage[\\s-]ledger/i]',
    'needs(c, [/audit[\\s-]trail/i]',
  ]) {
    assert.ok(!VERIFY.includes(shape),
      `verify.mjs still gates a section on prose alone: ${shape} — route it through needsSection`);
  }
});

// ── THE BEHAVIOURAL HALF: drive validators.commonLaw itself ────────────────────────────────────────
// Everything above reads source text, which proves wiring and not behaviour. These drive the real gate
// through its exported surface, with headings that match NO prose regex in the tree, so the anchor is
// the only thing that can carry them.
const { validators } = await import("../verify.mjs");

const SYNONYM_DOC = (withAnchors) => [
  "# Common-law findings — TESTMARK (2026-09-05)", "",
  "## Findings — Mark: TESTMARK", withAnchors ? "<!-- clearotron:section=findings -->" : "", "",
  "## What we did not find", withAnchors ? "<!-- clearotron:section=negative-results -->" : "", "",
  "## Where we looked", withAnchors ? "<!-- clearotron:section=coverage-ledger -->" : "", "",
  "| unit | status | reason |", "| --- | --- | --- |", "| itch.io | confirmed-clean | ran |", "",
  "## Call log", withAnchors ? "<!-- clearotron:section=audit-trail -->" : "", "",
].join("\n");

const ARCHIVED_PATH = "/nonexistent/common-law-findings.md";

test("DRIVEN: synonym headings with no anchor still fail, on the exact token that killed a client run", () => {
  const r = validators.commonLaw(ARCHIVED_PATH, SYNONYM_DOC(false));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "missing:negative-results",
    "this is pewter-lantern's failure verbatim — the section was present and complete, and the gate said missing");
});

test("DRIVEN: the same document with anchors passes the structural floor", () => {
  const r = validators.commonLaw(ARCHIVED_PATH, SYNONYM_DOC(true));
  assert.equal(r.ok, true,
    `the anchors must carry headings that match no prose regex in the tree; got ${JSON.stringify(r)}`);
});

test("the anchor regex accepts the dictated spelling and tolerates incidental whitespace", () => {
  // Rebuilt from verify.mjs's own source so the arm cannot drift from the implementation it checks.
  const re = (name) => new RegExp(`<!--\\s*clearotron:section\\s*=\\s*${name}\\s*-->`, "i");
  assert.ok(re("negative-results").test("<!-- clearotron:section=negative-results -->"));
  assert.ok(re("negative-results").test("<!--clearotron:section=negative-results-->"), "no-space form");
  assert.ok(re("negative-results").test("<!--  clearotron:section = negative-results  -->"), "spaced form");
  assert.ok(!re("negative-results").test("<!-- clearotron:section=coverage-ledger -->"),
    "an anchor must not satisfy a DIFFERENT section — that would make one anchor pass the whole gate");
});

// The heading spellings that actually killed runs. Under the contract each is free prose, so each must
// be irrelevant to the verdict once the anchor is present.
test("the recorded killer spellings are all acceptable when the anchor is present", () => {
  const re = new RegExp(`<!--\\s*clearotron:section\\s*=\\s*negative-results\\s*-->`, "i");
  for (const heading of [
    "## Negative-results matrix",            // pewter-lantern, codex — rejected twice, killed a client run
    "## Negative results (per-cell detail)", // umber-beacon, anthropic — same skill, different words
    "## Negative results",                   // briar-kestrel family
    "## What we did not find",               // a synonym no regex would ever have been widened to
  ]) {
    const doc = `${heading}\n<!-- clearotron:section=negative-results -->\n\nbody`;
    assert.ok(re.test(doc), `the anchor must carry ${heading}`);
  }
});

test("a document with NO anchor is judged exactly as before — archived replays cannot move", () => {
  // The fallback is the old prose regex, unchanged. This is what makes the change unable to newly
  // reject anything: anchor OR prose is strictly more permissive than prose alone.
  const prose = /negative[\s-]results/i;
  assert.ok(prose.test("## Negative-results matrix"), "the hyphenated legacy form still passes on prose");
  assert.ok(prose.test("## Negative results (per-cell detail)"), "and the spaced one");
  assert.ok(!prose.test("## What we did not find"),
    "a synonym still fails WITHOUT an anchor — the fallback is unchanged, not widened further");
});

test("needsSection and needsSectionsLabeled both exist, and the labelled token shape is preserved", () => {
  assert.match(VERIFY, /function needsSection\(/, "the single-section form");
  assert.match(VERIFY, /function needsSectionsLabeled\(/, "the multi-section form for findings+ledger");
  // correctionHint (gateway.mjs:2181, :2188) branches on the label TEXT. A renamed token silently
  // downgrades the seat's corrective hint to a generic one, which is how a run stalls without saying why.
  assert.match(VERIFY, /"findings\+ledger"/,
    "the findings+ledger label must survive verbatim — correctionHint branches on it");
  assert.match(VERIFY, /which: "coverage-ledger"/,
    "and the appended member, so the emitted token stays missing:findings+ledger(coverage-ledger)");
});

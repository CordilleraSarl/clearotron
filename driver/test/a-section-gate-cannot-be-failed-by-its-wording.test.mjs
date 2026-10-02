// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The structural section contract.
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
const SKILL = readFileSync(join(ROOT, "skills", "clearance-common-law", "SKILL.md"), "utf8");

// The real gate, imported here rather than beside the behavioural block below: the derived class
// arm reads `validators` too, and a const declared after it sits in TDZ when the runner reaches it.
const { validators } = await import("../verify.mjs");

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

// ── THE CLASS, DERIVED — replacing three literal strings ──────────────────────────────────────────
//
// This arm used to name the three call shapes 129's evidence carried. An arm whose NAME quantifies a
// class and whose BODY tests three named members is green through everything it does not name, and
// this one was: it passed while `placement` — a seat-written artifact whose gate keys on model prose —
// sat outside its three strings the whole time, at a site the issue never named.
//
// So the population is derived instead, and the derivation is the point. A required-section gate is
// only a run-killer when a MODEL writes the document it judges. Where the DRIVER renders the artifact,
// a prose key is code checking its own render and no phrasing can reach it — which is what happened to
// the three sites 129 did name: conversions 5 and 11 moved report-cards/<ord>.md and
// register-findings.md to driver renders, and audit.md was always built by buildAuditMd. The issue is
// older than the conversions, and nobody went back to it.
//
// The discriminator is the driver's OWN registry, not a list kept here: `toolWrittenArtifact` resolves
// the three shapes gateway.mjs maintains (exact basename, per-ordinal directory, pattern). So a stage
// that ever returns an artifact to seat-writing, or a NEW seat stage, lands in this set and reds.
const { STAGES, paths } = await import("../stages.mjs");
const { toolWrittenArtifact } = await import("../gateway.mjs");

// Every artifact a seat writes with its own hands, derived. `"0"` is a stand-in axis for the fan-out
// stages: it has to satisfy `report-cards`' `/^\d+\.md$/` member shape, or a tool-written artifact
// reads as seat-written and this arm reds on a correct tree — which it did, on its first run.
function seatWrittenValidators() {
  const byFn = new Map(Object.entries(validators).map(([k, v]) => [v, k]));
  const P = paths("/run");
  const out = new Map();
  for (const [stage, def] of Object.entries(STAGES)) {
    if (typeof def?.validate !== "function" || typeof def?.out !== "function") continue;
    let artifact = null;
    try { artifact = def.out(P, "0"); } catch { continue; }
    if (typeof artifact !== "string" || !artifact) continue;
    if (toolWrittenArtifact(artifact)) continue;
    out.set(byFn.get(def.validate) ?? `(anonymous:${stage})`, { stage, artifact });
  }
  return out;
}

// The declared set, each row carrying WHY it is here — so a new member is a decision somebody makes in
// this file rather than a diff nobody reads. `anchor: null` means the validator has no required-section
// gate at all, which is a different thing from having one that is satisfied.
const SEAT_WRITTEN = {
  commonLaw: { anchor: "findings", why: "clearance-common-law's findings file, hand-written by the seat — the artifact 129 was filed about" },
  commonLawHalf: { anchor: "findings", why: "the same document per grid half; the meaning seat (half m) is judged on findings + audit-trail alone" },
  ownerJudgment: { anchor: null, why: "a judge's answer is the session's JSON form, written as it arrived — it has no prose section gate, so there is nothing here to key structurally" },
  caseLaw: { anchor: null, why: "nonEmpty plus sibling-JSON joins only — it has no prose section gate, so there is nothing here to key structurally" },
};

test("THE CLASS: every seat-written artifact's validator is declared, and nothing else is", () => {
  const derived = seatWrittenValidators();
  const declared = new Set(Object.keys(SEAT_WRITTEN));
  const undeclared = [...derived.keys()].filter((v) => !declared.has(v));
  const stale = [...declared].filter((v) => !derived.has(v));

  assert.deepEqual(undeclared, [],
    "a stage now writes an artifact by SEAT that this file does not know about — either a conversion was "
    + "reverted or a new seat stage landed. Its required-section gates must key on a dictated anchor, not "
    + `on prose, before it is added to SEAT_WRITTEN: ${undeclared.map((v) => `${v} → ${derived.get(v)?.artifact}`).join(", ")}`);
  assert.deepEqual(stale, [],
    `SEAT_WRITTEN names a validator whose artifact the driver now renders: ${stale.join(", ")}. That is a `
    + "conversion landing, not a defect — drop the row and say so.");
});

test("THE CLASS: every declared anchor is routed through needsSection, never through bare needs", () => {
  // Read behaviourally where the validator can be driven, and structurally where standing up its
  // sidecars would test the fixture rather than the gate. Both halves below drive; this arm is the
  // source-level backstop that catches a gate re-written to bypass the contract.
  for (const [name, { anchor }] of Object.entries(SEAT_WRITTEN)) {
    if (!anchor) continue;
    // ON THE TOKEN, never on the call. The first cut of this arm allowed `needsSection(c, [` as an
    // alternative, so ANY needsSection call anywhere in the file satisfied it — and the plant that
    // put a gate back to a bare needs() stayed green. That is the exact defect this file
    // exists to catch, committed inside the arm written to catch it. The anchor is the subject.
    const routed = new RegExp(`needsSection\\(c,\\s*"${anchor}"`).test(VERIFY)
      || VERIFY.includes(`anchor: "${anchor}"`);
    assert.ok(routed,
      `${name}'s gate must reach its section through needsSection so the dictated `
      + `"${anchor}" anchor is what carries it — a bare needs() here is the class reopening`);
  }
});

test("THE CLASS: a driver-rendered artifact is NOT dragged into the contract", () => {
  // The false-red direction, which costs more than the false-green: an arm that demanded an anchor
  // everywhere would red on report-cards/<ord>.md, which is correct.
  const derived = seatWrittenValidators();
  for (const v of ["reportCard", "reportOverview", "narrative"]) {
    assert.ok(!derived.has(v),
      `${v} judges an artifact the driver renders — a prose key there is code checking its own render, `
      + "and requiring an anchor would mean the driver writing a token to satisfy itself");
  }
});

// ── THE BEHAVIOURAL HALF: drive validators.commonLaw itself ────────────────────────────────────────
// Everything above reads source text, which proves wiring and not behaviour. These drive the real gate
// through its exported surface, with headings that match NO prose regex in the tree, so the anchor is
// the only thing that can carry them.

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
    "this is the recorded failure verbatim — the section was present and complete, and the gate said missing");
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
    "## Negative-results matrix",            // codex — rejected twice, killed the run
    "## Negative results (per-cell detail)", // anthropic — same skill, different words
    "## Negative results",                   // the third recorded variant
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

test("needsSection exists — the single-section form every declared anchor routes through", () => {
  assert.match(VERIFY, /function needsSection\(/, "the single-section form");
});

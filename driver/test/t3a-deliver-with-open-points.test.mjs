// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// T3a — "Deliver always, with open points printed. The refusal on a blocking review goes."
// Owner ruling 2026-08-26, verbatim. It REVERSES T3, whose flip to fail-on-BLOCKING is itself
// itself an owner-approved decision. Both are his; this is the standing one.
//
// The end-to-end arm lives in pipeline.mock.test.mjs, where a BLOCKING run is driven to delivery and the
// rendered report is read. This file carries the two halves that arm cannot reach: the section builder's
// own vocabulary, and a SOURCE-LEVEL check on the late-hardening branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { buildReviewerOpenPointsSection, assembleReportMd } from "../pipeline.mjs";
import { paths as stagePaths } from "../stages.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const pipelineSrc = () => readFileSync(join(HERE, "..", "pipeline.mjs"), "utf8");

const review = (verdict, ...flags) =>
  [verdict, "", "## Flags", "", ...flags.map((f, i) => `${i + 1}. [kind: fact] [on: -] ${f}`)].join("\n");

// ✕ RE-AIMED, NOT DELETED (, T3b). This arm used to be titled "renders only where the
// reviewer refused to sign" and its second assertion gave the reason: CONDITIONAL flags already reach the
// corrective pass, so widening would rewrite reports that ship correctly. The owner overruled that on
// 2026-08-26 — an objection the run tried and failed to fix prints whatever the verdict — and the arm
// would have STAYED GREEN under the new behaviour while its stated premise was dead, because with no
// applied-rows argument there is nothing unfixed to print. The property worth keeping is the one below,
// which is what the old assertion was accidentally measuring: EVIDENCE, not verdict, decides.
test("T3a/T3b: no section without evidence of something open — a signed, closed run prints nothing", () => {
  assert.equal(buildReviewerOpenPointsSection(review("CLEAR")), "",
    "a signed report has no open points to print, and inventing a section for one would tell a lawyer a "
    + "refusal happened when it did not");
  assert.equal(buildReviewerOpenPointsSection(review("CONDITIONAL", "a flag"), []),
    "",
    "a corrective pass that closed every flag leaves an EMPTY unresolved list, and an empty list must "
    + "render no section at all — a bare heading over nothing tells the reader a refusal happened");
  assert.equal(
    buildReviewerOpenPointsSection(review("CONDITIONAL", "a flag"),
      [{ n: 1, kind: "fact", text: "a flag", outcome: "findings-changed" }]),
    "",
    "the pass moved the finding the flag named, so there is nothing open — this is the majority run and "
    + "it must look exactly like today's");
});

test("T3b: an objection the run could not close prints on a NON-blocking verdict", () => {
  // The owner's decision, driven at the builder. The verdict is CONDITIONAL and the review's own flag
  // list is irrelevant to this section now; what prints is what the driver OBSERVED go unfixed.
  const s = buildReviewerOpenPointsSection(review("CONDITIONAL", "some other thing"), [
    { n: 1, kind: "fact", text: "finding 9 states 1 March 2011; the record reads 25 February.", outcome: "findings-unchanged", ordinals: [9] },
    { n: 2, kind: "rating", text: "both marks are rated MANAGEABLE against identical goods.", outcome: "findings-changed" },
  ]);
  assert.match(s, /^###\s+Reviewer's open questions/m,
    "a delivered report carrying an unanswered objection must say so where the reader starts");
  assert.match(s, /finding 9 states 1 March 2011; the record reads 25 February\./,
    "the reviewer's own ground, verbatim — the unfixed one");
  assert.doesNotMatch(s, /both marks are rated MANAGEABLE/,
    "the pass DID move that finding, so printing it would tell a client something is open that is not — "
    + "the resolved set is the one thing this section must not over-report");
  assert.doesNotMatch(s, /did not sign this report off/,
    "the reviewer signed with conditions; saying it refused is a different fact about the report and a "
    + "lawyer acts differently on it");
  assert.match(s, /does not show them\s+closed/,
    "the non-blocking lead has to say what actually happened without over-claiming it");
  assert.match(s, /the report did not change in response/,
    "a CHECKED-and-unmoved row says so — that is the one thing the driver can assert about it");
});

test("T3b: a flag the run could not CHECK does not claim the report was worked and unmoved", () => {
  // ✕ THE DEFECT THIS ARM EXISTS FOR, found by review before it shipped. The lead used to read "the
  // version you are reading did not change in response" for every printed row. That is a claim about
  // having checked, and `not-entity-scoped` means the opposite: the flag's prose joined no entity, so
  // the driver never compared anything.
  //
  // MEASURED, not supposed. `on` is optional in the typed call by design — "omit it for a flag about
  // the document rather than a finding" — and nine document-level flags through the entity join give
  // 9 of 9 `not-entity-scoped`; the same nine with an ordinal declared give 9 of 9 `findings-unchanged`.
  // So this is the normal shape for every objection about the summary, the caption or the methodology
  // note, not an edge case.
  const s = buildReviewerOpenPointsSection(review("CONDITIONAL"), [
    { n: 1, kind: "narrative", text: "the summary says the phonetic axis ran; the coverage note says it did not.", outcome: "not-entity-scoped" },
    { n: 2, kind: "fact", text: "finding 9 states 1 March 2011.", outcome: "findings-unchanged", ordinals: [9] },
  ]);
  const line = s.split("\n").find((l) => l.includes("phonetic axis")) ?? "";
  assert.match(line, /could not check whether this was addressed/,
    "an unchecked row must say the run could not check it");
  assert.doesNotMatch(line, /did not change in response/,
    "and must NOT carry the checked-and-unmoved claim — the driver compared nothing for this row, so "
    + "telling a lawyer the report was worked and held still is an assertion it cannot support, on what "
    + "measurement says is the majority shape of a real section");
  const other = s.split("\n").find((l) => l.includes("1 March 2011")) ?? "";
  assert.match(other, /finding 9 — the report did not change in response/,
    "the checked row keeps both facts: which finding, and that the pass left it alone");
});

test("T3b: an unclassified outcome takes the UNCHECKED wording, never the checked one", () => {
  const s = buildReviewerOpenPointsSection(review("CONDITIONAL"), [
    { n: 1, kind: "fact", text: "an objection whose outcome nobody has classified.", outcome: "some-future-outcome" },
  ]);
  assert.match(s, /could not check whether this was addressed/,
    "an outcome with no qualifier row must fall on the side that claims LESS — the same direction "
    + "`unresolvedFlags` fails in, for the same reason");
  assert.doesNotMatch(s, /did not change in response/,
    "inventing a checked-and-unmoved claim for an outcome nobody has defined is how a report asserts "
    + "something no code ever measured");
});

test("T3b: an unclassified outcome PRINTS rather than vanishing", () => {
  // The default-direction arm. `unresolvedFlags` names the RESOLVED set and treats everything else as
  // open, so an outcome added later by someone who never reads this file reaches the client's report
  // instead of being silently dropped from it. Driven with a string no version of the module mints.
  const s = buildReviewerOpenPointsSection(review("CONDITIONAL"), [
    { n: 1, kind: "fact", text: "an objection whose outcome nobody has classified.", outcome: "some-future-outcome" },
  ]);
  assert.match(s, /an objection whose outcome nobody has classified\./,
    "an outcome matching neither list must fall on the PRINTED side. Written the other way round — a "
    + "list of unresolved outcomes — a sixth outcome would read as resolved and drop a lawyer's "
    + "objection out of a client's report with nothing red anywhere");
});

test("T3b: a removal is not a fix, which is this codebase's own ruling", () => {
  // `correctionsWorklist`: "CORRECT OR ESCALATE; DELETION IS NOT AN AVAILABLE MOVE. A pass given a
  // flagged fact deleted it rather than correcting it: the flag went away and the report did not become
  // true." So `findings-removed` prints. This arm is what stops that ruling being re-decided by
  // whoever next edits the resolved set.
  const s = buildReviewerOpenPointsSection(review("CLEAR"), [
    { n: 1, kind: "fact", text: "the RIVERA citation supports nothing in the record.", outcome: "findings-removed", removed: ["RIVERA"] },
  ]);
  assert.match(s, /the RIVERA citation supports nothing in the record\./,
    "the pass deleted the finding the flag named instead of correcting it — the objection is unanswered "
    + "and the client must see it, on a SIGNED report");
});

test("T3b: BLOCKING keeps every cited ground AND gains the unfixed ones, deduped", () => {
  const s = buildReviewerOpenPointsSection(
    review("BLOCKING", "the phonetic axis never ran.", "finding 4 cites a withdrawn application."),
    [
      { n: 1, kind: "fact", text: "the phonetic axis never ran.", outcome: "findings-unchanged" },
      { n: 2, kind: "narrative", text: "the summary leads with the clean axis.", outcome: "findings-unchanged" },
    ]);
  assert.match(s, /did not sign this report off/, "the refusal lead is unchanged on BLOCKING");
  assert.match(s, /finding 4 cites a withdrawn application\./, "a ground only the final review carries");
  assert.match(s, /the summary leads with the clean axis\./,
    "an objection the recheck's REWRITE dropped while still refusing — the pre-corrective observation is "
    + "the only record of it, and losing it is how an unfixed point leaves the report unnoticed");
  const axis = s.match(/the phonetic axis never ran\./g) ?? [];
  assert.equal(axis.length, 1,
    `the ground both sources carry printed ${axis.length} times — a client reading the same objection `
    + "twice reads it as two problems");
});

// ── THE CALL SITE, NOT THE FUNCTION (, T3b) ──────────────────────────────────────
//
// Every arm above hands `buildReviewerOpenPointsSection` its rows directly. That leaves the half this
// change actually added UNDRIVEN: assembly reading `corrections-applied.json` off the run dir and
// passing it in. An injected dependency tested only through injection is the shape where the wiring is
// missing and every arm is green — so this arm writes the real artifact at the real path
// (`stagePaths(dir).correctionsApplied`, never one invented here) and reads the assembled report.
test("T3b: assembly reads corrections-applied.json off the run dir and prints from it", () => {
  const dir = mkdtempSync(join(tmpdir(), "t3b-assembly-"));
  try {
    const P = stagePaths(dir);
    mkdirSync(dirname(P.correctionsApplied), { recursive: true });
    mkdirSync(P.reportCardsDir ?? join(dir, "report-cards"), { recursive: true });
    writeFileSync(P.reportOverview, "---\noverall_label: MEDIUM\noverall_caption: x\n---\n\n# Coverage\nok\n");
    writeFileSync(P.seniorEyeReview, review("CONDITIONAL", "something the reviewer later withdrew"));
    writeFileSync(P.correctionsApplied, JSON.stringify({
      ts: "2026-08-26T00:00:00.000Z", verdict: "CONDITIONAL",
      rows: [{ n: 1, kind: "fact", text: "the EU class 9 search never ran, and the summary says it did.", outcome: "findings-unchanged" }],
    }) + "\n");

    assembleReportMd(P, [], []);
    const md = readFileSync(P.report, "utf8");
    assert.match(md, /the EU class 9 search never ran, and the summary says it did\./,
      "the unfixed objection did not reach the report. The builder's own arms pass their rows in by "
      + "hand, so a call site that never reads the artifact leaves every one of them green while no "
      + "client ever sees an open point on a delivered report");
    assert.match(md, /^###\s+Reviewer's open questions/m, "and under its own heading");
    assert.ok(md.indexOf("Reviewer's open questions") < md.indexOf("# Coverage"),
      "at the TOP of the body — prelim-search/SKILL.md:241 says where, and a section a reader meets "
      + "after the coverage note is not the hand-off that sentence describes");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("T3a: a BLOCKING carries its cited grounds into the section, verbatim", () => {
  const s = buildReviewerOpenPointsSection(
    review("BLOCKING", "the summary says the search finished; the phonetic axis never ran.", "finding 9 states 1 March 2011."));
  assert.match(s, /^###\s+Reviewer's open questions/m);
  assert.match(s, /did not sign this report off/,
    "the heading alone is not a hand-off — it must say what happened in words a lawyer acts on");
  assert.match(s, /the phonetic axis never ran\./, "the reviewer's own ground, not a paraphrase of it");
  assert.match(s, /finding 9 states 1 March 2011\./, "every cited ground, not the first");
  assert.doesNotMatch(s, /Before you can rely/,
    "an open question is NOT a condition the client can close — the report's condition vocabulary must "
    + "not leak into a section about the reviewer's unresolved judgment");
});

test("T3a: a BLOCKING that cites nothing still renders, and says that is what happened", () => {
  // ✕ "RARE, NOT IMPOSSIBLE" WAS TRUE WHEN WRITTEN AND IS NOW TOO WEAK. Conversion 9 made
  // `record_narrative_refutation` refuse a BLOCKING with an empty `flags` array in the turn it is typed,
  // so no review the driver RENDERS can reach here citing nothing. What survives is a file the tool did
  // not write: a run resumed across the conversion, or an archived review re-read from disk.
  //
  // The arm stays, and this is why rather than inertia: it is a DEFENSIVE render for exactly those files.
  // Rendering nothing would ship a report whose body reads as reviewed while the reviewer refused — the
  // one outcome the section exists to stop — and that is worth holding for an input the current path
  // cannot produce but the archive still can.
  const s = buildReviewerOpenPointsSection(review("BLOCKING"));
  assert.match(s, /^###\s+Reviewer's open questions/m, "silence is the failure mode, so the section still renders");
  // AND WITH AN EMPTY APPLIED LIST, WHICH IS A DIFFERENT INPUT FROM `null` AND THE ONE A REAL RUN GIVES.
  // The call site reads `JSON.parse(...)?.rows ?? null`, and `?? null` yields null only when the KEY is
  // absent — a corrections-applied.json whose `rows` is `[]` reaches here as `[]`. If the emptiness
  // check keyed on the applied list rather than on the UNION, this is the input that would ship a
  // refusal in silence: reviewer refused, cited nothing, section absent, report reads as reviewed.
  assert.match(buildReviewerOpenPointsSection(review("BLOCKING"), []), /cited no specific defect/,
    "an empty applied list must not silence the degenerate render — `[]` is what a run with a written "
    + "but empty rows array hands the builder, and it is the exact shape `null` does not test");
  assert.match(s, /cited no specific defect/,
    "and it must name the shape of the refusal — an unexplained refusal is a different thing to act on "
    + "than a reasoned one, and a lawyer needs to know which they have");
});

// ── THE LATE-HARDENING BRANCH, CHECKED AT THE SOURCE ──────────────────────────────────────────────
//
// built a terminal here because a late hardening was an input the gate had been DENIED: the verdict
// settles thousands of lines earlier and nothing re-reads the review, so a reviewer refusing DURING the
// delivery-stale repair "is written to disk and never heard". Measured on bf21580e — a registration date
// the reviewer caught, delivered anyway.
//
// The ruling removes the REFUSAL. It does not say the reviewer stops being heard, so deleting the throw
// without a destination re-opens exactly that hole. Three things must therefore hold together, and the
// dangerous one is the sidecar: without it the report ships BADGED WITH THE VERDICT SETTLED BEFORE THE
// REVIEWER HARDENED — refused by the reviewer, labelled CONDITIONAL, which is worse than either behaviour
// this replaces.
//
// ✕ THIS IS A SOURCE READ BESIDE A DRIVEN ONE, AND MY FIRST ACCOUNT OF WHY WAS WRONG.
//
// What stood here said the branch could not be driven because "the mock fixture has no knob" for a review
// that comes back stricter. **It has one** — `MOCK_REVIEW_BLOCKS_AFTER_VERDICT`, which corrective-cycle
//.test.mjs has used since to drive this exact path. I searched the fixtures for `stale|harden|
// late|repair` and the knob is named after none of those: I searched my own vocabulary rather than the
// code's, and concluded absence from a search that could not have found it.
//
// The driven arm is therefore where the real assertion lives — corrective-cycle.test.mjs, "a review that
// flips to BLOCKING during the delivery stale-repair DELIVERS on the LATE verdict": it checks the run
// delivers, the sidecar carries the LATE verdict, the report's `overall_label` equals the sidecar's tier,
// and the section renders. Planting the sidecar write away reds it by name.
//
// This arm stays because it asserts something the driven one cannot: that the four statements have not
// been SEPARATED by a later edit. The driven arm proves the branch works today; this one fails fast, in
// source, when a refactor moves one of them out. Different failures, both worth catching.
test("T3a: the late-hardening branch adopts the verdict, rewrites the label authority, and rebuilds", () => {
  const src = pipelineSrc();
  const at = src.indexOf('event: "verdict-hardened-by-repair"');
  assert.ok(at > 0, "the late-hardening branch is gone or renamed — re-point this arm rather than deleting it");
  // ✕ THE BOUND IS THE BRANCH'S OWN CLOSING BRACE, NOT A CHARACTER COUNT, AND THAT IS A CORRECTION.
  // The first cut sliced a fixed 2200 characters, which ran past this branch into the stale-repair loop
  // — where `reassemble = true;` appears three more times. So the `reassemble` assertion below passed on
  // a NEIGHBOUR's line: planting the real one away left the arm green. Measured, then fixed. The window
  // now ends at the first close-brace at this branch's own indentation.
  const close = src.indexOf("\n                }", at);
  assert.ok(close > at, "the branch's closing brace was not found — the bound would silently widen");
  const body = src.slice(at, close);

  assert.match(body, /\bverdict = hardened;/,
    "the hardened verdict must become the run's own — without this the ratchet computes a value nobody uses");
  assert.match(body, /writeVerdictSidecar\(\)/,
    "verdict.json is 'the single label authority' in its own words; leave it stale and applyVerdictFrontMatter "
    + "re-stamps the report with the verdict the reviewer has since hardened away from");
  assert.match(body, /writeRunStatus\(ctx, \{ verdict \}\)/, "and the run's own record follows it");
  assert.match(body, /reassemble = true;/,
    "assembleReportMd must re-run, or the open-points section is built from the review this repair replaced");
  assert.doesNotMatch(body, /throw new StageFailure\("verdict",\s*\n?\s*`reviewer verdict/,
    "the terminal is removed by the ruling, not merely bypassed");
});

test("T3a: neither reviewer terminal survives anywhere in the pipeline", () => {
  const src = pipelineSrc();
  // Both threw the same sentence fragment. Its absence is the check; its presence anywhere means one of
  // the two came back, or a third was added in the same shape.
  assert.doesNotMatch(src, /the report is not signable/,
    "both reviewer terminals are removed by the owner's ruling — a BLOCKING review delivers with its open "
    + "points printed. A new site carrying this sentence is a re-introduction, not a new case");
  assert.doesNotMatch(src, /event: "verdict-blocking-terminal"/,
    "the gate's terminal event is retired; verdict-blocking-delivered replaces it");
  assert.match(src, /event: "verdict-blocking-delivered"/,
    "and the delivery must be recorded by its own event — a BLOCKING that ships and logs nothing is "
    + "indistinguishable in the record from one that was never BLOCKING");
});

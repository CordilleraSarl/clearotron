// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEW SEES EVERY POSITION THE WRITER EXCLUDED.
//
// The review was told the writer's declinations only where one covered an in-class identical or near floor, so the
// writer's exclusion of a headline candidate or a sheet-2 position off the floors reached it as an absence, and a flag
// on such a position named no finding, which opened the whole corrective pass. Now the full review is told every
// position placement put forward that the writer excluded, at any tier, once each, with placement's tier and reason
// and the writer's ground, under the ruled standard (2026-10-29). A later review starts fresh, so it is told what
// changed, then the research the run obtained after the full review, then every other exclusion for reference, each
// once (2026-10-30). A flag names an excluded position by its record id, and the corrective pass is narrowed to it;
// where another flag declared nothing, the pass stays open and is still told the position and its row. Every mark and
// owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths, STAGES, WRITER_EXCLUSIONS_STANDARD, WRITER_EXCLUSIONS_UNREAD, WRITER_EXCLUSIONS_UNCHANGED, WRITER_EXCLUSIONS_LATER_SCOPE, WRITER_EXCLUSIONS_REFERENCE, researchAfterReviewLine, writerExclusionLines as writerExclusionLinesOf } from "../stages.mjs";
import { writerExclusions, writerExclusionBlock, messageCtxFor, correctionsExtra, prepareDeclinationSpec, correctionRows, flagOrdinals, changedFindingOwners } from "../pipeline.mjs";
import { appendDeclinations, declinationCallPaths } from "../declination-tool.mjs";
import { acceptRefutation, recordRefutation, listedExclusionPositions, refutationCallPaths } from "../narrative-refutation-record.mjs";
import { parseCorrections } from "../verify.mjs";
import { correctionScope, flaggedPositions, scopeDrift } from "../corrections-feedforward.mjs";
import { repairFollowup } from "../repair-composers.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";
import { RESEARCH_AFTER_REVIEW_MD, keepResearchAnswer } from "../research-answers.mjs";
import { searchRunArtifacts } from "../skeptic-search.mjs";

const PLACEMENTS = [
  { mark: "QZORVAK", owner: "Alpha Ltd", jurisdiction: "EU", records: ["/mark/eu/a1"], tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
  { mark: "QZORVAK", owner: "Gamma SA", jurisdiction: "EU", records: ["/mark/eu/c1"], tier: "headline-candidate", borderline: true,
    reason: "identical and live in the class; one reading meets the client's controllers in the registered goods, the other reads the goods as printers only" },
  { mark: "QZORVEX", owner: "Delta AG", jurisdiction: "EU", records: ["/mark/eu/d1", "/mark/de/d2"], tier: "sheet-2", reason: "near in sound, live for game accessories" },
  { mark: "ZORVA", owner: "Epsilon BV", jurisdiction: "EU", records: ["/mark/eu/e1"], tier: "watchlist-annex", reason: "a shared root, live for unrelated software" },
  { mark: "QUORVIK", owner: "Zeta Oy", jurisdiction: "EU", records: ["/mark/eu/z1"], tier: "out-of-scope-filtered", reason: "lapsed in 2015, with nothing live behind it" },
];
const GROUNDS = { c1: "Registered for printer cartridges only, read in full.", d1: "A different ending the client's buyers say aloud.", e1: "Software for logistics, which the client does not sell." };

function seedRun(t, { declined = ["c1", "d1", "e1"], delivered = ["a1"], ledger = true } = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "review-exclusions-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = paths(runDir);
  writeFileSync(P.placementModel, JSON.stringify({ schema_version: 1, placements: PLACEMENTS }));
  // The write-up carried the four placed positions to the writer; the filtered one was not carried.
  writeFileSync(P.registerFindings, "## Findings\n\n| /mark/eu/a1 | QZORVAK |\n| /mark/eu/c1 | QZORVAK |\n| /mark/eu/d1 | QZORVEX |\n| /mark/eu/e1 | ZORVA |\n");
  writeFileSync(P.bandShape, JSON.stringify({ floors: { in_class_identical_or_near: [{ record_id: "/mark/eu/a1" }, { record_id: "/mark/eu/c1" }] } }));
  writeFileSync(P.findings, delivered.length ? synthesisFindings(runDir).replaceAll("/mark/us/90000001", `/mark/eu/${delivered[0]}`) : JSON.stringify({ findings: [] }));
  if (ledger) appendDeclinations(runDir, declined.map((id) => ({ uri: `/mark/eu/${id}`, reason: id === "d1" ? "dissimilar-mark" : "unrelated-goods", grounds: GROUNDS[id] })));
  return P;
}

/** The first record id of each entry a list gives. */
const ids = (lines) => (lines ?? []).map((l) => l.match(/\((\/mark\/[^,)]+)/)[1]);

test("the full review is told every position the writer excluded, at every tier, once each, with placement's reason and the writer's ground", (t) => {
  const P = seedRun(t);
  const x = writerExclusions(P);
  assert.equal(x.state, "listed");
  assert.deepEqual(x.positions.map((p) => [p.uri, p.tier]), [
    ["/mark/eu/c1", "headline-candidate"], ["/mark/eu/d1", "sheet-2"], ["/mark/eu/e1", "watchlist-annex"]],
    "a tier is missing, a delivered position is listed, or the filtered one reached the list");
  const { lines } = writerExclusionBlock(P);
  assert.equal(lines.length, 3, "one entry per position");
  assert.equal(lines[0], `- QZORVAK — Gamma SA (/mark/eu/c1): placement: headline-candidate, borderline — ${PLACEMENTS[1].reason}; excluded by the writer as unrelated-goods: ${GROUNDS.c1}; covers the floor /mark/eu/c1`,
    "the borderline position's competing readings, or the floor it covers, did not reach the review");
  assert.match(lines[1], /^- QZORVEX — Delta AG \(\/mark\/eu\/d1, \/mark\/de\/d2\): placement: sheet-2 — near in sound/, "a grouped position is not one entry with its records");
  assert.ok(!lines.join("\n").includes("/mark/eu/a1"), "a position a finding delivers is not an exclusion");
});

test("the full review's message carries the ruled paragraph and the list after placement's decisions", (t) => {
  const P = seedRun(t);
  const ctx = messageCtxFor("narrative-refutation", { paths: P });
  const text = String(STAGES["narrative-refutation"].message({ intakeAsks: [], job: {}, registerOnly: false, profileSelection: null, ...ctx }));
  assert.ok(text.includes(`(by design, never an outage).\n(none)\n${WRITER_EXCLUSIONS_STANDARD}\n- QZORVAK — Gamma SA (/mark/eu/c1)`),
    "the paragraph does not sit between placement's decisions and the writer's exclusions");
  assert.ok(text.includes("The writer's exclusions are listed after them, under their own standard."));
  assert.equal(text.split(WRITER_EXCLUSIONS_STANDARD).length - 1, 1, "the paragraph is printed once");
});

test("\"none\" is said only when every position ends in a finding; a record that cannot be read is never \"none\"", (t) => {
  const block = (P) => writerExclusionBlock(P);
  const at = (P) => String(STAGES["narrative-refutation"].message({ intakeAsks: [], job: {}, registerOnly: false, profileSelection: null, ...messageCtxFor("narrative-refutation", { paths: P }) }));
  // Every position delivered: the absent ledger is the answer.
  const all = seedRun(t, { declined: [], ledger: false });
  writeFileSync(all.findings, synthesisFindings(all.runDir).replaceAll("/mark/us/90000001", "/mark/eu/a1")
    .replace(/"registrations":\s*\[/, "\"registrations\": [{\"uri\": \"/mark/eu/c1\"}, {\"uri\": \"/mark/eu/d1\"}, {\"uri\": \"/mark/eu/e1\"}, "));
  assert.equal(block(all).state, "none");
  assert.ok(at(all).includes(`${WRITER_EXCLUSIONS_STANDARD}\n(none)\n`));
  // No ledger, and positions with no finding: the record does not hold those decisions.
  const missing = seedRun(t, { ledger: false });
  assert.equal(block(missing).state, "unreadable");
  assert.ok(at(missing).includes(WRITER_EXCLUSIONS_UNREAD) && !at(missing).includes(`${WRITER_EXCLUSIONS_STANDARD}\n(none)`));
  // A ledger that will not parse.
  const corrupt = seedRun(t);
  writeFileSync(declinationCallPaths(corrupt.runDir, 0).ledger, "{ not json");
  assert.equal(block(corrupt).state, "unreadable");
  // A findings file that will not parse.
  const nofindings = seedRun(t);
  writeFileSync(nofindings.findings, "{ not json");
  assert.equal(block(nofindings).state, "unreadable");
});

test("a later review is told what changed and what its flags named, then every other exclusion for reference, each once", (t) => {
  const P = seedRun(t);
  writerExclusionBlock(P, { review: "full" });
  const later = writerExclusionBlock(P, { review: "later" });
  assert.deepEqual(ids(later.lines), [], "an unchanged later review was given a decision to check");
  assert.deepEqual(ids(later.reference), ["/mark/eu/c1", "/mark/eu/d1", "/mark/eu/e1"], "an unchanged later review was not given the accepted exclusions, a floor's among them");
  // The corrective pass re-grounds d1; e1 is untouched.
  appendDeclinations(P.runDir, [{ uri: "/mark/eu/d1", reason: "dissimilar-mark", grounds: "Read aloud, the endings differ for a buyer of controllers." }]);
  const after = writerExclusionBlock(P, { review: "later" });
  assert.deepEqual(ids(after.lines), ["/mark/eu/d1"]);
  assert.deepEqual(ids(after.reference), ["/mark/eu/c1", "/mark/eu/e1"], "a position was listed twice, or a settled one went missing");
  assert.ok(after.lines[0].endsWith("Read aloud, the endings differ for a buyer of controllers."));
  // Each entry for reference carries the recorded grounds and ids, as the full review read them.
  assert.ok(after.reference[1] === "- ZORVA — Epsilon BV (/mark/eu/e1): placement: watchlist-annex — a shared root, live for unrelated software; excluded by the writer as unrelated-goods: Software for logistics, which the client does not sell.", after.reference[1]);
  // A flag named e1: it is listed for the recheck though it did not change.
  assert.ok(writerExclusionBlock(P, { review: "later", named: ["/mark/eu/e1"] }).lines.some((l) => l.includes("(/mark/eu/e1)")));
  // A finding now delivers e1: the later review is told its exclusion ended, and never that nothing changed.
  writeFileSync(P.findings, synthesisFindings(P.runDir).replaceAll("/mark/us/90000001", "/mark/eu/e1").replace(/"registrations":\s*\[/, "\"registrations\": [{\"uri\": \"/mark/eu/a1\"}, "));
  const ended = writerExclusionBlock(P, { review: "later" });
  assert.ok(ended.lines.includes("- ZORVA — Epsilon BV (/mark/eu/e1): excluded at the full review, now delivered as a finding"), ended.lines.join(" | "));
  assert.ok(!writerExclusionLinesOf(ended).includes(WRITER_EXCLUSIONS_UNCHANGED));
  // With nothing changed, the later review is told the full review's list stands, then the exclusions for reference.
  const plain = seedRun(t);
  writeFileSync(plain.bandShape, JSON.stringify({ floors: { in_class_identical_or_near: [] } }));
  writerExclusionBlock(plain, { review: "full" });
  const text = String(repairFollowup("narrative-refutation:post-repair-review", { findings: "/run/findings.json", changes: [], resting: [],
    renumbered: false, coverageChanged: false, evidence: {}, registerOnly: false, job: {}, skepticFlags: "/run/sf.md", frameReopenReceipt: "/run/fr.json",
    floorDecisions: [], writerExclusions: writerExclusionBlock(plain, { review: "later" }) }));
  assert.ok(text.includes(`${WRITER_EXCLUSIONS_STANDARD}\n${WRITER_EXCLUSIONS_UNCHANGED}\n${WRITER_EXCLUSIONS_REFERENCE}\n- QZORVAK — Gamma SA (/mark/eu/c1)`),
    "an unchanged later review read \"(none)\" or nothing, or was not given the exclusions for reference");
  for (const id of ["/mark/eu/c1", "/mark/eu/d1", "/mark/eu/e1"]) assert.equal(text.split(`(${id}`).length - 1, 1, `${id} is not listed exactly once`);
});

test("a flag names an excluded position by any of its record ids; one the list does not give is refused", (t) => {
  const P = seedRun(t);
  writerExclusionBlock(P, { review: "full" });
  const listed = listedExclusionPositions(P.runDir);
  const ok = acceptRefutation({ verdict: "CONDITIONAL", flags: [
    { kind: "rating", text: "narrative.md drops the QZORVEX position on a sound reading the records do not support", positions: ["/mark/de/d2"] },
  ] }, { positionsListed: listed });
  assert.equal(ok.ok, true, ok.reason);
  assert.match(ok.content, /^1\. \[kind: rating\] \[on: -\] \[positions: \/mark\/eu\/d1\] narrative\.md drops/m, "the position is not rendered as the list keys it");
  const back = parseCorrections(ok.content);
  assert.deepEqual(back[0].positions, ["/mark/eu/d1"]);
  assert.equal(back[0].text, "narrative.md drops the QZORVEX position on a sound reading the records do not support", "the token rode into the flag's text");
  const bad = acceptRefutation({ verdict: "CONDITIONAL", flags: [{ kind: "rating", text: "narrative.md drops a position", positions: ["/mark/eu/a1"] }] }, { positionsListed: listed });
  assert.match(String(bad.reason), /^refutation_flag_position_unlisted:0:\/mark\/eu\/a1/);
  const none = acceptRefutation({ verdict: "CONDITIONAL", flags: [{ kind: "rating", text: "narrative.md drops a position", positions: ["/mark/eu/d1"] }] });
  assert.match(String(none.reason), /^refutation_flag_position_unlisted:0/, "a position was accepted with no list to check it against");
  // A review that names no position renders as it always did.
  const plain = acceptRefutation({ verdict: "CONDITIONAL", flags: [{ kind: "fact", text: "narrative.md misstates an owner", on: [1] }] }, { positionsListed: listed });
  assert.match(plain.content, /^1\. \[kind: fact\] \[on: 1\] narrative\.md misstates an owner$/m);
});

test("a flag on an excluded position narrows the corrective pass to it; a flag whose target cannot be read still opens the whole pass", (t) => {
  const pos = { n: 1, kind: "rating", text: "x", ordinals: null, positions: ["/mark/eu/d1"] };
  const fin = { n: 2, kind: "fact", text: "y", ordinals: [3] };
  assert.deepEqual(correctionScope([pos, fin]), { scoped: true, ordinals: [3], positions: ["/mark/eu/d1"] });
  assert.deepEqual(correctionScope([pos, { n: 3, kind: "narrative", text: "z", ordinals: null }]), { scoped: false, ordinals: [] });
  assert.deepEqual(correctionScope([fin]), { scoped: true, ordinals: [3] }, "a review that names no position keeps its old shape");
  // Unrelated findings are still compared, and a moved one is still named.
  const doc = (v) => ({ findings: [{ ordinal: 3, mark: "A", band: "HIGH" }, { ordinal: 4, mark: "B", band: v }] });
  const drift = scopeDrift([pos, fin], doc("LOW"), doc("MEDIUM"));
  assert.deepEqual([drift.scoped, drift.positions, drift.moved], [true, ["/mark/eu/d1"], [4]]);

  const P = seedRun(t);
  writerExclusionBlock(P, { review: "full" });
  const rec = recordRefutation(P.runDir, { verdict: "CONDITIONAL", flags: [
    { kind: "rating", text: "narrative.md drops the QZORVEX position on a sound reading the records do not support", positions: ["/mark/eu/d1"] },
  ] });
  assert.ok(rec.written, String(rec.refused));
  prepareDeclinationSpec({ paths: P }, P);   // as the pipeline does before the corrective pass
  const msg = correctionsExtra(P);
  assert.ok(msg.includes("THIS IS THE COMPLETE LIST: (no existing finding is named)."), "the pass was not told no finding is named");
  assert.ok(msg.includes("THE EXCLUDED POSITIONS ITS FLAGS ARE ABOUT: QZORVEX — Delta AG (/mark/eu/d1), row 2. For each, either record it as a finding, or keep its exclusion by calling `record_declination` again for its row with a ground that answers the flag."),
    "the pass was not told the position, or the row to keep its exclusion by");
  assert.ok(msg.includes("Change the named finding objects, any finding you record for the named excluded positions, and the document passages the flags identify. Preserve unaffected findings and passages. If a correction requires another change, record what changed and why. EVERY OTHER FINDING OBJECT"),
    "the pass was not told its scope as ruled, or to leave everything else as it is");
});

test("a flag about the document is a declared target: with a flag on a position the pass is narrowed to both, and alone it is narrowed to the passage", (t) => {
  assert.deepEqual(flaggedPositions([{ ordinals: null, positions: ["/mark/eu/d1"] }, { ordinals: null }, { ordinals: [3], positions: ["/mark/eu/d1", "/mark/eu/e1"] }]),
    ["/mark/eu/d1", "/mark/eu/e1"]);
  const SCOPE_SENTENCE = "Change the named finding objects, any finding you record for the named excluded positions, and the document passages the flags identify.";
  const P = seedRun(t);
  writerExclusionBlock(P, { review: "full" });
  const rec = recordRefutation(P.runDir, { verdict: "BLOCKING", flags: [
    { kind: "narrative", text: "narrative.md puts the sheet-2 section before the headline candidates" },
    { kind: "rating", text: "narrative.md drops the QZORVEX position on a sound reading the records do not support", positions: ["/mark/de/d2"] },
  ] });
  assert.ok(rec.written, String(rec.refused));
  prepareDeclinationSpec({ paths: P }, P);
  const msg = correctionsExtra(P);
  assert.ok(msg.includes("SCOPE —") && msg.includes(SCOPE_SENTENCE), "a document flag beside a position flag left the pass open");
  assert.ok(msg.includes("THE EXCLUDED POSITIONS ITS FLAGS ARE ABOUT: QZORVEX — Delta AG (/mark/eu/d1), row 2."), "the narrowed pass was not told the position and its row");

  // A document flag alone: the pass is narrowed to the passage it names, and told no finding is in scope.
  const Q = seedRun(t);
  writerExclusionBlock(Q, { review: "full" });
  assert.ok(recordRefutation(Q.runDir, { verdict: "BLOCKING", flags: [{ kind: "narrative", text: "narrative.md puts the sheet-2 section before the headline candidates" }] }).written);
  prepareDeclinationSpec({ paths: Q }, Q);
  const plain = correctionsExtra(Q);
  assert.ok(plain.includes("THIS IS THE COMPLETE LIST: (no existing finding is named).") && plain.includes(SCOPE_SENTENCE),
    "a document flag alone opened the pass, or was not told its passage is in scope");
  assert.ok(!plain.includes("EXCLUDED POSITIONS"), "a review that named no position was told one");
});

test("a flag whose target cannot be read leaves the pass open, and a flag on a position still reaches it with its row", (t) => {
  // On the typed path, a flag with no text names nothing; on a rendered review written before the token, no flag declares.
  assert.deepEqual([flagOrdinals({ text: "narrative.md drops a disclosure" }), flagOrdinals({ text: "  " }), flagOrdinals({ text: "x", on: [4] })], [[], null, [4]]);
  const P = seedRun(t);
  writerExclusionBlock(P, { review: "full" });
  assert.ok(recordRefutation(P.runDir, { verdict: "BLOCKING", flags: [
    { kind: "narrative", text: "narrative.md puts the sheet-2 section before the headline candidates" },
    { kind: "rating", text: "narrative.md drops the QZORVEX position on a sound reading the records do not support", positions: ["/mark/de/d2"] },
  ] }).written);
  // The review as an older run holds it: the rendered document alone, its first flag with no target token.
  const review = readFileSync(P.seniorEyeReview, "utf8").replace("[kind: narrative] [on: -] ", "[kind: narrative] ");
  writeFileSync(P.seniorEyeReview, review);
  rmSync(refutationCallPaths(P.runDir).payload);
  prepareDeclinationSpec({ paths: P }, P);
  const msg = correctionsExtra(P);
  assert.ok(!msg.includes("SCOPE —") && !msg.includes("MUST COME BACK BYTE-IDENTICAL"), "a flag with no readable target narrowed the pass");
  assert.ok(msg.includes("THE EXCLUDED POSITIONS THE REVIEWER'S FLAGS ARE ABOUT: QZORVEX — Delta AG (/mark/eu/d1), row 2. For each, either record it as a finding, or keep its exclusion by calling `record_declination` again for its row with a ground that answers the flag."),
    "the open pass was not told the position, or the row to keep its exclusion by");
});

test("the correction and its recheck read every flag's target the same way, from the typed call or the rendered review", (t) => {
  const cases = {
    "document only": [{ kind: "narrative", text: "narrative.md puts the sheet-2 section before the headline candidates" }],
    "finding and document": [{ kind: "fact", text: "narrative.md misstates the owner of the first finding", on: [1] },
      { kind: "coverage-disposition", text: "narrative.md claims the annex was searched in full" }],
    "position and document": [{ kind: "rating", text: "narrative.md drops the QZORVEX position on a sound reading", positions: ["/mark/eu/d1"] },
      { kind: "narrative", text: "narrative.md orders the sheet-2 section first" }],
  };
  for (const [name, flags] of Object.entries(cases)) {
    const P = seedRun(t);
    writerExclusionBlock(P, { review: "full" });
    assert.ok(recordRefutation(P.runDir, { verdict: "BLOCKING", flags }).written, name);
    const review = readFileSync(P.seniorEyeReview, "utf8");
    const typed = correctionScope(correctionRows(P, review));
    const rendered = correctionScope(parseCorrections(review));
    assert.equal(typed.scoped, true, `${name}: the correction left the pass open`);
    assert.deepEqual(typed, rendered, `${name}: the correction and the rendered review read the scope differently`);
  }
});

test("the recheck is told to read each named position's decision, beside the exclusions that changed", (t) => {
  const P = seedRun(t);
  writerExclusionBlock(P, { review: "full" });
  const text = String(repairFollowup("narrative-refutation:verdict-recheck", { narrative: "/run/narrative.md", findings: "/run/findings.json", seniorEyeReview: "/run/senior-eye-review.md",
    correctionsScope: { scoped: true, named: [], positions: ["/mark/eu/d1"], moved: [], unbound: [] }, appliedTable: "", restoredTable: "", evidenceTable: "", planAuditCarry: "",
    writerExclusions: writerExclusionBlock(P, { review: "later", named: ["/mark/eu/d1"] }) }));
  assert.ok(text.includes("For each excluded position your flags named, check the resulting finding or renewed exclusion against the evidence and the specific objection you raised. A newly recorded ground alone does not settle the flag. Retain the flag if its factual error, reasoning error, or relevant uncertainty remains."),
    "the recheck was not told D6 as ruled");
  assert.ok(text.includes(`${WRITER_EXCLUSIONS_LATER_SCOPE}\n${WRITER_EXCLUSIONS_STANDARD}\n- QZORVEX — Delta AG (/mark/eu/d1, /mark/de/d2)`),
    "the later review's standard is not preceded by its scope sentence, or the named position is not the decision it checks");
  // The other exclusions follow the named one, under the ruled sentence, each once.
  const ref = text.indexOf(`\n${WRITER_EXCLUSIONS_REFERENCE}\n`);
  assert.ok(ref > text.indexOf("(/mark/eu/d1"), "the reference sentence does not follow the decision the recheck checks");
  for (const id of ["/mark/eu/c1", "/mark/eu/e1"]) {
    assert.ok(text.indexOf(`(${id})`) > ref, `${id} is not listed for reference`);
    assert.equal(text.split(`(${id})`).length - 1, 1, `${id} is listed more than once`);
  }
  assert.ok(text.includes("verify (no existing finding is named) and the narrative passages"), "the recheck's empty finding list is not design's wording");
});

// ── WHAT AN EXCLUSION RESTS ON, AND WHAT DEPENDS ON A CHANGE (design, 2026-10-30) ───────────────────────────────────
// The three proof cases design named: changed goods wording with the same classes and completeness reaches the review;
// a changed shared conclusion must permit checking a dependent exclusion under another owner, and here the later
// review can name one it was not shown again (what it is shown of the others is design's to word); an unrelated change
// leaves settled exclusions alone.
const bandRow = (id, mark, owner, goods) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, classes: [9], status: "Registered",
  owner_name: owner, raw: { classifications: [{ class: 9, goods_services_text: goods }] }, _qid: "primary-sweep:exact", screen: "surface:in-scope-live" });
const BAND = [bandRow("a1", "QZORVAK", "Alpha Ltd", "Game controllers."), bandRow("c1", "QZORVAK", "Gamma SA", "Printer cartridges."),
  bandRow("d1", "QZORVEX", "Delta AG", "Accessories for game consoles."), bandRow("e1", "ZORVA", "Epsilon BV", "Logistics software.")];
const writeBand = (P, rows) => writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: rows }));
const holdBody = (P, id, body, ts = "2026-10-30T09:00:00Z") => writeFileSync(driverDir(P.runDir, "register-record-bodies.jsonl"),
  `${JSON.stringify({ ts, provider: "signa", agentId: null, sessionKey: "s", sessionId: null, target: `/mark/eu/${id}`, body })}\n`, { flag: "a" });
const relisted = (P) => ids(writerExclusionBlock(P, { review: "later" }).lines);

test("changed goods wording, with the same classes, status and completeness, reaches the review of the exclusion it rests under", (t) => {
  const P = seedRun(t);
  writeBand(P, BAND);
  writerExclusionBlock(P, { review: "full" });
  assert.deepEqual(relisted(P), [], "guard: unchanged, the later review checks no decision");
  // The register's answer for d1 now words its goods differently; nothing else about the record moves.
  writeBand(P, BAND.map((r) => (r.record_id === "/mark/eu/d1" ? { ...r, raw: { classifications: [{ class: 9, goods_services_text: "Controllers and accessories for game consoles." }] } } : r)));
  assert.deepEqual(relisted(P), ["/mark/eu/d1"], "reworded goods did not reach the exclusion that rests on them");
  // A record body obtained after the full review is new evidence too: the run now holds e1's official record.
  holdBody(P, "e1", { mark: "ZORVA", goods: [{ class: 9, text: "Logistics software; game servers." }] });
  assert.deepEqual(relisted(P), ["/mark/eu/d1", "/mark/eu/e1"], "a newly held record did not reach the exclusion that rests on it");
});

test("after a changed shared conclusion both later reviews see a dependent exclusion under another owner, with its grounds, and can name it", (t) => {
  const P = seedRun(t);
  writeBand(P, BAND);
  writerExclusionBlock(P, { review: "full" });
  // The finding on Alpha Ltd's record is rewritten. No exclusion is Alpha Ltd's, so the same-owner trigger reopens
  // none, and e1 (Epsilon BV) is not a decision the later review checks.
  writeFileSync(P.findings, synthesisFindings(P.runDir).replaceAll("/mark/us/90000001", "/mark/eu/a1").replace(/"band":\s*"[A-Z]+"/, "\"band\": \"LOW\""));
  assert.ok(!relisted(P).includes("/mark/eu/e1"), "guard: the exclusion under another owner was counted changed");
  // Both later reviews start fresh, and both are given e1 with its recorded ground, under the reference sentence.
  const e1 = "- ZORVA — Epsilon BV (/mark/eu/e1): placement: watchlist-annex — a shared root, live for unrelated software; excluded by the writer as unrelated-goods: Software for logistics, which the client does not sell.";
  const recheck = String(repairFollowup("narrative-refutation:verdict-recheck", { narrative: "/run/narrative.md", findings: "/run/findings.json", seniorEyeReview: "/run/senior-eye-review.md",
    correctionsScope: { scoped: true, named: [1], moved: [], unbound: [] }, appliedTable: "", restoredTable: "", evidenceTable: "", planAuditCarry: "",
    writerExclusions: writerExclusionBlock(P, { review: "later" }) }));
  const postRepair = String(repairFollowup("narrative-refutation:post-repair-review", { findings: "/run/findings.json", changes: [], resting: [],
    renumbered: false, coverageChanged: false, evidence: {}, registerOnly: false, job: {}, skepticFlags: "/run/sf.md", frameReopenReceipt: "/run/fr.json",
    floorDecisions: [], writerExclusions: writerExclusionBlock(P, { review: "later" }) }));
  for (const [name, text] of [["the recheck", recheck], ["the review after a repair", postRepair]]) {
    const ref = text.indexOf(`${WRITER_EXCLUSIONS_REFERENCE}\n`);
    assert.ok(ref >= 0 && text.indexOf(e1) > ref, `${name} is not given the dependent exclusion with its grounds for reference`);
    assert.equal(text.split("(/mark/eu/e1)").length - 1, 1, `${name} lists the dependent exclusion more than once`);
  }
  // The later review reads that e1's exclusion depends on the changed conclusion and names it: it is accepted, and the
  // corrective pass is told the position and its row.
  const rec = recordRefutation(P.runDir, { verdict: "CONDITIONAL", flags: [
    { kind: "rating", text: "narrative.md keeps ZORVA excluded on the reading of the controller market the rewritten finding withdrew", positions: ["/mark/eu/e1"] },
  ] });
  assert.ok(rec.written, `a later review could not name an exclusion it was not shown: ${rec.refused}`);
  prepareDeclinationSpec({ paths: P }, P);
  const rows = correctionRows(P, readFileSync(P.seniorEyeReview, "utf8"));
  assert.deepEqual(rows.map((r) => r.positions), [["/mark/eu/e1"]]);
  assert.ok(correctionsExtra(P).includes("THE EXCLUDED POSITIONS ITS FLAGS ARE ABOUT: ZORVA — Epsilon BV (/mark/eu/e1)"), "the corrective pass was not told the dependent position");
});

test("an unrelated change leaves settled exclusions alone: a delivered record's goods, another record's body, and the same body fetched again", (t) => {
  const P = seedRun(t);
  writeBand(P, BAND);
  holdBody(P, "d1", { mark: "QZORVEX", goods: [{ class: 9, text: "Accessories for game consoles." }] });
  writerExclusionBlock(P, { review: "full" });
  // a1 is delivered as a finding, so its reworded goods are no exclusion's evidence; a record no position holds is
  // obtained; d1's record is fetched again with the same body, and the driver keeps its own copy of it.
  writeBand(P, BAND.map((r) => (r.record_id === "/mark/eu/a1" ? { ...r, raw: { classifications: [{ class: 9, goods_services_text: "Game controllers and headsets." }] } } : r)));
  holdBody(P, "zz9", { mark: "QZORBIT", goods: [{ class: 9, text: "Cables." }] });
  holdBody(P, "d1", { mark: "QZORVEX", goods: [{ class: 9, text: "Accessories for game consoles." }] }, "2026-10-30T11:00:00Z");
  mkdirSync(join(P.runDir, "_records"), { recursive: true });
  writeFileSync(join(P.runDir, "_records", "eu-d1.json"), JSON.stringify({ mark: "QZORVEX", goods: [{ class: 9, text: "Accessories for game consoles." }],
    _uri: "/mark/eu/d1", _receipt: { provider: "signa", fetched_at: "2026-10-30T11:00:00Z" } }));
  assert.deepEqual(relisted(P), [], "an unrelated change reopened a settled exclusion");
});

test("an exclusion is said to be delivered only where a current finding names its records; a missing placements file is unread, not none", (t) => {
  // Known to have had no positions: the placements file reads and carries none.
  const none = seedRun(t);
  writeFileSync(none.placementModel, JSON.stringify({ schema_version: 1, placements: [] }));
  assert.equal(writerExclusions(none).state, "no-positions");
  // Expected and missing: placement runs on every clearance, so its record is owed.
  const gone = seedRun(t);
  writerExclusionBlock(gone, { review: "full" });
  rmSync(gone.placementModel);
  assert.equal(writerExclusions(gone).state, "unreadable");
  const later = writerExclusionBlock(gone, { review: "later" });
  assert.ok(!later.lines.some((l) => l.includes("now delivered")), "a missing placements file told the review its exclusions were delivered");
  assert.ok(writerExclusionLinesOf(later).includes(WRITER_EXCLUSIONS_UNREAD));
  // A position that leaves the list with no finding naming its records is not called delivered.
  const left = seedRun(t);
  writerExclusionBlock(left, { review: "full" });
  writeFileSync(left.registerFindings, "## Findings\n\n| /mark/eu/a1 | QZORVAK |\n| /mark/eu/c1 | QZORVAK |\n| /mark/eu/d1 | QZORVEX |\n");
  const after = writerExclusionBlock(left, { review: "later" });
  assert.ok(!after.lines.some((l) => l.includes("(/mark/eu/e1)")), "an exclusion that left the list was told as delivered");
});

test("a later review re-reads a decision whose placement reason, evidence or same-owner finding changed, and the full review is not given the scope sentence", (t) => {
  const listed = (block) => ids(block.lines);
  const P = seedRun(t);
  const full = writerExclusionBlock(P, { review: "full" });
  assert.equal(full.review, "full");
  assert.ok(!writerExclusionLinesOf(full).includes(WRITER_EXCLUSIONS_LATER_SCOPE), "the full review was given the later review's scope sentence");
  assert.deepEqual(listed(writerExclusionBlock(P, { review: "later" })), [], "guard: an unchanged later review checks no decision");
  // Placement re-reads e1's position: its reason changes.
  writeFileSync(P.placementModel, JSON.stringify({ schema_version: 1, placements: PLACEMENTS.map((e) => (e.owner === "Epsilon BV" ? { ...e, reason: "a shared root, live for software the client now sells" } : e)) }));
  assert.deepEqual(listed(writerExclusionBlock(P, { review: "later" })), ["/mark/eu/e1"], "a changed placement reason did not reopen its decision");
  // The evidence of d1's records changes: the writer's list now holds its goods.
  const Q = seedRun(t);
  writerExclusionBlock(Q, { review: "full" });
  writeFileSync(driverDir(Q.runDir, "declination-spec.json"), JSON.stringify({ rows: [{ uri: "/mark/eu/d1", goods: "complete", members: [{ uri: "/mark/eu/d1", goods: "complete" }, { uri: "/mark/de/d2", goods: "complete" }] }] }));
  assert.deepEqual(listed(writerExclusionBlock(Q, { review: "later" })), ["/mark/eu/d1"], "changed evidence did not reopen its decision");
  // A finding about the same owner as an exclusion changes.
  assert.deepEqual([...changedFindingOwners([{ ordinal: 1, owner: "Delta AG", fp: "a" }, { ordinal: 2, owner: "Beta", fp: "b" }], [{ ordinal: 1, owner: "Delta AG", fp: "c" }, { ordinal: 2, owner: "Beta", fp: "b" }])], ["delta ag"]);
  assert.deepEqual([...changedFindingOwners(undefined, [{ ordinal: 1, owner: "Delta AG", fp: "c" }])], [], "a record with no findings kept touched an owner");
});

test("the review's manual states the targets as ruled: positions beside on, the document flag's passage, and no all-or-nothing", () => {
  const manual = readFileSync(new URL("../skills/narrative-refutation/SKILL.md", import.meta.url), "utf8").replace(/\s+/g, " ");
  for (const ruled of [
    "and optionally `positions` (the record ids of the writer's excluded positions it is about, as their list names them).",
    "**Identify what each flag is about** — the `on` field",
    "`[on: -]` means no existing finding is named. For an excluded position, supply its record id in `positions`. For a document passage, omit both fields and name the affected passage, section, or coverage claim in `text`. A flag affecting a finding and an excluded position may carry both `on` and `positions`.",
    "The writer corrects the named findings, excluded positions, and document passages, together with conclusions that depend on them. Unaffected findings stay unchanged. The recheck reviews that same scope and any additional changes the writer had to make, using its recorded reasons. A missing finding number does not make the whole report open for revision.",
  ]) assert.ok(manual.includes(ruled), `the manual does not carry: ${ruled.slice(0, 60)}…`);
  assert.ok(!/Either every flag has one|a partial set buys nothing|the absence is the statement/.test(manual), "the all-or-nothing paragraph is still in the manual");
  assert.ok(!/EVERY FLAG CARRIES WHICH FINDING IT IS ABOUT|it is about the document, not a finding/.test(manual), "the manual still says every flag names a finding");
});

test("the review after a repair is told to name a writer's exclusion by a record id in positions", (t) => {
  const P = seedRun(t);
  writerExclusionBlock(P, { review: "full" });
  const text = String(repairFollowup("narrative-refutation:post-repair-review", { findings: "/run/findings.json", changes: [], resting: [],
    renumbered: false, coverageChanged: false, evidence: {}, registerOnly: false, job: {}, skepticFlags: "/run/sf.md", frameReopenReceipt: "/run/fr.json",
    floorDecisions: [], writerExclusions: writerExclusionBlock(P, { review: "later" }) }));
  assert.ok(text.includes("For a finding, put its number from the list below in `on`. For a writer's exclusion, put a record id from its entry in `positions`. For anything else,"),
    "the review after a repair is not told the clause as ruled");
});

// ── THE RESEARCH THE RUN OBTAINED AFTER THE FULL REVIEW (design, 2026-10-30) ─────────────────────────────────────────
// Research answers count as an exclusion's evidence where its ground depends on them. No record links an answer to an
// exclusion, so a later review is handed every answer the run did not hold at the full review, and judges the
// connection; no exclusion counts changed because research did.
const WRITER = "clearance-acme-run-amber-fox-synthesis";
const REVIEW = "clearance-acme-run-amber-fox-narrative-refutation";
const answer = (P, ts, session, task, text) => writeFileSync(driverDir(P.runDir, "research-answers.jsonl"),
  `${JSON.stringify({ ts, session, task, text })}\n`, { flag: "a" });

test("the full review's message is unchanged: every exclusion as a decision to check, no reference sentence, no research line", (t) => {
  const P = seedRun(t);
  answer(P, "2026-10-30T08:00:00.000Z", WRITER, "Is QZORVAK in use for game controllers in the EU?", "Yes: sold online since 2024.");
  const ctx = messageCtxFor("narrative-refutation", { paths: P });
  const text = String(STAGES["narrative-refutation"].message({ intakeAsks: [], job: {}, registerOnly: false, profileSelection: null, ...ctx }));
  assert.ok(!text.includes(WRITER_EXCLUSIONS_REFERENCE), "the full review was given the reference sentence");
  assert.ok(!text.includes("RESEARCH THIS RUN OBTAINED AFTER THE FULL REVIEW"), "the full review was told of research obtained after it");
  assert.ok(text.includes(`${WRITER_EXCLUSIONS_STANDARD}\n- QZORVAK — Gamma SA (/mark/eu/c1)`) && text.includes("\n- ZORVA — Epsilon BV (/mark/eu/e1)"));
  for (const id of ["/mark/eu/c1", "/mark/eu/d1", "/mark/eu/e1"]) assert.equal(text.split(`(${id}`).length - 1, 1, `${id} is not listed exactly once`);
  assert.ok(!existsSync(join(P.runDir, RESEARCH_AFTER_REVIEW_MD)));
});

test("a later review is handed the research the run obtained after the full review, before the exclusions for reference, and no exclusion counts changed for it", (t) => {
  const P = seedRun(t);
  answer(P, "2026-10-30T08:00:00.000Z", WRITER, "Is QZORVAK in use for game controllers in the EU?", "Yes: sold online since 2024.");
  writerExclusionBlock(P, { review: "full" });
  // Nothing obtained since: no line and no file.
  const none = writerExclusionBlock(P, { review: "later" });
  assert.equal(none.research, 0);
  assert.ok(!writerExclusionLinesOf(none).some((l) => l.startsWith("RESEARCH THIS RUN OBTAINED")), "a later review was told of research when there was none");
  assert.ok(!existsSync(join(P.runDir, RESEARCH_AFTER_REVIEW_MD)));
  // The review asks a question of its own (and an arm of it another); the writer asks its earlier question again and
  // gets the same answer, and asks one new question.
  const long = "Yes: a hosting line for game servers launched in 2026, sold to studios. ".repeat(8).trim();
  answer(P, "2026-10-30T09:00:00.000Z", REVIEW, "Is ZORVA used for logistics software?", "Yes, by Epsilon BV.");
  answer(P, "2026-10-30T09:01:00.000Z", "clearance-exp-acme-run-amber-fox-narrative-refutation-2026-10-30T09-01-00-000Z", "Is ZORVA sold to studios?", "No.");
  answer(P, "2026-10-30T09:02:00.000Z", `${WRITER}-rerun1`, "Is QZORVAK in use for game controllers in the EU?", "Yes: sold online since 2024.");
  answer(P, "2026-10-30T09:03:00.000Z", `${WRITER}-rerun1`, "Does Epsilon BV sell game servers?", long);
  const later = writerExclusionBlock(P, { review: "later" });
  assert.equal(later.research, 1, "the review's own answers, or an answer asked again, counted as research obtained after the full review");
  assert.equal(readFileSync(join(P.runDir, RESEARCH_AFTER_REVIEW_MD), "utf8"), `Question 1: Does Epsilon BV sell game servers? Answer 1: ${long}\n`);
  assert.deepEqual(ids(later.lines), [], "research moved an exclusion into the decisions the review checks");
  assert.deepEqual(ids(later.reference), ["/mark/eu/c1", "/mark/eu/d1", "/mark/eu/e1"]);
  assert.ok(writerExclusionLinesOf(later).join("\n").includes(`${WRITER_EXCLUSIONS_UNCHANGED}\n${researchAfterReviewLine(1)}\n${WRITER_EXCLUSIONS_REFERENCE}\n- QZORVAK — Gamma SA (/mark/eu/c1)`),
    "the research is not named after the decisions checked and before the exclusions for reference");
  // The artifact search hands its lines back whole: a line cut at 400 characters would drop the answer.
  const found = searchRunArtifacts(P.runDir, { file: RESEARCH_AFTER_REVIEW_MD, terms: ["Epsilon BV"] });
  assert.equal(found.matches[0]?.text, `Question 1: Does Epsilon BV sell game servers? Answer 1: ${long}`, "the search cut the answer");
  // A reworded answer to a question asked before the full review is research obtained after it.
  answer(P, "2026-10-30T09:04:00.000Z", `${WRITER}-rerun1`, "Is QZORVAK in use for game controllers in the EU?", "No longer: withdrawn from sale in 2026.");
  assert.equal(writerExclusionBlock(P, { review: "later" }).research, 2);
  // A new full review starts the comparison again, and the file the earlier reading wrote goes.
  writerExclusionBlock(P, { review: "full" });
  assert.ok(!existsSync(join(P.runDir, RESEARCH_AFTER_REVIEW_MD)));
  assert.equal(writerExclusionBlock(P, { review: "later" }).research, 0);
});

test("a full review recorded before its research was kept is compared by time", (t) => {
  const P = seedRun(t);
  answer(P, "2026-10-30T08:00:00.000Z", WRITER, "Is QZORVAK in use for game controllers in the EU?", "Yes: sold online since 2024.");
  writerExclusionBlock(P, { review: "full" });
  const at = driverDir(P.runDir, "review-exclusions-full.json");
  const rec = JSON.parse(readFileSync(at, "utf8"));
  delete rec.research;
  writeFileSync(at, JSON.stringify({ ...rec, ts: "2026-10-30T08:30:00.000Z" }));
  answer(P, "2026-10-30T09:00:00.000Z", WRITER, "Does Epsilon BV sell game servers?", "Yes.");
  assert.equal(writerExclusionBlock(P, { review: "later" }).research, 1, "an answer obtained after an older full review was not handed on, or one before it was");
});

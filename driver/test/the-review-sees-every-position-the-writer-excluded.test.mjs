// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEW SEES EVERY POSITION THE WRITER EXCLUDED.
//
// The review was told the writer's declinations only where one covered an in-class identical or near floor, so the
// writer's exclusion of a headline candidate or a sheet-2 position off the floors reached it as an absence, and a flag
// on such a position named no finding, which opened the whole corrective pass. Now the full review is told every
// position placement put forward that the writer excluded, at any tier, once each, with placement's tier and reason
// and the writer's ground, under the ruled standard (2026-10-29). A later review is told what changed. A flag names
// an excluded position by its record id, and the corrective pass is narrowed to it. Every mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths, STAGES, WRITER_EXCLUSIONS_STANDARD, WRITER_EXCLUSIONS_UNREAD, WRITER_EXCLUSIONS_UNCHANGED, writerExclusionLines as writerExclusionLinesOf } from "../stages.mjs";
import { writerExclusions, writerExclusionBlock, messageCtxFor, correctionsExtra, prepareDeclinationSpec } from "../pipeline.mjs";
import { appendDeclinations, declinationCallPaths } from "../declination-tool.mjs";
import { acceptRefutation, recordRefutation, listedExclusionPositions } from "../narrative-refutation-record.mjs";
import { parseCorrections } from "../verify.mjs";
import { correctionScope, scopeDrift } from "../corrections-feedforward.mjs";
import { repairFollowup } from "../repair-composers.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

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

test("a later review is told what changed, what its flags named, and what covers a floor; settled exclusions stay settled", (t) => {
  const P = seedRun(t);
  writerExclusionBlock(P, { review: "full" });
  const later = writerExclusionBlock(P, { review: "later" });
  assert.deepEqual(later.lines.map((l) => l.match(/\((\/mark\/[^,)]+)/)[1]), ["/mark/eu/c1"], "only the floor's exclusion stands in an unchanged later review");
  // The corrective pass re-grounds d1; e1 is untouched.
  appendDeclinations(P.runDir, [{ uri: "/mark/eu/d1", reason: "dissimilar-mark", grounds: "Read aloud, the endings differ for a buyer of controllers." }]);
  const after = writerExclusionBlock(P, { review: "later" });
  assert.deepEqual(after.lines.map((l) => l.match(/\((\/mark\/[^,)]+)/)[1]), ["/mark/eu/c1", "/mark/eu/d1"]);
  assert.ok(after.lines[1].endsWith("Read aloud, the endings differ for a buyer of controllers."));
  // A flag named e1: it is listed for the recheck though it did not change.
  assert.ok(writerExclusionBlock(P, { review: "later", named: ["/mark/eu/e1"] }).lines.some((l) => l.includes("(/mark/eu/e1)")));
  // A finding now delivers e1: the later review is told its exclusion ended, and never that nothing changed.
  writeFileSync(P.findings, synthesisFindings(P.runDir).replaceAll("/mark/us/90000001", "/mark/eu/e1").replace(/"registrations":\s*\[/, "\"registrations\": [{\"uri\": \"/mark/eu/a1\"}, "));
  const ended = writerExclusionBlock(P, { review: "later" });
  assert.ok(ended.lines.includes("- ZORVA — Epsilon BV (/mark/eu/e1): excluded at the full review, now delivered as a finding"), ended.lines.join(" | "));
  assert.ok(!writerExclusionLinesOf(ended).includes(WRITER_EXCLUSIONS_UNCHANGED));
  // With no floor and nothing changed, the later review is told the full review's list stands.
  const plain = seedRun(t);
  writeFileSync(plain.bandShape, JSON.stringify({ floors: { in_class_identical_or_near: [] } }));
  writerExclusionBlock(plain, { review: "full" });
  const text = String(repairFollowup("narrative-refutation:post-repair-review", { findings: "/run/findings.json", changes: [], resting: [],
    renumbered: false, coverageChanged: false, evidence: {}, registerOnly: false, job: {}, skepticFlags: "/run/sf.md", frameReopenReceipt: "/run/fr.json",
    floorDecisions: [], writerExclusions: writerExclusionBlock(plain, { review: "later" }) }));
  assert.ok(text.includes(`${WRITER_EXCLUSIONS_STANDARD}\n${WRITER_EXCLUSIONS_UNCHANGED}\n`), "an unchanged later review read \"(none)\" or nothing");
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

test("a flag on an excluded position narrows the corrective pass to it; an undeclared flag still opens the whole pass", (t) => {
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
  assert.ok(msg.includes("THIS IS THE COMPLETE LIST: (none — its flags are about excluded positions)."), "the pass was not told its flags are about positions");
  assert.ok(msg.includes("THE EXCLUDED POSITIONS ITS FLAGS ARE ABOUT: QZORVEX — Delta AG (/mark/eu/d1), row 2. For each, either record it as a finding, or keep its exclusion by calling `record_declination` again for its row with a ground that answers the flag."),
    "the pass was not told the position, or the row to keep its exclusion by");
  assert.ok(msg.includes("Change ONLY those finding objects, any finding you record for those positions, and ONLY the narrative passages that discuss them. EVERY OTHER FINDING OBJECT"),
    "the pass was not told to leave everything else as it is");
});

test("the recheck is told to read each named position's decision, beside the exclusions that changed", (t) => {
  const P = seedRun(t);
  writerExclusionBlock(P, { review: "full" });
  const text = String(repairFollowup("narrative-refutation:verdict-recheck", { narrative: "/run/narrative.md", findings: "/run/findings.json", seniorEyeReview: "/run/senior-eye-review.md",
    correctionsScope: { scoped: true, named: [], positions: ["/mark/eu/d1"], moved: [], unbound: [] }, appliedTable: "", restoredTable: "", evidenceTable: "", planAuditCarry: "",
    writerExclusions: writerExclusionBlock(P, { review: "later", named: ["/mark/eu/d1"] }) }));
  assert.ok(text.includes("For each excluded position your flags named, check in the writer's exclusions below whether it is now a finding or its exclusion was recorded again with a ground that answers your flag."));
  assert.ok(text.includes(`${WRITER_EXCLUSIONS_STANDARD}\n- QZORVAK — Gamma SA (/mark/eu/c1)`) && text.includes("- QZORVEX — Delta AG (/mark/eu/d1, /mark/de/d2)"));
  assert.ok(!text.includes("(/mark/eu/e1)"), "a settled exclusion no flag named was listed again");
});

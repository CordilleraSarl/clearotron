// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REVIEW IS HANDED THE ADDRESSES ITS FLAGS MAY NAME.
//
// A flag names the findings it is about by ordinal, and nothing checked the ordinal named a finding the review was
// handed; the report's other parts had no address, so a correction bound a flag to them by matching its prose. The
// address list names every finding by ordinal, across the records before and after a correction, and every coverage
// line, action, mark assessment read and narrative section by the key a correction already uses. A key two rows of
// one record share is never offered. What a flag declares resolves against the list, or the first thing that does not
// is returned, with the listed address it differs from only in spacing or case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDeclared, reviewAddresses } from "../review-addresses.mjs";

const BEFORE = {
  findings: [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }],
  coverage: [{ area: "European Union", note: "searched" }, { area: "United Kingdom", note: "" }],
  actions: [{ id: "watch", text: "Watch the register." }],
  mark_assessment: { distinctiveness: "Inherently distinctive.", connotation: "" },
};
const AFTER = { findings: [{ ordinal: 1 }, { ordinal: 3 }, { ordinal: 4 }], coverage: BEFORE.coverage, actions: BEFORE.actions,
  markAssessment: BEFORE.mark_assessment };
const NARRATIVE = { verdict: "Proceed with care.", coverage: { read: "" }, spine: "The spine.", calibration: "", ask_answers: [] };

test("findings are addressed by ordinal across the record before and after a correction", () => {
  const list = reviewAddresses({ records: [BEFORE, AFTER] });
  assert.deepEqual(list.ordinals, [1, 2, 3, 4], "a finding the correction removed, or added, must stay nameable");
  assert.equal(list.schema, 1);
});

test("each other part is addressed by the key a correction already gives it, and only parts with content", () => {
  const list = reviewAddresses({ records: [BEFORE, AFTER], narratives: [NARRATIVE] });
  assert.deepEqual(list.lines, [
    { address: "coverage:european union", label: 'the coverage line for "European Union"' },
    { address: "coverage:united kingdom", label: 'the coverage line for "United Kingdom"' },
    { address: "action:watch", label: 'the action "watch"' },
    { address: "mark-assessment:distinctiveness", label: "the mark assessment's distinctiveness" },
    { address: "section:verdict", label: "the narrative's verdict section" },
    { address: "section:spine", label: "the narrative's spine section" },
  ], "an empty mark assessment read or narrative section has nothing for a flag to be about");
});

test("a key two rows of one record share is not offered, and a row with no area or id is not addressed", () => {
  const doc = { findings: [], coverage: [{ area: "Japan" }, { area: "japan." }, { area: "" }], actions: [{ text: "No id." }] };
  const list = reviewAddresses({ records: [doc] });
  assert.deepEqual(list.lines, [], "two rows that one address would name, and rows with no identity, are left out");
  const sameRowTwice = reviewAddresses({ records: [{ coverage: [{ area: "Japan" }] }, { coverage: [{ area: "Japan" }] }] });
  assert.deepEqual(sameRowTwice.lines.map((l) => l.address), ["coverage:japan"], "the same row before and after is one part");
});

test("what a flag declares resolves against the list, or the first thing that does not is named", () => {
  const list = reviewAddresses({ records: [BEFORE, AFTER], narratives: [NARRATIVE] });
  assert.deepEqual(resolveDeclared(list, { on: [2, 4], lines: ["coverage:european union", "section:verdict"] }), { ok: true });
  assert.deepEqual(resolveDeclared(list, {}), { ok: true }, "a flag about the document as a whole declares nothing");
  assert.deepEqual(resolveDeclared(list, { on: [1, 9] }), { ok: false, kind: "ordinal", value: 9 });
  assert.deepEqual(resolveDeclared(list, { lines: "coverage:european union" }), { ok: false, kind: "lines-shape" });
  assert.deepEqual(resolveDeclared(list, { lines: [7] }), { ok: false, kind: "lines-shape" });
  assert.deepEqual(resolveDeclared(list, { lines: ["Coverage:European  Union"] }),
    { ok: false, kind: "line", value: "Coverage:European  Union", near: "coverage:european union" });
  assert.deepEqual(resolveDeclared(list, { lines: ["section:calibration"] }),
    { ok: false, kind: "line", value: "section:calibration", near: null }, "an empty section was not handed to the review");
});

// ── what the review's recording tool does with them ──────────────────────────────────────────────────
const { acceptRefutation, recordRefutation, listedAddresses } = await import("../narrative-refutation-record.mjs");
const { parseCorrections } = await import("../verify.mjs");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { driverDir } = await import("../../shared/driver-dir.mjs");

const LIST = reviewAddresses({ records: [BEFORE, AFTER], narratives: [NARRATIVE] });
const flag = (extra) => ({ kind: "fact", text: "The coverage line for the European Union overstates what was searched.", ...extra });
const accept = (flags, addresses = LIST) => acceptRefutation({ verdict: "CONDITIONAL", flags }, { addresses });

test("a flag's declared parts render on its line and read back off it, without the token in its text", () => {
  const r = accept([flag({ on: [2], lines: ["coverage:european union", "section:verdict"] })]);
  assert.equal(r.ok, true, r.reason);
  assert.match(r.content, /^1\. \[kind: fact\] \[on: 2\] \[lines: coverage:european union, section:verdict\] The coverage line/m);
  const [row] = parseCorrections(r.content);
  assert.deepEqual(row.lines, ["coverage:european union", "section:verdict"]);
  assert.deepEqual(row.ordinals, [2]);
  assert.doesNotMatch(row.text, /\[lines:/, "the token is the channel, not the instruction");
  assert.deepEqual(accept([flag({})]).ok, true, "a flag that declares nothing is unchanged");
  assert.doesNotMatch(accept([flag({})]).content, /\[lines:/);
});

test("an ordinal or address the review was not handed is refused in its turn, with the near address when there is one", () => {
  assert.equal(accept([flag({ on: [9] })]).reason,
    "refutation_flag_on_unknown:0:9 — finding 9 is not among the findings this review was handed; use the correct listed ordinal, or omit `on` if the flag is not about a finding");
  assert.match(accept([flag({ lines: "coverage:european union" })]).reason, /^refutation_flag_lines_invalid:0 /);
  assert.match(accept([flag({ lines: [] })]).reason, /^refutation_flag_lines_invalid:0 /);
  assert.match(accept([flag({ lines: ["Coverage:European Union"] })]).reason,
    /^refutation_flag_line_unlisted:0:Coverage:European Union — .*; the list gives "coverage:european union"$/);
  assert.doesNotMatch(accept([flag({ lines: ["section:calibration"] })]).reason, /the list gives/);
});

test("with no address list written, `on` is checked as before and no address can resolve", () => {
  assert.equal(accept([flag({ on: [9] })], null).ok, true, "a dispatch that wrote no list keeps today's check");
  assert.match(accept([flag({ lines: ["section:verdict"] })], null).reason, /^refutation_flag_line_unlisted:0:section:verdict/);
});

test("the recording tool reads the list the dispatch wrote into the run", () => {
  const runDir = mkdtempSync(join(tmpdir(), "review-addresses-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  assert.equal(listedAddresses(runDir), null);
  writeFileSync(driverDir(runDir, "review-addresses.json"), JSON.stringify(LIST));
  assert.deepEqual(listedAddresses(runDir).ordinals, [1, 2, 3, 4]);
  const refused = recordRefutation(runDir, { verdict: "CONDITIONAL", flags: [flag({ on: [7] })] });
  assert.match(refused.refused ?? "", /^refutation_flag_on_unknown:0:7/);
  const written = recordRefutation(runDir, { verdict: "CONDITIONAL", flags: [flag({ lines: ["action:watch"] })] });
  assert.equal(written.refused, null);
  assert.match(readFileSync(written.written, "utf8"), /\[lines: action:watch\]/);
});

// ── the dispatch, the correction and the recheck ───────────────────────────────────────────────────────
const { addressListLines, partsDrift, writeReviewAddresses, ADDRESS_LIST_HEADING } = await import("../review-addresses.mjs");
const { repairFollowup } = await import("../repair-composers.mjs");

test("the dispatch writes the list where the recording tool reads it, and shows one row per address", () => {
  const runDir = mkdtempSync(join(tmpdir(), "review-addresses-write-"));
  const list = writeReviewAddresses(runDir, { records: [BEFORE, null, AFTER], narratives: [NARRATIVE] });
  assert.deepEqual(listedAddresses(runDir), { ordinals: list.ordinals, lines: list.lines, seq0: null });
  assert.deepEqual(addressListLines(list), [ADDRESS_LIST_HEADING, ...list.lines.map((l) => `- ${l.label} — address ${l.address}`)]);
  assert.equal(addressListLines(list)[1], '- the coverage line for "European Union" — address coverage:european union');
  assert.deepEqual(addressListLines({ ordinals: [1], lines: [] }), [], "no block when only findings are addressable");
  assert.deepEqual(addressListLines(null), []);
});

test("a correction's other parts that moved and no flag named are recorded, and the comparison says when it was not complete", () => {
  const rewritten = { ...AFTER, coverage: [{ area: "European Union", note: "searched again" }, BEFORE.coverage[1]],
    actions: [{ id: "watch", text: "Watch the register monthly." }] };
  const narratives = { before: NARRATIVE, after: NARRATIVE };
  assert.deepEqual(partsDrift([{ lines: ["coverage:european union"] }], BEFORE, rewritten, { narratives }),
    { named: ["coverage:european union"], moved: [{ address: "action:watch", label: 'the action "watch"' }], complete: true });
  const spine = { before: NARRATIVE, after: { ...NARRATIVE, spine: "A different spine." } };
  assert.deepEqual(partsDrift([], BEFORE, AFTER, { narratives: spine }).moved, [{ address: "section:spine", label: "the narrative's spine section" }]);
  // Missing evidence or an ambiguous address is not "none moved".
  assert.deepEqual(partsDrift([], BEFORE, AFTER), { named: [], moved: [], complete: false }, "with no earlier narrative the sections were not compared");
  assert.deepEqual(partsDrift([], null, AFTER), { named: [], moved: [], complete: false }, "with no record before the pass nothing was compared");
  const twice = { ...BEFORE, coverage: [...BEFORE.coverage, { area: "european union", note: "a second row" }] };
  assert.equal(partsDrift([], twice, twice, { narratives }).complete, false, "two rows under one address cannot say which moved");
});
test("the correction is told the parts its flags declared, and the recheck what moved outside them", () => {
  const correction = String(repairFollowup("synthesis:corrective", { narrative: "narrative.md", findings: "findings.json", placement: "placement.md",
    worklist: "", review: "", scope: { scoped: true, ordinals: [2], lineLabels: ['the coverage line for "European Union"', "the narrative's verdict section"] } }));
  assert.match(correction, /THE LINES AND SECTIONS ITS FLAGS ARE ABOUT: the coverage line for "European Union"; the narrative's verdict section\./);
  const undeclared = String(repairFollowup("synthesis:corrective", { narrative: "narrative.md", findings: "findings.json", placement: "placement.md",
    worklist: "", review: "", scope: { scoped: true, ordinals: [2] } }));
  assert.doesNotMatch(undeclared, /THE LINES AND SECTIONS/, "a correction whose flags declared no part is told nothing new");

  const recheck = (lines) => String(repairFollowup("narrative-refutation:verdict-recheck", { narrative: "narrative.md", findings: "findings.json",
    seniorEyeReview: "senior-eye-review.md", correctionsScope: { scoped: true, named: [2], moved: [], unbound: [], ...(lines ? { lines } : {}) },
    appliedTable: "", restoredTable: "", evidenceTable: "", planAuditCarry: "" }));
  assert.match(recheck({ named: [], moved: [{ address: "action:watch", label: 'the action "watch"' }], complete: true }),
    /none moved, so you do not need to re-read them\. THE DRIVER ALSO COMPARED EVERY COVERAGE LINE, ACTION, MARK ASSESSMENT READ AND NARRATIVE SECTION NO FLAG NAMES and 1 moved anyway — the action "watch"; read those too and say whether the change is defended\. Then re-write/);
  assert.match(recheck({ named: [], moved: [], complete: true }), /NO FLAG NAMES and none moved\. Then re-write/);
  // A comparison that could not be completed claims nothing: the recheck re-reads both files whole, as before the scope.
  const incomplete = recheck({ named: [], moved: [], complete: false });
  assert.doesNotMatch(incomplete, /Read narrowly|THE DRIVER ALSO COMPARED|none moved/);
  assert.match(incomplete, /Re-read BOTH updated files/);
  assert.doesNotMatch(recheck(null), /THE DRIVER ALSO COMPARED/, "a correction recorded before the parts were compared says nothing about them");
});

test("a review refused once and accepted on its next call hands the correction its accepted flags", async () => {
  const { readAcceptedFlags } = await import("../narrative-refutation-record.mjs");
  const runDir = mkdtempSync(join(tmpdir(), "review-refused-then-accepted-"));
  assert.ok(recordRefutation(runDir, { verdict: "BLOCKING", flags: [] }).refused, "the first call must be refused");
  assert.equal(readAcceptedFlags(runDir), null);
  assert.equal(recordRefutation(runDir, { verdict: "CONDITIONAL", flags: [flag({})] }).refused, null);
  assert.deepEqual(readAcceptedFlags(runDir), [flag({})], "the second call's flags, not the parse and not the refused call");
});

test("a flag that declares a part is bound to it, not to the line its prose happens to quote", async () => {
  const { buildCorrectionsApplied } = await import("../corrections-feedforward.mjs");
  const pre = { findings: [], coverage: [{ area: "European Union", note: "every class searched on the register" }],
    actions: [{ id: "watch", text: "Watch the register." }] };
  const post = { ...pre, actions: [{ id: "watch", text: "Watch the register monthly." }] };
  const quoting = "the coverage line for European Union says every class searched on the register, and the watch action must follow it";
  const [declared] = buildCorrectionsApplied([{ n: 1, kind: "fact", ordinals: [], lines: ["action:watch"], text: quoting }], pre, post);
  assert.deepEqual({ targets: declared.targets, outcome: declared.outcome }, { targets: ['the action "watch"'], outcome: "line-changed" });
  const [prose] = buildCorrectionsApplied([{ n: 1, kind: "fact", ordinals: [], text: quoting }], pre, post);
  assert.ok(prose.targets.includes('the coverage line for "European Union"'), "with no declaration the prose match stands, as before");
});

test("the list and the accepted call belong to the review dispatch being acted on, and a failed write leaves no older list", async () => {
  const { readAcceptedFlags } = await import("../narrative-refutation-record.mjs");
  const runDir = mkdtempSync(join(tmpdir(), "review-dispatch-bound-"));
  writeReviewAddresses(runDir, { records: [BEFORE], seq0: 1 });
  assert.equal(recordRefutation(runDir, { verdict: "CONDITIONAL", flags: [flag({})] }).refused, null);
  assert.deepEqual(readAcceptedFlags(runDir), [flag({})], "the first review's own call");
  // A later dispatch whose every call is refused, or which wrote its review by hand, has no accepted call of its own.
  writeReviewAddresses(runDir, { records: [AFTER], seq0: 2 });
  assert.ok(recordRefutation(runDir, { verdict: "BLOCKING", flags: [] }).refused);
  assert.equal(readAcceptedFlags(runDir), null, "a later dispatch must not inherit the earlier review's flags");
  // A list that cannot be written is not left in place from an earlier dispatch.
  const failing = mkdtempSync(join(tmpdir(), "review-dispatch-failed-"));
  writeReviewAddresses(failing, { records: [BEFORE], seq0: 1 });
  const unreadable = { get findings() { throw new Error("the record could not be read"); } };
  assert.equal(writeReviewAddresses(failing, { records: [unreadable], seq0: 3 }), null);
  assert.equal(listedAddresses(failing), null, "the earlier dispatch's list was left for this one to read");
});

// ── THE FAILED-LIST PATH: an earlier accepted review never stands in for the review being acted on ──────────────────────
//
// A dispatch whose list could not be written removes the earlier list. Reading every call from the first would then hand
// the correction the earlier review's flags. So would a list whose removal failed too, which still names the earlier
// dispatch. Each case seeds an earlier review dispatch with an accepted call, starts a later dispatch, and reads the flags
// the correction would act on. The dispatch records are written as the gateway writes them, before the model runs, and
// their times are set so the order does not depend on the clock's resolution.
const { REVIEW_FILE, refutationCallPaths } = await import("../narrative-refutation-record.mjs");
const { recordDispatch, dispatchFileName } = await import("../dispatch-record.mjs");
const { utimesSync } = await import("node:fs");
const LATER_REVIEW = "CLEAR\n\nThe later review, written into the file by hand.\n";
const at = (secondsAgo) => new Date(Date.now() - secondsAgo * 1000);

function reviewDispatch(runDir, secondsAgo, message) {
  recordDispatch(runDir, "narrative-refutation", { attempt: 1, message });
  const t = at(secondsAgo);
  utimesSync(driverDir(runDir, dispatchFileName("narrative-refutation", 1)), t, t);
}

function earlierReviewAccepted(label) {
  const runDir = mkdtempSync(join(tmpdir(), `review-${label}-`));
  writeReviewAddresses(runDir, { records: [BEFORE], seq0: 1 });
  reviewDispatch(runDir, 120, "the earlier review");
  const r = recordRefutation(runDir, { verdict: "CONDITIONAL", flags: [flag({})] });
  assert.equal(r.refused, null);
  const t = at(110);
  utimesSync(join(refutationCallPaths(runDir).dir, "call-001.json"), t, t);
  return runDir;
}

test("a failed list write leaves the correction no earlier review's flags", async () => {
  const { readAcceptedFlags } = await import("../narrative-refutation-record.mjs");
  const runDir = earlierReviewAccepted("failed-write");
  assert.deepEqual(readAcceptedFlags(runDir), [flag({})], "the earlier review's own flags, while it is the review in force");
  const unreadable = { get findings() { throw new Error("the record could not be read"); } };
  assert.equal(writeReviewAddresses(runDir, { records: [unreadable], seq0: 2 }), null);
  reviewDispatch(runDir, 60, "the later review");
  writeFileSync(join(runDir, REVIEW_FILE), LATER_REVIEW);
  assert.equal(readAcceptedFlags(runDir), null, "with no list, the earlier review's call stood in for the later review");
});

test("a list whose removal failed after a failed write does not make the earlier review current", async () => {
  const { readAcceptedFlags } = await import("../narrative-refutation-record.mjs");
  const runDir = earlierReviewAccepted("failed-remove");
  // The state both failures leave: the earlier dispatch's list, still readable, and a later dispatch under way.
  assert.equal(listedAddresses(runDir).seq0, 1);
  reviewDispatch(runDir, 60, "the later review");
  writeFileSync(join(runDir, REVIEW_FILE), LATER_REVIEW);
  assert.equal(readAcceptedFlags(runDir), null, "the stale list handed the correction the earlier review's flags");
  // The later dispatch saving through the tool is the review in force, and its own flags are read.
  const later = flag({ text: "The later review's flag on the coverage line." });
  assert.equal(recordRefutation(runDir, { verdict: "CONDITIONAL", flags: [later] }).refused, null);
  assert.deepEqual(readAcceptedFlags(runDir), [later]);
});

test("both failures, as they happen: a list that can be neither written nor removed", { skip: process.getuid?.() === 0 ? "a read-only folder does not stop root" : false }, async () => {
  const { readAcceptedFlags } = await import("../narrative-refutation-record.mjs");
  const { chmodSync } = await import("node:fs");
  const runDir = earlierReviewAccepted("read-only");
  const drv = driverDir(runDir);
  // Only the list's two files are refused: the folder is read-only for the write and the removal, then writable again
  // for the dispatch record, which the gateway writes on its own.
  chmodSync(drv, 0o555);
  try {
    assert.equal(writeReviewAddresses(runDir, { records: [AFTER], seq0: 2 }), null, "the write did not fail");
    assert.equal(listedAddresses(runDir)?.seq0, 1, "the earlier list was removed, so this does not test a failed removal");
  } finally { chmodSync(drv, 0o755); }
  reviewDispatch(runDir, 60, "the later review");
  writeFileSync(join(runDir, REVIEW_FILE), LATER_REVIEW);
  assert.equal(readAcceptedFlags(runDir), null);
});

test("a saved call a replay copies in while the dispatch runs is that dispatch's, whatever time the call itself records", async () => {
  const { readAcceptedFlags } = await import("../narrative-refutation-record.mjs");
  const runDir = mkdtempSync(join(tmpdir(), "review-replay-"));
  writeReviewAddresses(runDir, { records: [BEFORE], seq0: 1 });
  reviewDispatch(runDir, 60, "the review");
  // The saved run's own receipt time, days before this dispatch, as a copied capture keeps it.
  assert.equal(recordRefutation(runDir, { verdict: "CONDITIONAL", flags: [flag({})] }, { now: () => at(3 * 86400).toISOString() }).refused, null);
  assert.deepEqual(readAcceptedFlags(runDir), [flag({})]);
});

test("with no dispatch record, the list alone decides, as before", async () => {
  const { readAcceptedFlags, reviewDispatchBegan } = await import("../narrative-refutation-record.mjs");
  const runDir = mkdtempSync(join(tmpdir(), "review-no-record-"));
  writeReviewAddresses(runDir, { records: [BEFORE], seq0: 1 });
  assert.equal(recordRefutation(runDir, { verdict: "CONDITIONAL", flags: [flag({})] }).refused, null);
  assert.equal(reviewDispatchBegan(runDir), null);
  assert.deepEqual(readAcceptedFlags(runDir), [flag({})]);
});

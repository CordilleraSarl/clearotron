// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// declination-is-stated-not-inferred.test.mjs —, the same seam from both ends.
//
// ── WHAT THE TWO ISSUES ASK FOR, IN ONE SENTENCE ──────────────────────────────────────────────────
//
//: "a retrieved candidate can only leave the findings path by an explicit, recorded disposition."
//: 102 records reached the findings surface, stopped there, and carried `reason_source:
// step-silent` — a label inferred from WHERE the record stopped, not stated by the step that stopped
// it. One of them was a REGISTERED right placed on sheet-2 and stamped carry:"carried", so the label
// was not only unstated but wrong about a record the run had already decided to carry.
//
// So the guarantee has two halves and this file asserts both: a stated decision is RECORDED AS STATED,
// and an unstated one is RECORDED AS THE DEFECT IT IS. The second half is the one that matters, because
// it is the half that used to read as "not a defect" by definition.
//
// ── WHY `absent` AND NOT `step-silent`, ASSERTED RATHER THAN ASSUMED ───────────────────────────────
//
// `REASON_SOURCES` defines `step-silent` as "the decision is attested; the ground is not. NOT a defect
// — this is the shape of an undiscriminating funnel with late judgment", and `absent` as "nothing
// attests anything. THE DEFECT the run reports." Once the dictation ORDERS a decision per record, an
// unanswered record is the second thing and not the first — and the difference is not cosmetic: it is
// what `unreasoned` counts, what the predelivery lint names per record, and what mints an open doubt.
// The tripwire asks for already existed. The seam was reporting the one value defined as "not a
// defect", so it could never fire on these rows.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import {
  DECLINATION_REASONS, DECLINATION_REASON_TOKENS, MIN_GROUNDS,
  acceptDeclinationCall, contradictionFor, isIdenticalToAppliedMark, groundsProblem, seamReasonFor,
} from "../declination-call.mjs";
import { recordDeclinations, readDeclinations, appendDeclinations } from "../declination-tool.mjs";
import { REASON_SOURCES } from "../record-carry.mjs";
import { STAGES } from "../stages.mjs";

const SCOPE = { marks: ["MERIDIAN THISTLE"], classes: [9, 42] };
const ROWS = [
  { uri: "/mark/gt/a1", mark: "MERIDIAN", owner: "Avaya Inc.", classes: [9, 42], status: "REGISTERED" },
  { uri: "/mark/em/a2", mark: "MERIDIAN THISTLE", owner: "Tail Filer", classes: [9], status: "REGISTERED" },
  { uri: "/mark/us/a3", mark: "THISTLEDOWN BAKERY", owner: "A Bakery", classes: [30], status: "REGISTERED" },
  { uri: "/mark/gb/a4", mark: "MERIDIAN THISTLE", owner: "Client Sub Ltd", classes: [42], status: "REGISTERED" },
  { uri: "/mark/ch/a5", mark: "MERIDIAN THISTLE", owner: "Long Gone SA", classes: [9], status: "EXPIRED" },
];
const spec = (runDir) => ({ runDir, rows: ROWS, scope: SCOPE });
const ground = (s) => `${s} — recorded for the reviewing lawyer, not for a parser.`;

let dirs = [];
const tmpRun = () => { const d = mkdtempSync(join(tmpdir(), "decl-")); dirs.push(d); mkdirSync(driverDir(d), { recursive: true }); return d; };
test.after(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

// ── the vocabulary has ONE author ─────────────────────────────────────────────────────────────────

test("every reason token cites the rule that authorises it, and the discretionary split is explicit", () => {
  assert.ok(DECLINATION_REASON_TOKENS.length >= 3, "a vocabulary this small is not a vocabulary");
  for (const t of DECLINATION_REASON_TOKENS) {
    const r = DECLINATION_REASONS[t];
    assert.ok(r.rules && r.rules.length > 10, `${t} cites no authorising rule — a reason with no author is one this repo minted, and the whole point is that it did not`);
    assert.ok(r.gloss && r.gloss.length > 20, `${t} has no gloss — the seat is handed the token in the tool schema and must be able to pick without guessing`);
    assert.equal(typeof r.discretionary, "boolean", `${t} does not say whether it asserts something about relevance — the refusal surface keys on exactly that`);
  }
  // The two bookkeeping routes must stay non-discretionary: they are the escape a seat needs when the
  // record IS an identical in-class mark and genuinely should not be delivered.
  assert.equal(DECLINATION_REASONS["own-right"].discretionary, false);
  assert.equal(DECLINATION_REASONS["duplicate-of-delivered"].discretionary, false);
});

// ── the acceptance boundary ───────────────────────────────────────────────────────────────────────

test("a legitimate declination is accepted, and one refused row never voids its neighbours", () => {
  const r = acceptDeclinationCall(spec("/nowhere"), { declinations: [
    { row_index: 2, reason: "unrelated-goods", grounds: ground("Class 30 bakery goods against a class 9/42 matter") },
    { row_index: 99, reason: "own-right", grounds: ground("a row this pass was never handed") },
    { row_index: 4, reason: "not-worth-the-line", grounds: ground("expired a decade ago, no renewal on the register") },
  ] });
  assert.deepEqual(r.accepted.map((a) => a.row_index), [2, 4], "the good rows must survive the bad one — all-or-nothing was the old transport's whole disease");
  assert.equal(r.refused.length, 1);
  assert.match(r.refused[0].why, /position/i, "an out-of-range row must be told it cited a position, not a record");
});

test("a record the pass was never handed cannot be spoken about at all", () => {
  // The ruling: a validator that REJECTS an unknown uri has moved the defect; a schema that
  // cannot EXPRESS one has removed it. There is no uri field, so this is the only way to be wrong.
  for (const bad of [-1, 5, 1.5, "2", null, undefined]) {
    const r = acceptDeclinationCall(spec("/nowhere"), { declinations: [{ row_index: bad, reason: "own-right", grounds: ground("x".repeat(40)) }] });
    assert.equal(r.accepted.length, 0, `row_index ${String(bad)} was accepted — positions are the whole containment`);
  }
});

test("one decision per record: a second declination for the same row in one call is refused", () => {
  const r = acceptDeclinationCall(spec("/nowhere"), { declinations: [
    { row_index: 2, reason: "unrelated-goods", grounds: ground("first decision") },
    { row_index: 2, reason: "own-right", grounds: ground("second decision on the same row") },
  ] });
  assert.equal(r.accepted.length, 1);
  assert.match(r.refused[0].why, /already carries a declination/);
});

test("a reason outside the vocabulary is refused and the answer names the whole set", () => {
  const r = acceptDeclinationCall(spec("/nowhere"), { declinations: [{ row_index: 2, reason: "seemed-weak", grounds: ground("a token nobody authorised") }] });
  assert.equal(r.accepted.length, 0);
  for (const t of DECLINATION_REASON_TOKENS) assert.ok(r.refused[0].why.includes(t), `the refusal must list ${t} — a seat told only "no" retries blind`);
});

test("grounds is checked for PRESENCE, never graded — and the floor is what makes silence expensive", () => {
  assert.ok(groundsProblem("", "own-right"), "empty grounds must be refused — that is the silence this tool replaces");
  assert.ok(groundsProblem("x".repeat(MIN_GROUNDS - 1), "own-right"), "a sub-floor ground must be refused");
  assert.equal(groundsProblem("x".repeat(MIN_GROUNDS + 1), "own-right"), "", "a ground over the floor must pass — this is a floor, not a grammar");
  assert.ok(groundsProblem("own right", "own-right"), "grounds that merely echo the reason token add nothing");
  // The load-bearing one: real declination prose must PASS. An earlier draft ran grounds through
  // grounds-grammar.mjs's classifyGroundsNote, which is built for "what could not be established" about
  // a charged rating — a different speech act. It refused seven of seven realistic declinations, which
  // would have left the silent path as the only one that worked.
  for (const g of [
    "Already delivered as finding 4 under the EUIPO record for the same proprietor and the same word mark.",
    "A dormant single-class filing by an individual with no visible trade; it fits none of the four manageable categories.",
    "Class 30 bakery goods; this matter is class 9 and 42 software and services.",
  ]) assert.equal(groundsProblem(g, "not-worth-the-line"), "", `real declination prose was refused: ${g}`);
});

// ── the one refusal, and the arm that proves it can fail ──────────────────────────────────────────

test("an identical, live, in-class mark cannot be declined on a discretionary ground", () => {
  const r = acceptDeclinationCall(spec("/nowhere"), { declinations: [
    { row_index: 1, reason: "not-worth-the-line", grounds: ground("a small filer with no visible trade") },
  ] });
  assert.equal(r.accepted.length, 0, "synthesis-rules.md:167 — an on-point identical mark in the relevant class is never dropped, regardless of filer profile");
  assert.match(r.refused[0].why, /IDENTICAL/);
  assert.match(r.refused[0].why, /own-right|duplicate-of-delivered/, "the refusal must name the routes that ARE open, or it reads as 'you may never decline this'");
});

test("…and the same record IS declinable on a bookkeeping ground — the refusal is not a ban", () => {
  const r = acceptDeclinationCall(spec("/nowhere"), { declinations: [
    { row_index: 3, reason: "own-right", grounds: ground("the proprietor is the applicant's own subsidiary, named in the matter frame") },
  ] });
  assert.equal(r.accepted.length, 1, "an identical in-class mark that is the applicant's OWN right must still be declinable — otherwise the engine is making the legal call, not the lawyer");
});

test("PLANT: delete the liveness test and an expired identical mark starts being refused", () => {
  // The refusal rests on THREE facts and this arm is the one that proves the third is read. Row 4 is
  // MERIDIAN THISTLE in class 9 — identical and in-class — but EXPIRED, so it is outside the rule the
  // dictation states, and a declination on it is the lawyer's call.
  assert.equal(contradictionFor("not-worth-the-line", ROWS[4], SCOPE), "",
    "an EXPIRED identical mark must not be refused — the rule is about live rights, and a refusal here would be the engine over-reaching");
  const live = { ...ROWS[4], status: "REGISTERED" };
  assert.notEqual(contradictionFor("not-worth-the-line", live, SCOPE), "",
    "the SAME record with a live status must be refused — if this passes, the status half of the test is dead and the arm above proves nothing");
});

test("PLANT: identity is the house normalizer, not string equality, and it is not a prefix match", () => {
  assert.ok(isIdenticalToAppliedMark("meridian  thistle!", ["MERIDIAN THISTLE"]), "case, punctuation and spacing must fold — otherwise the rule is evaded by a stray character");
  assert.ok(!isIdenticalToAppliedMark("MERIDIAN", ["MERIDIAN THISTLE"]), "a SHARED ELEMENT is not an identical mark — near-identical is the lawyer's judgment and this tool does not make it");
  assert.ok(!isIdenticalToAppliedMark("", ["MERIDIAN THISTLE"]), "an empty mark must never match — a record with no name would otherwise be refused on every discretionary ground");
});

test("there is NO class-overlap refusal, and this arm is why", () => {
  // Built, measured, deleted. It refused `unrelated-goods` over any record sharing a filed class and
  // fired on 170 of 170 findings-surface records of a delivered run, because the register sweep IS
  // scoped to the filed classes. It was also wrong on the law: class 9 carries software, fire
  // extinguishers and diving suits, so "shares class 9" and "the goods are unrelated" are both true of
  // the same record all the time. Refusing on it would be the engine making a relatedness call.
  assert.equal(contradictionFor("unrelated-goods", ROWS[0], SCOPE), "",
    "a record sharing a filed class must still be declinable as unrelated-goods — a Nice class is not a statement about goods");
});

// ── the ledger, and the three-valued read ─────────────────────────────────────────────────────────

test("an absent ledger and an empty one are different facts", () => {
  const d = tmpRun();
  const before = readDeclinations(d);
  assert.equal(before.present, false, "no ledger must read as ABSENT — 'nothing was recorded' is not 'nothing was declined'");
  appendDeclinations(d, [{ uri: "/mark/us/a3", mark: "THISTLEDOWN BAKERY", reason: "unrelated-goods", grounds: ground("class 30") }]);
  const after = readDeclinations(d);
  assert.equal(after.present, true);
  assert.equal(after.count, 1);
});

test("a re-stated declination supersedes and KEEPS what it replaced", () => {
  const d = tmpRun();
  appendDeclinations(d, [{ uri: "/mark/us/a3", mark: "T", reason: "unrelated-goods", grounds: ground("first read") }]);
  appendDeclinations(d, [{ uri: "/mark/us/a3", mark: "T", reason: "not-worth-the-line", grounds: ground("second read after a corrective") }]);
  const led = JSON.parse(readFileSync(driverDir(d, "declinations.json"), "utf8"));
  assert.equal(led.declinations.length, 1, "one row per record");
  assert.equal(led.declinations[0].reason, "not-worth-the-line", "the LAST decision wins");
  assert.ok(led.declinations[0].supersedes, "the earlier decision must survive — a seat that changed its mind after a corrective is doing the right thing, and losing the first row hides that it happened");
  assert.equal(led.declinations[0].supersedes.reason, "unrelated-goods");
});

test("the tool answers with what is STILL OPEN, so the seat can finish in its own turn", () => {
  const d = tmpRun();
  const out = recordDeclinations(spec(d), { declinations: [
    { row_index: 2, reason: "unrelated-goods", grounds: ground("class 30 bakery goods") },
  ] });
  assert.equal(out.accepted, 1);
  assert.equal(out.offered, ROWS.length);
  assert.equal(out.still_open.length, ROWS.length - 1);
  assert.match(out.note, /still carry no decision/, "the answer must say what is owed — a tool that only says 'ok' teaches the seat nothing");
  // The call is captured BEFORE anything is decided about it, refused rows included.
  const captured = JSON.parse(readFileSync(driverDir(d, "declination-calls", "call-001.json"), "utf8"));
  assert.equal(captured.declinations.length, 1, "the payload must be the call as RECEIVED — evidence about what was sent, not about what we liked");
});

// ── the seam's vocabulary, which is where 's guarantee actually lands ──────────────────────────

test("the two reason_source values this build turns on mean opposite things", () => {
  // Asserted here rather than trusted, because the whole fix is a change from one to the other and a
  // reader three months from now needs the definitions in front of the change that uses them.
  assert.ok(REASON_SOURCES.includes("step-stated"), "a step wrote a ground naming this record");
  assert.ok(REASON_SOURCES.includes("absent"), "nothing attests anything — THE DEFECT the run reports");
  assert.ok(REASON_SOURCES.indexOf("absent") > REASON_SOURCES.indexOf("step-stated"),
    "the enum is ordered weakest-last; `absent` must remain the weakest or `unreasoned` is counting the wrong rows");
});

// ── 's guarantee, asserted on the seam's own decision ─────────────────────────────────────────

test("#703: a stated decision is recorded AS STATED — step-stated, carrying the seat's own grounds", () => {
  const declined = { present: true, byUri: new Map([["/mark/us/a3", {
    uri: "/mark/us/a3", mark: "THISTLEDOWN BAKERY", reason: "unrelated-goods", grounds: "Class 30 bakery goods against a class 9/42 matter.",
  }]]) };
  const r = seamReasonFor(declined, "/mark/us/a3");
  assert.equal(r.reason_source, "step-stated");
  assert.equal(r.reason, "synthesis:declined:unrelated-goods");
  assert.match(r.detail, /Class 30 bakery goods/, "the seat's own grounds must ride into the trace — the reason token alone is what step-silent already was");
});

test("#703: an UNSTATED decision is recorded as `absent`, which is the whole fix", () => {
  // This is the assertion exists for. Before it, this row read `step-silent`, which REASON_SOURCES
  // defines as "NOT a defect" — so `unreasoned` never counted it, the predelivery lint never named it,
  // and no doubt was ever minted for it. 102 records in one round, one of them a gold mark.
  const r = seamReasonFor({ present: true, byUri: new Map() }, "/mark/gt/a1");
  assert.equal(r.reason_source, "absent",
    "a findings-surface record with no recorded declination must read `absent` — `step-silent` is defined as not-a-defect and would re-hide exactly the 102 rows this change is about");
  assert.notEqual(r.reason_source, "step-silent");
});

test("#703: 'synthesis recorded nothing at all' and 'synthesis skipped this one' are different facts", () => {
  // An absence is a finding, so the two nothings must not read alike: one is a stage that never called
  // the tool, the other is a stage that called it and passed this record over.
  const noLedger = seamReasonFor({ present: false, byUri: new Map() }, "/mark/gt/a1");
  const skipped = seamReasonFor({ present: true, byUri: new Map() }, "/mark/gt/a1");
  assert.equal(noLedger.reason_source, "absent");
  assert.equal(skipped.reason_source, "absent");
  assert.notEqual(noLedger.detail, skipped.detail,
    "the two cases have opposite repairs — one is a stage that never recorded anything, the other is a stage that recorded and passed this record over");
  assert.match(noLedger.detail, /recorded no declination for any record/);
  assert.match(skipped.detail, /NONE of them names this record/);
});

test("PLANT: point the seam at step-silent and the guarantee arm reds", () => {
  // The arms above are only worth their space if the value is load-bearing. `unreasoned` filters on
  // exactly `absent` (record-carry.mjs), the predelivery lint reads that count, and doubts are minted
  // from it — so a seam that says `step-silent` here is invisible to all three.
  const r = seamReasonFor({ present: true, byUri: new Map() }, "/x");
  assert.equal(REASON_SOURCES.filter((v) => v === r.reason_source).length, 1, "the value must be a member of the declared enum, not a free string");
  assert.equal(r.reason_source, "absent");
});

// ── the dictation and the tool must agree about the refusal surface ───────────────────────────────

test("the dictation names the tool's ACTUAL refusal, and no other — the drift that nearly shipped", () => {
  // Caught by reading the rendered dispatch, not by a test, which is why this arm exists. The
  // class-overlap refusal was built, measured at 170/170 on a delivered run, and deleted — and the
  // dictation went on telling the seat that declining a record as `unrelated-goods` over a shared filed
  // class would be refused. A seat believing that avoids a declination the rules authorise and the tool
  // accepts, which pushes it back to the silent path this whole build exists to close. A dictation that
  // describes a guard nobody has is worse than one that describes none.
  const surface = [{ uri: "/mark/em/x1", mark: "DELPHIC", owner: "D S & D Ltd", tier: "sheet-2" }];
  const text = String(STAGES.synthesis.message({
    paths: { findings: "/run/findings.json" }, job: {}, customerUnknown: false, profile: null,
    intakeAsks: [], enforcerSignals: null, framework: null, jxAim: null, registerOnly: false,
    crowdContext: null, dispatchBlocks: {}, findingsSurface: surface,
  }));

  // 1. every token the tool accepts is offered to the seat, and no token it does not.
  for (const t of DECLINATION_REASON_TOKENS) assert.ok(text.includes(t), `the dispatch never names the reason "${t}" — a token the seat is not shown is one it cannot pick`);

  // 2. the ONE refusal is stated.
  assert.match(text, /IDENTICAL to the applied-for mark/, "the dispatch must name the identical-mark refusal — a refusal a seat meets without warning costs it a turn");

  // 3. and the deleted one is NOT, in either direction: the tool accepts a class-sharing declination,
  //    so a dispatch describing that as refusable is describing a guard that does not exist.
  const classSharing = { uri: "/m/1", mark: "SOMETHING ELSE", owner: "X", classes: [9], status: "REGISTERED" };
  assert.equal(contradictionFor("unrelated-goods", classSharing, SCOPE), "",
    "guard for the arm below: the tool must ACCEPT this, or the assertion after it is asserting the wrong thing");
  assert.doesNotMatch(text, /unrelated-goods["'’]? when it is registered in one of/,
    "the dispatch still describes the class-overlap refusal, which was deleted");
});

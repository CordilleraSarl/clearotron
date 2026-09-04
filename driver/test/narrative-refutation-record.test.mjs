// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// reviewer half — the recording transport for the reviewer's verdict and typed flags.
//
// THE ARMS THAT MATTER HERE ARE THE ROUND-TRIP ONES. This transport's whole claim is that the document
// the driver renders satisfies every reader verify.mjs runs against it — so the tests assert against
// THOSE FUNCTIONS, imported from the shipping module, never against a copy of the shape. A test that
// pinned the markdown by string would pass while the parsers disagreed with it, which is the seam this
// conversion exists to close.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acceptRefutation, renderRefutation, recordRefutation, planReceiptPresent, REVIEW_FILE,
  readAcceptedFlags, refutationCallPaths,
} from "../narrative-refutation-record.mjs";
import {
  parseVerdict, countCitedDefects, parseCorrectionKinds, parseCorrections, findReviewerCoherenceFlags,
  validators, CORRECTION_KINDS,
} from "../verify.mjs";

const FLAGS = [
  { kind: "fact", on: [9], text: "narrative.md states 1 March 2011; the fetched record reads 25 February 2011.", fix: "restate the date as 25 February 2011." },
  { kind: "coverage-disposition", on: null, text: "the summary says the search finished; the receipt shows the phonetic axis never ran.", fix: "remove the completion sentence." },
  { kind: "rating", on: [6, 12], text: "both marks are rated MANAGEABLE against an identical-goods overlap." },
];

test("#1893: the rendered review round-trips through every parser the pipeline runs against it", () => {
  const r = acceptRefutation({ verdict: "BLOCKING", flags: FLAGS, plan_audit: ["| axis | executed |"] },
    { receiptPresent: true });
  assert.ok(r.ok, `refused: ${r.reason}`);

  assert.equal(parseVerdict(r.content), "BLOCKING",
    "the verdict decides whether the run may deliver at all — a render the verdict parse cannot read is the "
    + "one defect this transport must never introduce");

  const kinds = parseCorrectionKinds(r.content);
  assert.equal(kinds.untyped, 0,
    "every flag was TYPED in the call, so a line landing on the `fact` fail-safe means the [kind:] token "
    + "did not render onto it — the channel silently lost, which is what #1558 built the key to expose");
  for (const k of CORRECTION_KINDS) {
    assert.equal(kinds.counts[k], FLAGS.filter((f) => f.kind === k).length, `kind ${k} did not survive the render`);
  }
});

// ── THE MEASUREMENT THIS RENDER IS SHAPED BY ──────────────────────────────────────────────────────
//
// `countCitedDefects` walks EVERY list line outside the plan audit and applies no body rule — its own
// comment says so deliberately, because it decides whether to DISCARD a review and permissive evidence
// is the safe side there. So a `- Fix: …` sub-bullet under a flag counts as a SECOND cited defect. The
// fix therefore renders as an indented continuation with no marker.
test("#1893: the fix line is carried but is NOT counted as a second cited defect", () => {
  const withFixes = acceptRefutation({ verdict: "BLOCKING", flags: FLAGS }, { receiptPresent: false });
  assert.ok(withFixes.ok, `refused: ${withFixes.reason}`);
  assert.equal(countCitedDefects(withFixes.content), FLAGS.length,
    "three flags must count three; a marker on the fix line doubles the count and a BLOCKING review then "
    + "reports defects nobody raised");

  // The fixes really are in the document — otherwise this arm passes by having dropped them.
  assert.match(withFixes.content, /restate the date as 25 February 2011\./,
    "the fix text must survive the render; a count that is right because the fix vanished is not the property");

  // THE PLANT, driven rather than asserted: give the fix a list marker and the count doubles for the two
  // flags that carry one. This is what the no-marker rule buys, stated as a failure rather than a comment.
  const planted = withFixes.content.split("\n").map((l) => l.replace(/^ {3}Fix: /, "   - Fix: ")).join("\n");
  assert.equal(countCitedDefects(planted), FLAGS.length + 2,
    "the plant must actually change the count — if it does not, this arm is not measuring what it claims");
});

test("#1893: the corrective worklist gets clean text, with no markup left by the token strip", () => {
  const r = acceptRefutation({ verdict: "CONDITIONAL", flags: FLAGS }, { receiptPresent: false });
  assert.ok(r.ok, `refused: ${r.reason}`);
  const corrections = parseCorrections(r.content);
  assert.equal(corrections.length, FLAGS.length);
  for (const [i, c] of corrections.entries()) {
    assert.equal(c.text, FLAGS[i].text,
      "the corrective pass ACTS on this text, so anything the [kind:]/[on:] strip leaves behind rides into "
      + "the instruction the next seat is given. Measured: `**[kind: …] [on: …]**` returned `** ** the "
      + "summary says …`, which is why the tokens carry no bold wrapper");
    assert.equal(c.kind, FLAGS[i].kind);
    assert.equal(c.typed, true, "a typed call must never produce an untyped correction");
    assert.deepEqual(c.ordinals, FLAGS[i].on ?? []);
  }
});

test("#1893: a well-formed typed review raises no coherence flag", () => {
  const r = acceptRefutation({ verdict: "BLOCKING", flags: FLAGS }, { receiptPresent: false });
  assert.ok(r.ok);
  assert.deepEqual(findReviewerCoherenceFlags(r.content), [],
    "that detector already misfires on correctly-formed reviews (its own comment says so); a rendered "
    + "review is the one input it must never annotate, or the signal stops being believed");
});

test("#1893: the shipped validator accepts the rendered review, receipt or no receipt", () => {
  const dir = mkdtempSync(join(tmpdir(), "ct-refutation-"));
  try {
    const withoutReceipt = acceptRefutation({ verdict: "CLEAR", flags: [] }, { receiptPresent: false });
    assert.ok(withoutReceipt.ok, `refused: ${withoutReceipt.reason}`);
    const p = join(dir, REVIEW_FILE);
    writeFileSync(p, withoutReceipt.content);
    assert.equal(validators.seniorEyeReview(p, withoutReceipt.content).ok, true,
      "a CLEAR review with no flags is the ordinary happy path and must validate");

    // With a receipt on disk the validator demands the audit section. The transport renders it, so the
    // validator's `plan_audit_missing` becomes unreachable from a typed call rather than merely rarer.
    mkdirSync(join(dir, "_driver"), { recursive: true });
    writeFileSync(join(dir, "_driver", "plan-execution.json"), JSON.stringify({ entries: [] }));
    assert.equal(planReceiptPresent(dir), true, "the fixture must actually build the condition it tests");
    const audited = acceptRefutation({ verdict: "BLOCKING", flags: FLAGS, plan_audit: ["| axis | executed |", "| default | yes |"] },
      { receiptPresent: true });
    assert.ok(audited.ok, `refused: ${audited.reason}`);
    writeFileSync(p, audited.content);
    assert.equal(validators.seniorEyeReview(p, audited.content).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1893: the audit section is owed on the DRIVER's read of the receipt, not the seat's word", () => {
  const r = acceptRefutation({ verdict: "CONDITIONAL", flags: FLAGS }, { receiptPresent: true });
  assert.equal(r.ok, false, "a run with a receipt owes the audit; a call that omits it must be refused");
  assert.match(r.reason, /^refutation_plan_audit_missing/);
  // There is no parameter through which a seat could assert the receipt is absent — whether the audit is
  // owed is a fact about the run. Asserted by the signature rather than by prose: the flag comes from
  // options the driver supplies, and `params` has no field that reaches it.
  const sneaky = acceptRefutation({ verdict: "CONDITIONAL", flags: FLAGS, receiptPresent: false, plan_execution: null },
    { receiptPresent: true });
  assert.equal(sneaky.ok, false,
    "a field in the payload must not be able to waive the audit — a seat that could assert the receipt "
    + "away could waive its own audit");
});

test("#1893: a BLOCKING that names nothing is refused where it is typed, not at the gate", () => {
  const r = acceptRefutation({ verdict: "BLOCKING", flags: [] }, { receiptPresent: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /^refutation_blocking_without_flags/);
  // The same shape reaching the gate costs one forced-fresh re-ask of the whole stage. Refused here it
  // costs a restatement in the turn the seat is already in.
  const conditional = acceptRefutation({ verdict: "CONDITIONAL", flags: [] }, { receiptPresent: false });
  assert.equal(conditional.ok, true,
    "only BLOCKING requires cited defects — a CONDITIONAL with no flags is a legitimate answer and must "
    + "not be swept up by the refusal above");
});

test("#1893: the closed vocabularies are enforced, so an unrepresentable value cannot be rendered", () => {
  for (const [label, params, token] of [
    ["a verdict outside the enum", { verdict: "MOSTLY FINE", flags: [] }, /^refutation_verdict_invalid/],
    ["a kind outside CORRECTION_KINDS", { verdict: "CONDITIONAL", flags: [{ kind: "vibes", text: "x" }] }, /^refutation_kind_invalid/],
    ["a multi-line flag", { verdict: "CONDITIONAL", flags: [{ kind: "fact", text: "one\ntwo" }] }, /^refutation_flag_text_multiline/],
    ["a flag opening as a list item", { verdict: "CONDITIONAL", flags: [{ kind: "fact", text: "- smuggled" }] }, /^refutation_flag_text_opens_as_a_list_or_heading/],
    ["a non-integer ordinal", { verdict: "CONDITIONAL", flags: [{ kind: "fact", text: "x", on: ["nine"] }] }, /^refutation_flag_on_invalid/],
    ["flags omitted entirely", { verdict: "CLEAR" }, /^refutation_flags_missing/],
  ]) {
    const r = acceptRefutation(params, { receiptPresent: false });
    assert.equal(r.ok, false, `${label} must be refused`);
    assert.match(r.reason, token, label);
  }
});

test("#1893: the call is captured before it is judged, and a refusal still records what arrived", () => {
  const dir = mkdtempSync(join(tmpdir(), "ct-refutation-"));
  try {
    const bad = recordRefutation(dir, { verdict: "BLOCKING", flags: [] });
    assert.equal(bad.written, null, "a refused call writes no artifact");
    assert.match(String(bad.refused), /^refutation_blocking_without_flags/);
    assert.ok(bad.captured, "the payload is captured BEFORE the decision — a capture written after it "
      + "records what we DECIDED, which is already in the answer, rather than what we were GIVEN");

    const good = recordRefutation(dir, { verdict: "CONDITIONAL", flags: FLAGS });
    assert.equal(good.refused, null, `refused: ${good.refused}`);
    assert.equal(good.written, join(dir, REVIEW_FILE));
    assert.equal(good.verdict, "CONDITIONAL");
    assert.equal(good.flags, FLAGS.length);
    assert.equal(good.cited, FLAGS.length, "what the driver reports back must be what the file parses to");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1893: the seat does not number its own flags — the render does", () => {
  // A seat-supplied number is a value that can disagree with the list it labels, and nothing downstream
  // would notice. The schema has no field for it; this pins that a number sent anyway is ignored rather
  // than honoured, so the two can never disagree.
  const shuffled = [{ n: 7, ...FLAGS[0] }, { n: 7, ...FLAGS[1] }];
  const r = acceptRefutation({ verdict: "CONDITIONAL", flags: shuffled }, { receiptPresent: false });
  assert.ok(r.ok, `refused: ${r.reason}`);
  const nums = parseCorrections(r.content).map((c) => c.n);
  assert.deepEqual(nums, [1, 2],
    "render order is the numbering; two flags both claiming 7 must still come back 1 and 2");
});

test("#1893: renderRefutation is pure and puts the verdict where both readers look", () => {
  const a = renderRefutation("BLOCKING", FLAGS, ["| x |"]);
  const b = renderRefutation("BLOCKING", FLAGS, ["| x |"]);
  assert.equal(a, b, "same values, same bytes");
  assert.equal(a.split("\n")[0], "BLOCKING",
    "`countCitedDefects` drops exactly ONE line before it walks, so a verdict anywhere but line 1 either "
    + "goes unread or gets counted as a defect");
});

// ── AND THE OTHER HALF OF THE ORDER, WHICH THE ARM ABOVE DOES NOT REACH ─────────────────────────────
//
// `renderRefutation`'s own header states two positional properties. The arm above pins the first. This
// pins the second, and it exists because of a class a peer surfaced converting the writer half: once the
// DRIVER owns a rendering, the seat can no longer get the order wrong — and the doctrine that set the
// order stops being honoured by anything at all. His renderer led with the spine where the product rule
// says verdict first, and no arm anywhere would have caught it.
//
// Here the stated reason is machine-read rather than editorial: `countCitedDefects` latches `inPlanAudit`
// at that heading and unlatches at the NEXT heading, so a flag rendered after the plan audit is excluded
// from the count only while nothing follows to reset the latch. That makes the order decide a NUMBER the
// corrective ladder acts on, so it is asserted by driving the parser, not by matching a string.
test("#1893: the plan audit renders last, and the cited-defect count is what depends on it", () => {
  const md = renderRefutation("BLOCKING", FLAGS, ["| plan entry 3 | executed |"]);
  const flagsAt = md.indexOf("## Flags");
  const auditAt = md.indexOf("## PLAN-EXECUTION CHECK");
  assert.ok(flagsAt > -1 && auditAt > -1, "both sections must render — this arm reads nothing otherwise");
  assert.ok(flagsAt < auditAt,
    "the plan audit must render AFTER the flags. countCitedDefects latches at its heading and unlatches "
    + "at the next one, so flags rendered below it are excluded only by accident of what follows");

  // THE CONSEQUENCE, DRIVEN — AND MY FIRST DRIVE OF IT WAS THE WRONG ONE, which is worth leaving here.
  // I hoisted the audit ABOVE the flags and asserted the count changed. It does not: the latch unlatches
  // at `## Flags`, so every flag is still counted and both documents read 2. The arm failed, correctly,
  // and the failure was mine rather than the code's.
  //
  // The hazard the header actually names is a flag rendered after the audit with NOTHING following to
  // reset the latch. That flag is swallowed — it is a cited defect the corrective ladder never sees, on a
  // BLOCKING review, which is the one place a missed defect costs a forced re-ask.
  const swallowed = [md.trimEnd(), "4. [kind: fact] a defect written below the audit with no heading after it."].join("\n");
  assert.equal(countCitedDefects(swallowed), countCitedDefects(md),
    "a flag rendered below the plan audit is INVISIBLE to countCitedDefects — the count did not move when "
    + "one was added. That is the whole reason the audit renders last: everything the count must see has "
    + "already been emitted by the time the latch closes. If this ever stops holding, the latch has "
    + "changed and the reason recorded in renderRefutation's header is stale");
});

// ── T3b's INPUT: the accepted flags, and the four ways there is nothing to hand back ────────────────
//
//. The corrective pass builds its worklist by re-parsing the rendered markdown, which
// is the parse the conversion removed the need for. `readAcceptedFlags` is what replaces it — and the
// whole risk is that the stored payload is written BEFORE validation, so a refused call leaves a
// complete, well-formed record of a review the driver never rendered.
test("#1889 T3b: the accepted flags come back as typed values, not re-parsed prose", () => {
  const dir = mkdtempSync(join(tmpdir(), "t3b-accepted-"));
  try {
    const r = recordRefutation(dir, { verdict: "CONDITIONAL", flags: FLAGS });
    assert.equal(r.refused, null, `the fixture call was refused: ${r.refused}`);
    const got = readAcceptedFlags(dir);
    assert.ok(Array.isArray(got), "an accepted call must hand its flags back");
    assert.equal(got.length, FLAGS.length, "every typed flag, not a subset");
    // THE VALUES THEMSELVES, not a count and not a re-parse: `kind` is what targeted fixes will key on,
    // and `text` is what reaches the client if the fix fails. A count would satisfy a weaker arm.
    assert.deepEqual(got.map((f) => f.kind), FLAGS.map((f) => f.kind),
      "the kinds must survive as typed values — this is the channel a keyword grep over prose could not "
      + "read, and the reason the conversion happened");
    assert.equal(got[0].text, FLAGS[0].text, "and the text is the seat's own, byte for byte");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1889 T3b: a REFUSED call hands back nothing, though its payload looks authoritative", () => {
  const dir = mkdtempSync(join(tmpdir(), "t3b-refused-"));
  try {
    // A BLOCKING citing nothing is refused where it is typed. The payload is still written — that is
    // deliberate, so a call that crashes the validator leaves its input — and it is complete and
    // well-formed. Nothing about the FILE says the review was rejected except the field this adds.
    const r = recordRefutation(dir, { verdict: "BLOCKING", flags: [] });
    assert.ok(r.refused, "the fixture must actually be refused, or this arm proves nothing");
    const { payload } = refutationCallPaths(dir);
    const raw = JSON.parse(readFileSync(payload, "utf8"));
    assert.equal(raw.accepted, false, "the payload must record that this call was refused");
    assert.ok(raw.refusedReason, "…and why, so a reader does not have to re-run the validator to find out");
    assert.ok(raw.params, "the input is still captured — a refused call's input is evidence, not noise");

    assert.equal(readAcceptedFlags(dir), null,
      "a refused review's flags must NOT reach a consumer. The driver never rendered this review, so "
      + "keying targeted fixes off it would repair a document against objections that were rejected — "
      + "confidently, because the payload is complete and reads exactly like an accepted one");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1889 T3b: no payload and an unreadable payload are the same answer — nothing to act on", () => {
  const dir = mkdtempSync(join(tmpdir(), "t3b-absent-"));
  try {
    assert.equal(readAcceptedFlags(dir), null, "a run whose stage never called the tool has no flags");
    const { dir: callDir, payload } = refutationCallPaths(dir);
    mkdirSync(callDir, { recursive: true });
    writeFileSync(payload, "{ this is not json");
    assert.equal(readAcceptedFlags(dir), null,
      "a truncated capture must read as absent rather than throwing into the caller — but it must NOT "
      + "read as an empty flag list, which would say the reviewer raised nothing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

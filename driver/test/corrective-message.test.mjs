// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Unit tests for the Fix B corrective-retry message builder (gateway.mjs).
// Pure offline: a string transform, no gateway/network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { correctiveMessage, warmPatchMessage, TOOL_WRITTEN_ARTIFACTS } from "../gateway.mjs";

const BASE = "Produce the register digest.";
// — a synthetic path, not an operator's. What this fixture needs is a plausible ABSOLUTE run path;
// naming a specific account made it wrong under every other service account and in every public clone.
const FILE = "/srv/agentplatform/workspace-clawdi/studio/prelim-search/run/register-findings.md";

test("attempt 1 → base message verbatim (no correction), even with a prior fail set", () => {
  assert.equal(correctiveMessage(BASE, 1, "invalid_file:x:missing:findings+ledger", FILE), BASE);
});

test("attempt >1 after a content failure → appends a CORRECTION naming the reason + file", () => {
  const m = correctiveMessage(BASE, 2, "invalid_file:run/register-findings.md:missing:findings+ledger", FILE);
  assert.ok(m.startsWith(BASE));
  assert.match(m, /CORRECTION:/);
  assert.match(m, /missing:findings\+ledger/);              // the fail reason rides in
  assert.match(m, /prelim-search\/run\/register-findings\.md/); // the expectFile, relativized
  const mm = correctiveMessage(BASE, 3, "missing_file:run/register-findings.md", FILE);
  assert.match(mm, /CORRECTION:/);
});

test("reason-aware hint: a use_check_missing failure tells synthesis to add the Use-check source line", () => {
  const m = correctiveMessage("Synthesize.", 2, "invalid_file:run/narrative.md:use_check_missing:Finding 1 — Myrkur", "/x/prelim-search/run/narrative.md");
  assert.match(m, /Use-check source:/);
  assert.match(m, /perplexity_research/);
  assert.match(m, /use_check_missing/);            // the raw reason still rides in
  // a register-digest STRUCTURAL failure gets the sections hint instead. emits `findings-heading`
  // on a FORM-armed run (the seat writes no table there) and `findings+ledger` on one with no form —
  // the floor is armed by the same condition as the gate that replaces it, so BOTH tokens are live and
  // both must route to a hint that names what is missing.
  const d = correctiveMessage("Digest.", 2, "invalid_file:run/register-findings.md:missing:findings-heading", "/x/prelim-search/run/register-findings.md");
  assert.match(d, /a findings heading/);
  assert.match(correctiveMessage("Digest.", 2, "invalid_file:run/register-findings.md:missing:findings+ledger", "/x/prelim-search/run/register-findings.md"),
    /Coverage ledger with a status row/, "an unstamped run still owes the table, and the hint says so");
});

test("WS-A coverage_* tokens get the JSON-mirror hint — NOT the common-law prose-sections hint (collision guard)", () => {
  const m = correctiveMessage("Digest.", 2,
    "invalid_file:run/register-findings.md:coverage_status_invalid:coverage-limited (count-only, saturated) (EXACTLY one bare token…)",
    "/x/prelim-search/run/register-findings.md");
  assert.match(m, /register-coverage-ledger\.json/);
  assert.match(m, /bare token/);
  assert.match(m, /coverage_status_invalid/);                 // the offending token is quoted back
  // the legacy branch /negative-results|coverage-ledger|audit-trail/ must NOT capture the underscore token
  assert.doesNotMatch(m, /Negative results matrix/);
  const a = correctiveMessage("Digest.", 2, "invalid_file:run/register-findings.md:coverage_axis_missing:incumbent-class", "/x/prelim-search/run/register-findings.md");
  assert.match(a, /coverage_axis_missing:incumbent-class/);
});

test("shipped grid tokens now carry reason-aware hints (grid_join_missing / grid_ledger_unparseable)", () => {
  const j = correctiveMessage("Sweep.", 2, "invalid_file:run/common-law-findings.md:grid_join_missing:novapulse:5/7", "/x/prelim-search/run/common-law-findings.md");
  assert.match(j, /common-law-grid\.json/);
  assert.match(j, /novapulse:5\/7/);                             // the short variants ride into the hint
  const u = correctiveMessage("Sweep.", 2, "invalid_file:run/common-law-findings.md:grid_ledger_unparseable:batch missing cells[]", "/x/prelim-search/run/common-law-findings.md");
  assert.match(u, /VERBATIM/);
  assert.match(u, /no reformatting/);
});

test("timeout / transport failures get NO corrective text (re-running is the fix, not different content)", () => {
  assert.equal(correctiveMessage(BASE, 2, "timeout", FILE), BASE);
  assert.equal(correctiveMessage(BASE, 2, "embedded_fallback", FILE), BASE);
  assert.equal(correctiveMessage(BASE, 2, "nonzero_exit_1", FILE), BASE);
});

test("no prior fail → base message (guards the first iteration's undefined lastFail)", () => {
  assert.equal(correctiveMessage(BASE, 2, undefined, FILE), BASE);
  assert.equal(correctiveMessage(BASE, 2, null, FILE), BASE);
});

test("expectFile accepts an array; all names appear relativized", () => {
  const m = correctiveMessage(BASE, 2, "invalid_file:x:reason", [FILE, "/x/prelim-search/run/audit.md"]);
  assert.match(m, /register-findings\.md/);
  assert.match(m, /prelim-search\/run\/audit\.md/);
});

// ── T1: the run-health hint branches (J1b / J3b / J6) ──────────────────────────────────────────
test("J1b: named_band_state_invalid names the bad state, dictates the in-place qid-less repair, forbids the executor re-call", () => {
  const m = correctiveMessage("Run the unit.", 2, "invalid_file:run/register-units/us.md:named_band_state_invalid:verified (one of: enumerated, incomplete)", "/x/run/register-units/us.md");
  assert.match(m, /state "verified"/, "the offending state is named");
  assert.match(m, /"enumerated"[\s\S]*"incomplete"/, "the legal enum is dictated");
  assert.match(m, /qid-less block\(s\) IN PLACE/i);
  assert.match(m, /NOT re-call register_execute_plan/, "the executor merge preserves the defect — the retry must not re-invoke it");
});

test("J3b: plan_audit_missing dictates the exact section title and keeps the verdict-first shape", async () => {
  const m = correctiveMessage("Refute.", 2, "invalid_file:run/senior-eye-review.md:plan_audit_missing", "/x/run/senior-eye-review.md");
  assert.match(m, /"PLAN-EXECUTION CHECK"/, "the exact required section title is dictated");
  assert.match(m, /FIRST line/, "the verdict-first contract is restated");
  // — the grading is asserted BY THE LITERAL, not by a phrase retyped here. This line used to read
  // `/skipped fringe is sanctioned/`, which is the same defect the hint had: a fourth copy of one rule,
  // in a test, quietly deciding what "sanctioned" means. Now the repair turn and the two dispatch blocks
  // all carry `PLAN_AUDIT_CLASSES` and this asserts the message carries THAT.
  const { PLAN_AUDIT_CLASSES } = await import("../register-plan.mjs");
  assert.ok(m.includes(PLAN_AUDIT_CLASSES),
    "the repair turn is handed the same graded classes the dispatch blocks state — a crowd-gated skip is never graded as a defect, and the rule saying so has one copy");
});

test("J6: coverage_clean_unexecuted names the axis and demands claim-vs-receipt reconciliation", () => {
  const m = correctiveMessage("Digest.", 2, "invalid_file:run/register-findings.md:coverage_clean_unexecuted:formative-root", "/x/run/register-findings.md");
  assert.match(m, /axis "formative-root"/);
  assert.match(m, /coverage-limited\/deferred/);
  assert.match(m, /never\s+rest on a slice the plan dictated and nothing ran/i);
});

// — THE REPAIR ORDERS THE CALL, and the section it used to dictate is the driver's.
// This hint ended "End the narrative with the section '## Answers to your instructions' carrying ONE line
// per frozen ask", on a stage whose grant carries no writer for the narrative at all. A repair rung is the
// worst place for that: it fires when something has already gone wrong and told the seat to do the one
// thing it cannot. The COUNT and the substance are unchanged — that half was never wrong.
test("spec-49 T9 (A2): intake_ask_unanswered names the count and orders the ask-answer CALL", () => {
  const m = correctiveMessage("Synthesize.", 2, "invalid_file:run/narrative.md:intake_ask_unanswered:1:of:2", "/x/run/narrative.md");
  assert.match(m, /missing 1 of the 2 intake-ask answers/, "the count still names what is owed");
  assert.match(m, /`ask_answers` entry per frozen ask/, "and the repair is the typed entry");
  assert.match(m, /record_synthesis/, "…through the call that owns the record");
  assert.match(m, /never silence/, "the not-executed contract survives verbatim");
  assert.doesNotMatch(m, /End the narrative with the section/,
    "the retired dictation is back — it orders a seat to write a section the driver code-builds, and the "
    + "seat holds no tool that writes it");
});

// ── ION/copper-foundry: the corrective ladder must agree with the lane the attempt ran on ────────────
// correctiveMessage APPENDS its hint to the stage message, so on a supplemental-lane run the legacy
// collapsed-band hint contradicted the prompt it was glued to — the message says the tool is gone and a
// hand-authored block fails the stage; the hint said "re-run it with register_enumerate and APPEND the
// records". runStage derives the lane from excludeTools (the ONE observable of the plan's contract in
// gateway.mjs) and threads it here as a TRAILING option, so every positional caller is untouched.
const COLLAPSED = "invalid_file:run/register-units/primary-sweep.md:named_band_collapsed:exact HALCYON~412";
const UNIT = "/x/prelim-search/run/register-units/primary-sweep.md";

test("named_band_collapsed on the supplemental lane: repair via the executor qid or a RE-PROPOSE, never by hand", () => {
  const m = correctiveMessage("Run the unit.", 2, COLLAPSED, UNIT, { supplementalLane: true });
  assert.match(m, /COLLAPSED enumerated slice/);            // the diagnosis is lane-independent
  assert.match(m, /HALCYON~412/);
  // the executor's published inputSchema is {plan_path, axis, output_path} on both providers — naming a
  // qid argument here would contradict the three-key call form the stage message this hint is APPENDED to
  assert.match(m, /register_execute_plan ONCE with the exact \{"plan_path", "axis", "output_path"\}/);
  assert.doesNotMatch(m, /register_execute_plan with that qid/);
  assert.match(m, /RE-PROPOSE that EXACT slice through register_propose_supplemental/);
  assert.match(m, /Do NOT author, edit or append a band block by hand/);
  assert.match(m, /BY DESIGN, never an outage or a permission fault/);
  // and it must not re-order the tool the attempt did not have
  assert.doesNotMatch(m, /Re-run that EXACT slice with register_enumerate/);
  assert.doesNotMatch(m, /APPEND its records as an "enumerated" block/);
});

test("named_band_collapsed off-lane keeps the enumerate repair verbatim (a frozen pre-flag resume still has the tool)", () => {
  const legacy = correctiveMessage("Run the unit.", 2, COLLAPSED, UNIT);
  assert.match(legacy, /Re-run that EXACT slice with register_enumerate/);
  assert.match(legacy, /APPEND its records as an "enumerated" block/);
  assert.doesNotMatch(legacy, /register_propose_supplemental/);
  // an omitted options arg and an explicit empty one are the same message (all shipped callers are positional)
  assert.equal(correctiveMessage("Run the unit.", 2, COLLAPSED, UNIT, {}), legacy);
  assert.equal(correctiveMessage("Run the unit.", 2, COLLAPSED, UNIT, { supplementalLane: false }), legacy);
});

test("the warm named_band_missing patch is UNCHANGED by the lane flag (it already dictates the tool call)", () => {
  const fail = "invalid_file:run/register-units/primary-sweep.md:named_band_missing";
  const off = warmPatchMessage(fail, UNIT);
  assert.equal(warmPatchMessage(fail, UNIT, { supplementalLane: true }), off);
  assert.match(off, /register_execute_plan/);
  assert.match(off, /do NOT author band blocks by hand/);
  assert.doesNotMatch(off, /register_enumerate/);
});

// The artifact this file's write-mode arms are driven on: one that NO tool-written row claims, so the
// composer still takes its write branch. Derived, because naming one means the arm breaks on the
// conversion that claims it — and it breaks as "the corrective lost its write order", which reads as a
// regression in the composer rather than as a fixture that has gone stale.
function handWrittenArtifact() {
  const candidates = ["common-law-findings.md", "case-law.md", "placement-recommendations.md"];
  const found = candidates.find((f) => !TOOL_WRITTEN_ARTIFACTS.has(f));
  assert.ok(found,
    "every candidate artifact is now tool-written, so this file's write-mode arms have no hand-written "
    + "branch to drive. Re-point the list at an artifact that is still the seat's, or retire the arms "
    + "with the branch they test — a vacuous pass here is the absence they exist to catch.");
  return found;
}

// ── A6 (addendum 2026-07-30): the max_tokens fault steers the retry — never a silent identical re-run ──
test("A6: max_tokens_no_output wrapping a content fail → the correction names the ceiling AND keeps the content hint", () => {
  // THE SUBJECT MOVED, AND THE FIXTURE MOVED WITH IT (conversion 11). This drove `register-findings.md`,
  // whose only writer is now the driver — so the composer correctly takes the CALL branch and emits no
  // write order, and the arm would have gone red about a mechanism that is working. The property under
  // test is about the max_tokens WRAPPER, not about which artifact it wraps, so it is driven on one that
  // is still hand-written. `ordersWriteFor` derives that rather than naming it, so the next conversion
  // re-points this arm instead of breaking it.
  const HAND_WRITTEN = handWrittenArtifact();
  const m = correctiveMessage(BASE, 2, `max_tokens_no_output:missing_file:run/${HAND_WRITTEN}`, `/x/prelim-search/run/${HAND_WRITTEN}`);
  assert.match(m, /CORRECTION:/);
  assert.match(m, /maximum output-token ceiling/);
  assert.match(m, /stop_reason max_tokens/);
  assert.match(m, /CALL THE WRITE TOOL/);
  assert.match(m, new RegExp(`missing_file:run/${HAND_WRITTEN.replace(".", "\\.")}`), "the underlying validator string still rides in");
  // a wrapped invalid_file keeps its reason-aware hint too
  const v = correctiveMessage(BASE, 2, "max_tokens_no_output:invalid_file:run/narrative.md:use_check_missing:F1", "/x/prelim-search/run/narrative.md");
  assert.match(v, /maximum output-token ceiling/);
  assert.match(v, /Use-check source:/, "the content hint derivation reads the INNER fail");
});

test("A6: the BARE max_tokens_no_output fault (transport-shaped turn) still gets a correction naming the fix", () => {
  const m = correctiveMessage(BASE, 2, "max_tokens_no_output", FILE);
  assert.match(m, /CORRECTION:/);
  assert.match(m, /maximum output-token ceiling/);
  assert.match(m, /prelim-search\/run\/register-findings\.md/, "the required file is named");
  // and the non-max_tokens transport failures keep today's behavior: no correction text at all
  assert.equal(correctiveMessage(BASE, 2, "nonzero_exit_1", FILE), BASE);
  assert.equal(correctiveMessage(BASE, 2, "timeout", FILE), BASE);
});

// ──: THE DEFERRED SLICES ARE FORM ROWS, NOT A PROSE BLOCK TO RETYPE ───────────────────────────
test("#476: the dispatch brief names the form; the corrective arm names the rows — neither recites a qid", async () => {
  const { coverageFormBrief, coverageFormRows } = await import("../coverage-form.mjs");
  // What 's block did, and why it had to: it printed EVERY deferred qid with its own receipt reason
  // because the accounting join was on the qid verbatim, so a qid the stage was never shown could never
  // be named. R1 carried fourteen. That whole economy question disappears when nothing is retyped.
  const many = Array.from({ length: 14 }, (_, i) => `primary-sweep:exact:q${i}`);
  const { rows } = coverageFormRows({
    skeleton: [{ axis: "primary-sweep", state: "deferred", deferred: many, missing: [] }],
    plan: { entries: many.map((qid, i) => ({ qid, axis: "primary-sweep", predicate: "exact",
      term: `Q${i}`, nice_classes: ["9"], expected_kind: "enumerate" })) },
    bandBlocksByAxis: {},
    deferredReasons: Object.fromEntries(many.map((q, i) => [q, `capability-gap number ${i}`])),
  });
  // EVERY qid ships as its own row, each carrying ITS OWN reason — the two things the elided hint could not do.
  const owed = rows.filter((r) => r.kind === "deferred");
  assert.equal(owed.length, 14);
  assert.deepEqual(owed.map((r) => r.qid), many, "nothing is elided, because nothing is being read aloud");
  assert.match(owed[13].receipt_reason, /capability-gap number 13/, "the last qid carries its OWN reason, not the first qid's");
  assert.ok(owed.every((r) => r.open === true));

  // The DISPATCH names the TOOL and the two fields, and requires none of the fourteen retyped: the rows
  // ride the dispatch with driver-minted row_ids, and a status binds by row_id — never by a qid the
  // seat reproduces (the typed transport kept 's economy and removed the file).
  const brief = coverageFormBrief({ rows });
  assert.match(brief, /record_coverage/);
  assert.match(brief, /14 row\(s\) are NEVER-SEARCHED slices/);
  assert.doesNotMatch(brief, /VERBATIM/, "there is no transcription contract left to state");
  for (const q of many) assert.ok(!brief.includes(q), `${q} is a join the driver owns; reciting it is the lane this removes`);
  assert.equal(coverageFormBrief({ rows: [] }), "", "nothing owed ⇒ no block, never an empty and alarming one");

  // The CORRECTIVE arm speaks the same doctrine — kept in step, as the pair always was.
  const corrective = correctiveMessage(BASE, 2, "invalid_file:run/register-findings.md:coverage_no_status:no_status=14;CD-A1B2C3D4 [primary-sweep / exact: Q0]", FILE);
  assert.match(corrective, /CD-A1B2C3D4/, "the driver's own row id, so the repair needs nothing else opened");
  assert.match(corrective, /never a clean negative/);
  assert.doesNotMatch(corrective, /VERBATIM/);
  // …and it must NOT tell the model to correct a clean claim: on this failure the row may simply be blank.
  assert.doesNotMatch(corrective, /yet your findings claim/i);
});

test("#476: the coverage hint LEADS WITH THE CAUSE — one token, three defects, three openings", () => {
  // THE 2026-08-05 LESSON, ONE LEVEL IN. `coverage_no_status` fires for a blank status, an off-enum
  // status, AND an enum-VALID confirmed-clean on a row the driver marked `open` — and the last is the
  // common one, because it is what a digest does when it believes a slice is fine and the machine knows
  // it is not. Opening with "row(s) with no status this gate accepts" over a form where every row
  // carries one orders the seat to do what it has already done, and because this token is warm-eligible
  // the wasted turn DISPLACES a cold attempt. verify.mjs partitions the census so this arm can tell
  // them apart; if it could not, all three would read identically.
  const openClean = correctiveMessage(BASE, 2,
    "invalid_file:run/register-findings.md:coverage_no_status:open_clean=2;CB-11112222 [primary-sweep / exact: LUMEN]", FILE);
  assert.match(openClean, /2 row\(s\).*marked "confirmed-clean" over an obligation the DRIVER computed as OPEN/);
  assert.match(openClean, /Every row already carries a status, so do not go looking for blank ones/);

  const blank = correctiveMessage(BASE, 2,
    "invalid_file:run/register-findings.md:coverage_no_status:no_status=3;CA-33334444 [primary-sweep]", FILE);
  assert.match(blank, /row\(s\) of your coverage form carry no status this gate accepts/);
  assert.doesNotMatch(blank, /Every row already carries a status/);

  // BOTH openings must still carry the block-vs-deferred doctrine, because the status the seat picks
  // decides the run's verdict: decideRegisterGap clamps CLEAR→CONDITIONAL on `deferred` rows only.
  for (const m of [openClean, blank]) {
    assert.match(m, /UNACCOUNTED CROWD BLOCK ran and saturated, so it is "coverage-limited"/);
    assert.match(m, /clamps this run's verdict to\s+CONDITIONAL/);
    assert.match(m, /EACH OPEN ROW IS DISCHARGED ONLY BY ITSELF/);
  }
});

test("#476: coverage_form_empty is a DRIVER defect, and never reads to the seat as rows it forgot", () => {
  const m = correctiveMessage(BASE, 2, "invalid_file:run/register-findings.md:coverage_form_empty:_driver/x absent", FILE);
  assert.match(m, /present but carries no rows/);
  assert.match(m, /DRIVER defect, not something your turn can repair/);
  assert.doesNotMatch(m, /Set "status" on every row/, "there are no rows to set a status on");
});

// ── — THE TOKEN THAT HAD NO HINT ───────────────────────────────────────────────
//
// The owner's demo clearance died on `connotation_query_unrecorded`, four attempts, the same refusal
// string byte for byte. 61 dictated meaning queries, 60 recorded; the one dropped was the only query in
// the whole sweep that found NOTHING. Not script, not normalisation, not truncation — two of the three
// queries on the same term recorded byte-identically, and seven of the eight "offensive meaning"
// queries recorded fine.
//
// The seat could have complied: the ledger row is {query, results}, an empty results array satisfies
// the validator's join (it tests query presence only), and two readers deliberately FILTER OUT
// empty-result rows — you only filter for something that can exist.
//
// IT COULD NOT HAVE LEARNED THAT FROM INSIDE THE RUN. The instruction that would have fixed it —
// "record EVERY query (even zero-result ones)" — is gated on `connotation_search_missing`, which means
// ZERO searches recorded. At 60 of 61 that condition is false. A hint gated behind the wrong condition
// is guidance that is absent exactly when it is wanted, and a retry with no guidance can only repeat
// itself. That is why the failure was deterministic rather than merely wrong.
test("#2127 the 60-of-61 state gets a hint at all — the state that produced four identical failures", () => {
  const fail = "invalid_file:run/common-law-findings.half-m.md:connotation_query_unrecorded:文科里 offensive meaning";
  const m = correctiveMessage(BASE, 2, fail, FILE);

  // THE CONTROL FIRST. Before this change these two assertions were both false, and the second is the
  // one that made the run unrecoverable: the seat was handed a refusal and nothing else.
  assert.ok(m.startsWith(BASE));
  assert.match(m, /CORRECTION:/, "the refusal must produce a correction at all");

  // The dropped queries ride in VERBATIM — a hint that says "some query is missing" is the refusal
  // reworded, and the seat still cannot act on it.
  assert.match(m, /文科里 offensive meaning/, "the hint must name which queries are missing");

  // And it must say the thing the seat could not otherwise know: an empty answer is still a receipt.
  assert.match(m, /empty results array/, "the hint must name the SHAPE that records a fruitless query");
  assert.match(m, /the search RAN/, "…and say what that shape means, or it reads as a formatting rule");
  assert.match(m, /Re-run ONLY the listed queries/,
    "…and bound the work, or a seat re-runs a 61-query sweep to add one row");
  assert.match(m, /leave every row already recorded exactly as it is/,
    "…and protect the 60 that are already right");
});

test("#2127 the zero-result state is not confused with the never-ran state", () => {
  // The validator CANNOT tell "ran, found nothing" from "never ran", and it is not being asked to —
  // fail-closed stays. What changed is that the seat is now told how to say the first one. So the
  // sibling token keeps its own, different hint: that one orders a sweep to be RUN, this one orders a
  // row to be RECORDED, and swapping them would tell a seat to redo work it has already done.
  const ranNothing = correctiveMessage(BASE, 2,
    "invalid_file:run/common-law-findings.half-m.md:connotation_query_unrecorded:X offensive meaning", FILE);
  const neverRan = correctiveMessage(BASE, 2,
    "invalid_file:run/common-law-findings.half-m.md:connotation_search_missing", FILE);

  assert.match(ranNothing, /empty results array/);
  assert.doesNotMatch(ranNothing, /Run the CONNOTATION \/ MEANING sweep/,
    "a run that recorded 60 of 61 must not be told to run the whole sweep again");

  assert.match(neverRan, /Run the CONNOTATION \/ MEANING sweep/);
  assert.doesNotMatch(neverRan, /Re-run ONLY the listed queries/,
    "and a run that recorded nothing has no list to re-run");
});

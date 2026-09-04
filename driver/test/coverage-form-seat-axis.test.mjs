// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// fix round — THE SEAT ROW'S AXIS: the one cell of the coverage form the seat still supplies.
//
// THE DEFECT, BOTH HALVES.
//
//   HALF 1 — the token threw away its own computed detail. `findCoverageFormViolations` computed
//   `axis "" is not one of saturation-probe / primary-sweep / transliteration-numeric / incumbent-class`
//   and `coverageFormFail` DISCARDED it, folding the cause into `coverage_no_status`. The hint's lead
//   fell back to "row(s) of your coverage form were refused" and its body ordered "Set status on every
//   row to EXACTLY one bare token of …" — while every row already carried a valid status — closing with
//   "Change nothing else in the file: the other fields are the driver's", which steers the seat AWAY
//   from the one field it has to fix. This repo has paid for that loop before: gateway.mjs's
//   `coverage_axis_invalid` arm records it — "the retry was told to redo the very derivation that
//   failed, so it looped until the attempts ran out … The validator's own message carries the allowed
//   list; quote it back."
//
//   HALF 2 — and this is why it was first-dispatch reachable, not a corner case. digest.md MANDATED
//   seat rows with no axis field and no axis convention, then asserted "You never author an axis token,
//   so an axis cell can no longer be wrong." Three of the four seat labels it named by example — the
//   per-jurisdiction reconciliation, the ⭐-floor sweep, the counted dominant-element crowd — normalise
//   to "" and were REFUSED. The skill taught a shape the gate refuses, by construction, on the first
//   dispatch. That is 's finding ("a fact obeyed as a failure and ignored as an input") recreated
//   one field over.
//
// THE GATE IS EXERCISED THROUGH THE UNION AND THE BYTES, NEVER OVER HAND-BUILT ROWS. verify.mjs judges
// the `_driver/` copy, which is what `unionCoverageForm` wrote and `writeCoverageForm` serialised — so a
// submitted row reaches the gate only after `seatRows` has run `normalizeAxis` over it. A test that
// handed `findCoverageFormViolations` a row it built itself would prove nothing about whether the shape
// the skill dictates survives ingest, which is the entire question here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { validators } from "../verify.mjs";
import { armCoverageForm, readCoverageFormInput, writeCoverageForm } from "../coverage-form-io.mjs";
import { unionCoverageForm } from "../coverage-union.mjs";
import { buildCoverageForm, formLedgerRows, coverageFormBrief, SEAT_ROW_CONTRACT } from "../coverage-form.mjs";
import { REGISTER_AXES, COVERAGE_FORM_NAME } from "../coverage-ledger.mjs";
import { correctionHint, warmEligible, warmPatchMessage, repairTarget } from "../gateway.mjs";
import { progressQuantity } from "../repairs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── THE FIXTURE ────────────────────────────────────────────────────────────────────────────────────
// A preserved-shape run dir with every mark, owner and qid replaced by invented tokens — this repo is
// de-identified by design and a fixture is code. One incomplete axis with one open crowd block is
// enough: what is under test is the SEAT row beside the driver rows, not the driver rows.
const FINDINGS = "# Register findings\n\n## Findings — Mark: LUMEN\n\nbody text long enough to pass the "
  + "non-empty floor, with a negative results matrix and an audit trail below it.\n\n### Negative results\n"
  + "| Mark | Variant | Result | Notes |\n|---|---|---|---|\n| LUMEN | exact | 0 hits | clean |\n";

function runDir() {
  const dir = mkdtempSync(join(tmpdir(), "cov-seat-axis-"));
  mkdirSync(driverDir(dir), { recursive: true });
  mkdirSync(join(dir, "register-units"), { recursive: true });
  writeFileSync(join(dir, "register-findings.md"), FINDINGS);
  writeFileSync(join(dir, "register-units", "primary-sweep.md"), "# unit\n");
  writeFileSync(driverDir(dir, "plan-execution.json"), JSON.stringify({
    skeleton: [{ axis: "primary-sweep", state: "incomplete", missing: [] }],
    deferred: [],
  }));
  writeFileSync(driverDir(dir, "register-plan.json"), JSON.stringify({
    entries: [{ qid: "ps:stack:lumen+form", axis: "primary-sweep", predicate: "exact",
      terms: ["LUMEN", "LUMENN"], nice_classes: ["9"], expected_kind: "enumerate" }],
  }));
  writeFileSync(join(dir, "register-units", "primary-sweep-band.json"), JSON.stringify([
    { state: "incomplete", qid: "ps:stack:lumen+form", total_hits: 6862,
      term_counts: { LUMEN: { disposition: "crowd" }, LUMENN: { disposition: "unenumerated" } } },
  ]));
  armCoverageForm(dir);
  return dir;
}
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });
const judge = (dir) => validators.registerFindings(
  join(dir, "register-findings.md"), readFileSync(join(dir, "register-findings.md"), "utf8"));

/** Every DRIVER row settled honestly, so the only thing the gate can still refuse is the seat row. */
const settledDriverRows = (input) => buildCoverageForm(input).rows.map((r) => ({
  ...r,
  status: r.open ? "coverage-limited" : "confirmed-clean",
  reason: "the band left this slice unaccounted; disclosed",
}));

/**
 * Submit seat rows and judge — the live path end to end: union → JSON bytes on disk → the validator.
 * `driverSettled: false` leaves the driver rows unset too, which is how a form carrying BOTH defects
 * at once is built.
 */
function submit(dir, seat, { driverSettled = true, prior = null } = {}) {
  const input = readCoverageFormInput(dir);
  const driver = driverSettled ? settledDriverRows(input) : buildCoverageForm(input).rows;
  const { form } = unionCoverageForm(prior, { rows: [...driver, ...seat] }, input);
  writeCoverageForm(dir, form);
  return { form, verdict: judge(dir) };
}

// ── HALF 2 — THE SEAT LABELS THE SKILL NAMES BY EXAMPLE (four until retired the ⭐-floor) ────
//
// The whole of Half 2 is this table, AND IT IS READ OUT OF THE SKILL rather than copied into this file.
// The defect was that digest.md taught a shape the gate refuses; a test carrying its own copy of the
// examples could pass forever while the skill drifted back. Parsing the skill means the two cannot
// disagree without CI saying so — the harness's property, applied to the harness itself.
const DIGEST_MD = readFileSync(join(HERE, "..", "skills", "prelim-register", "digest.md"), "utf8");
// ✕ THIS SLICE IS DUPLICATED — the identical two anchors live in skill-contract-enumerations.test.mjs's
// own `skillExamples`. Conversion 11 moved the closing anchor and BOTH copies had to move; the second
// was found only because the sweep ran the whole affected set, not because anything connects them. One
// predicate with two implementations is the shape that goes half-fixed, and this is it. Left as two with
// the duplication NAMED rather than refactored in a conversion PR — a shared helper is the right fix and
// it belongs in a change that is about these guards, not one that happens to break them.
const seatSection = () => {
  const from = DIGEST_MD.indexOf("You may ADD rows of your own");
  // Was `"### Audit trail"`, a heading that existed because the seat was shown the document it had to
  // type. The driver renders the audit trail now; this is the section that replaced it.
  const to = DIGEST_MD.indexOf("#### The audit trail and the status-filter summary are the DRIVER's");
  assert.ok(from > 0 && to > from,
    "the seat-row section is not where it is expected — one of its two anchors moved. Re-point it at the "
    + "section that now FOLLOWS the worked example (and check the twin copy in "
    + "skill-contract-enumerations.test.mjs); do NOT widen the slice to the end of the file.");
  return DIGEST_MD.slice(from, to);
};
/** The worked-example table's (axis, unit) pairs, exactly as a compliant seat would read them. */
function skillExamples() {
  const out = [];
  for (const line of seatSection().split("\n")) {
    if (!line.startsWith("|") || /^\|\s*-+/.test(line) || /`/.test(line) === false) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    const axis = [...cells[1].matchAll(/`([^`]+)`/g)].pop()?.[1];   // "that unit's own axis, e.g. `x`"
    const unit = cells[2].match(/`([^`]+)`/)?.[1];
    if (axis && unit) out.push({ what: cells[0], axis, unit });
  }
  return out;
}
const SKILL_EXAMPLES = skillExamples();

test("HALF 2 — the skill's worked examples are THREE, and every axis it teaches is in the vocabulary", () => {
  // digest.md named FOUR until #1203: the per-jurisdiction reconciliation, the ⭐-floor sweep, the
  // cross-class merch check, the counted dominant-element crowd. Three of the four were refused when this
  // was written. The ⭐-floor sweep's row is GONE with the mechanism — a worked example teaching a seat to
  // author a shape whose marker no code reads is an invitation to type a character into free text and
  // believe something enforces it. Counted, not `>= 1`, so the table shrinking again is a decision.
  assert.equal(SKILL_EXAMPLES.length, 3, "all three shapes the skill names carry a worked axis and unit");
  for (const ex of SKILL_EXAMPLES) {
    assert.ok(REGISTER_AXES.includes(ex.axis), `"${ex.what}" is taught with a real axis (${ex.axis})`);
    assert.ok(ex.unit.startsWith(`${ex.axis} /`), `"${ex.what}"'s unit label leads with its own axis`);
  }
});

test("HALF 2 — every seat-row example the skill names is ACCEPTED, run one by one through the gate", () => {
  for (const ex of SKILL_EXAMPLES) {
    const dir = runDir();
    try {
      const { form, verdict } = submit(dir, [{ kind: "seat", axis: ex.axis, unit: ex.unit,
        status: "coverage-limited", reason: "the slice is disclosed and stays open" }]);
      assert.equal(verdict.ok, true, `${ex.what} must pass the gate as the skill dictates it (${verdict.reason})`);
      const mine = form.rows.find((r) => r.unit === ex.unit);
      assert.ok(mine, `${ex.what} survives the union as its own row`);
      assert.equal(mine.kind, "seat");
      assert.equal(mine.axis, ex.axis, `${ex.what} keeps the axis it filed itself under`);
      assert.ok(formLedgerRows(form.rows).some((r) => r.unit === ex.unit && r.axis === ex.axis),
        `${ex.what} reaches the coverage ledger every consumer downstream reads`);
    } finally { cleanup(dir); }
  }
});

test("HALF 2 — all three together, and the gate refuses none of them", () => {
  const dir = runDir();
  try {
    const { form, verdict } = submit(dir, SKILL_EXAMPLES.map((ex) => ({ kind: "seat", axis: ex.axis,
      unit: ex.unit, status: "confirmed-clean", reason: "swept and clear" })));
    assert.equal(verdict.ok, true, verdict.reason);
    assert.equal(form.rows.filter((r) => r.kind === "seat").length, 3, "three distinct seat rows, none collapsed");
  } finally { cleanup(dir); }
});

test("HALF 2 — the dictated unit label recovers the axis when a re-emit drops the cell", () => {
  // Belt and braces, and the reason the dictated unit is `<axis> / <what you swept>`: `seatRows` runs
  // normalizeAxis(r.axis, r.unit), which scans the whole label. This is repair of a LOST field, never
  // invention of a missing one — the unknown-label case below still fails.
  for (const ex of SKILL_EXAMPLES) {
    const dir = runDir();
    try {
      const { verdict } = submit(dir, [{ kind: "seat", unit: ex.unit, status: "coverage-limited", reason: "r" }]);
      assert.equal(verdict.ok, true, `${ex.unit} recovers its axis from the label (${verdict.reason})`);
    } finally { cleanup(dir); }
  }
});

test("HALF 2 — THE PRE-FIX SHAPE IS EXACTLY WHAT WAS REFUSED, and it still is", () => {
  // The bare labels digest.md used to name, with no axis field and no axis prefix — what a compliant
  // seat wrote on the first dispatch. Three of the four were refused. This pins the defect so nobody
  // restores the old wording believing it was harmless.
  for (const unit of ["the per-jurisdiction reconciliation", "⭐-floor sweep", "counted dominant-element crowd"]) {
    const dir = runDir();
    try {
      const { verdict } = submit(dir, [{ kind: "seat", unit, status: "coverage-limited", reason: "r" }]);
      assert.equal(verdict.ok, false, `"${unit}" with no axis is refused`);
      assert.match(verdict.reason, /coverage_form_axis_invalid:axis_invalid=1;/);
    } finally { cleanup(dir); }
  }
  // The fourth hit normalizeAxis's cross-class backstop and passed — which is how three of four came to
  // be a silent, uneven trap rather than an obvious one.
  const dir = runDir();
  try {
    assert.equal(submit(dir, [{ kind: "seat", unit: "cross-class merch check",
      status: "coverage-limited", reason: "r" }]).verdict.ok, true);
  } finally { cleanup(dir); }
});

test("HALF 2 — a genuinely unknown axis is still refused; nothing here invents one", () => {
  const dir = runDir();
  try {
    const { verdict } = submit(dir, [{ kind: "seat", axis: "made-up-axis", unit: "made-up-axis / x",
      status: "confirmed-clean", reason: "r" }]);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /coverage_form_axis_invalid:axis_invalid=1;/);
    assert.match(verdict.reason, /axis=made-up-axis/);
  } finally { cleanup(dir); }
});

// ── HALF 2 — THE ALLOWED SET IS ON EVERY SURFACE THE SEAT READS ────────────────────────────────────

test("the FORM ITSELF carries the allowed axis set — on the pre-dispatch build AND on every union pass", () => {
  // A value a model must supply and is never shown is 's defect. The form is the file the seat has
  // open, so it is the surface that matters most — and it has to survive the union, because from pass 2
  // onwards the union's output is what writeCoverageForm puts in BOTH copies.
  const dir = runDir();
  try {
    const input = readCoverageFormInput(dir);
    for (const [name, form] of [["build", buildCoverageForm(input)],
      ["union", unionCoverageForm(null, null, input).form]]) {
      assert.ok(form.seat_row_contract, `${name} carries seat_row_contract`);
      assert.deepEqual(form.seat_row_contract.axis, REGISTER_AXES, `${name} carries the axis set verbatim`);
      assert.match(form.seat_row_contract.axis_rule, /CLOSED/);
      assert.match(form._provenance, /seat_row_contract/, `${name}'s provenance points at it`);
    }
    assert.deepEqual(SEAT_ROW_CONTRACT.status, ["confirmed-clean", "coverage-limited", "deferred"]);
  } finally { cleanup(dir); }
});

test("seat_row_contract survives the bytes and is never mistaken for a row", () => {
  const dir = runDir();
  try {
    const input = readCoverageFormInput(dir);
    const { form } = unionCoverageForm(null, { rows: settledDriverRows(input) }, input);
    writeCoverageForm(dir, form);
    // Typed transport: the accumulator in _driver/ is the ONE copy on disk (the seat-facing mirror is
    // dead), so the bytes judged here are the bytes the gate reads.
    const onDisk = JSON.parse(readFileSync(driverDir(dir, `${COVERAGE_FORM_NAME.replace(/\.json$/, "")}.form.json`), "utf8"));
    assert.deepEqual(onDisk.seat_row_contract.axis, REGISTER_AXES, "the accumulator carries it");
    assert.ok(!onDisk.rows.some((r) => r.kind === "seat"), "and it is a top-level key, never parsed as a row");
    assert.equal(judge(dir).ok, true, "a form carrying the contract still passes — it is inert to the gate");
  } finally { cleanup(dir); }
});

test("the DISPATCH BRIEF names the seat-row shape and quotes the axis set", () => {
  const dir = runDir();
  try {
    const brief = coverageFormBrief(buildCoverageForm(readCoverageFormInput(dir)), `/run/${COVERAGE_FORM_NAME}`);
    assert.match(brief, /ADD ROWS OF YOUR OWN/);
    assert.ok(brief.includes(REGISTER_AXES.join(" / ")),
      `the brief quotes the allowed set verbatim, as a set: ${REGISTER_AXES.join(" / ")}`);
    assert.match(brief, /CLOSED/);
    assert.match(brief, /<axis> \/ <what you swept>/, "the unit convention is dictated, not implied");
  } finally { cleanup(dir); }
});

test("THE SKILL carries the allowed axis tokens verbatim, and no longer asserts the axis cannot be wrong", () => {
  // again: the skill is where the seat learns the shape, and a closed vocabulary stated nowhere it
  // reads is a value it is asked to guess. This is what keeps the skill and the code from drifting.
  const section = seatSection();
  for (const ax of REGISTER_AXES) {
    assert.ok(section.includes(ax), `digest.md's seat-row section names ${ax} verbatim`);
  }
  assert.match(section, /CLOSED/);
  assert.match(section, /<the same axis> \/ <what you swept>/, "the unit convention is dictated");
  assert.ok(!DIGEST_MD.includes("You never author an axis token"),
    "the false assertion is gone — a seat row's axis IS authored by the seat");
});

// ── HALF 1 — THE TOKEN CARRIES WHAT THE VALIDATOR COMPUTED ─────────────────────────────────────────

test("HALF 1 — the fail TOKEN names the rejected value and keeps the #460 token grammar", () => {
  const dir = runDir();
  try {
    const { verdict } = submit(dir, [{ kind: "seat", unit: "per-jurisdiction reconciliation",
      status: "coverage-limited", reason: "r" }]);
    const tok = verdict.reason.slice(verdict.reason.indexOf("coverage_form_axis_invalid"));
    assert.match(tok, /^coverage_form_axis_invalid:axis_invalid=1;/, "census FRONT-LOADED (#246)");
    assert.match(tok, /axis=<empty>/, "the rejected value is named — an absent cell is the COMMON shape");
    assert.match(tok, /per-jurisdiction reconciliation/, "and the row is findable without opening anything");
    assert.equal(verdict.quantity, 1, "the validator's own integer rides along and wins over any text parse");
    // no parenthesis before the overflow: pipeline's merge-gate remedy matches `coverage_[^)]*` and
    // truncates the payload at the first "(".
    assert.ok(!tok.replace(/ \(\+\d+ more\)$/, "").includes("("), "no parentheses before the overflow");
    assert.equal(tok.split(";").length, 2, "one semicolon — census, then entries");
    // THE SEAM BETWEEN THE TWO HALVES OF HALF 1. Every other hint test drives off a literal token
    // string, so a validator emitting a payload the arm's regex cannot parse would leave them all
    // green while the seat got a hint naming no row at all. Feed the LIVE token to the LIVE arm.
    const h = correctionHint(verdict.reason);
    assert.match(h, /axis=<empty>/, "the rejected value survives the token → hint join");
    assert.match(h, /per-jurisdiction reconciliation/, "and so does the row the seat has to find");
    assert.ok(h.includes(REGISTER_AXES.join(" / ")), "and the hint still quotes the allowed set");
  } finally { cleanup(dir); }
});

test("HALF 1 — the two tokens PARTITION: an axis defect never rides in the status census", () => {
  // A form carrying BOTH defects. The axis token fires first and its census counts ONLY axis rows. If
  // the two shared a token the seat would get a flat list it cannot attribute, because the entry list
  // carries no per-entry cause — which is the reason there are two tokens and not one.
  const dir = runDir();
  try {
    const { verdict } = submit(dir, [{ kind: "seat", unit: "per-jurisdiction reconciliation",
      status: "coverage-limited", reason: "r" }], { driverSettled: false });
    assert.match(verdict.reason, /coverage_form_axis_invalid:axis_invalid=1;/);
    assert.ok(!verdict.reason.includes("no_status="), "the status cause never rides in the axis census");
    assert.equal(verdict.quantity, 1, "and the quantity counts the axis rows only");
  } finally { cleanup(dir); }
});

test("HALF 1 — with the axis fixed, the status token fires with its own census and no axis term", () => {
  const dir = runDir();
  try {
    const { verdict } = submit(dir, [{ kind: "seat", axis: "primary-sweep",
      unit: "primary-sweep / CH reconciliation", status: "coverage-limited", reason: "r" }],
    { driverSettled: false });
    assert.match(verdict.reason, /coverage_no_status:/);
    assert.ok(!verdict.reason.includes("axis_invalid"), "axis_invalid has left this census for good");
  } finally { cleanup(dir); }
});

// ── HALF 1 — THE HINT ──────────────────────────────────────────────────────────────────────────────

const AXIS_TOKEN = `invalid_file:prelim-search/tmp9004-mark/run/register-findings.md:`
  + `coverage_form_axis_invalid:axis_invalid=2;CS-A1B2 [axis=<empty> per-jurisdiction reconciliation],`
  + `CS-C3D4 [axis=ch-material ch-material / merch]`;

test("HALF 1 — the hint NAMES THE FIELD and QUOTES THE ALLOWED SET", () => {
  const h = correctionHint(AXIS_TOKEN);
  assert.match(h, /"axis"/, "it names the cell that is wrong");
  // THE SET, AS A SET — not four tokens that happen to appear in the attribution guidance further down.
  // A hint that names them only as examples leaves the seat to work out that the list is exhaustive,
  // which is the "redo the derivation that failed" loop the 2026-07-30 arm exists to end.
  assert.ok(h.includes(REGISTER_AXES.join(" / ")),
    `the hint quotes the allowed set verbatim: ${REGISTER_AXES.join(" / ")}`);
  assert.match(h, /CLOSED/);
  assert.match(h, /axis=<empty>/, "and explains what the rejected value in the token means");
  assert.match(h, /CS-A1B2/, "the rows ride through, so the repair needs nothing else opened");
});

test("HALF 1 — the hint NEVER orders work already done", () => {
  // The whole defect. Every row in this form already carries a valid status; a hint that says "set
  // status on every row" and "change nothing else, the other fields are the driver's" burns the warm
  // attempt on an instruction already complied with, and steers away from the one field to fix.
  const h = correctionHint(AXIS_TOKEN);
  assert.ok(!/Set "status" on every row/i.test(h), "it does not re-order the statuses");
  assert.ok(!/were refused\b/.test(h), "the contentless lead is gone");
  assert.ok(!/Change nothing else in the file/i.test(h), "and it does not steer away from the axis field");
  // Typed transport: the repair is a record_coverage RE-SEND of exactly the named seat rows — the
  // recorded statuses stand, and the hint says so instead of ordering a file edit.
  assert.match(h, /Re-send each of those rows through the `record_coverage` tool/);
  assert.match(h, /every "status" and "reason" already recorded is kept/);
});

test("HALF 1 — the axis hint is not the derived-JSON hint, and the derived-JSON hint is untouched", () => {
  // `coverage_axis_invalid` is TAKEN. Its arm aims at register-coverage-ledger.json — a driver-derived
  // artifact the seat is told never to write — so reusing the name would have misrouted the repair.
  const mine = correctionHint(AXIS_TOKEN);
  assert.ok(!mine.includes("register-coverage-ledger.json"), "the form hint never names the derived mirror");
  const theirs = correctionHint("invalid_file:x/register-findings.md:coverage_axis_invalid:digest (not in: primary-sweep)");
  assert.match(theirs, /register-coverage-ledger\.json is a JSON ARRAY/, "the prose-era arm still answers its own token");
});

// ── HALF 1 — ROUTING, WARM, AND THE CONVERGENCE LEDGER ─────────────────────────────────────────────

test("the repair grades at the stage's own output — no coverage file is a target any more", () => {
  // Typed transport (B's rule): the seat writes no coverage file, so there is no sibling a repair could
  // aim at. warmPatchMessage's coverage branch orders the record_coverage call BEFORE repairTarget is
  // ever consulted; the graded artifact falls back to the stage's own .md — and it must never be the
  // derived mirror, which is a driver-rendered file the seat is told not to write.
  const dg = "/r/prelim-search/tmp9004-mark/run/register-findings.md";
  assert.equal(repairTarget(AXIS_TOKEN, [dg]), dg);
  assert.ok(!repairTarget(AXIS_TOKEN, [dg]).includes("register-coverage-ledger.json"));
});

test("the token is WARM-eligible — one cell, on a file the resumed session can already see", () => {
  // A seat that must edit one field it CAN see should not be paying for a cold re-dispatch that re-reads
  // a 1.9 MB band and re-derives a 160 KB document. It also cannot mean "the search did not happen": the
  // offending rows are SEAT rows, on top of a driver form whose existence is proof the plan ran.
  assert.equal(warmEligible(AXIS_TOKEN, { status: "ok" }), true);
  assert.equal(warmEligible(AXIS_TOKEN, { status: "error" }), false, "a broken turn is still not warmable");
});

test("the warm patch message closes on the NAMED SEAT ROWS, not on 'record every row'", () => {
  const dg = "/r/prelim-search/tmp9004-mark/run/register-findings.md";
  const m = warmPatchMessage(AXIS_TOKEN, [dg]);
  assert.match(m, /record_coverage/, "it names the TOOL — the seat holds no pen on any coverage file");
  assert.ok(!m.includes(COVERAGE_FORM_NAME), "and never a coverage file — there is none the seat can affect");
  assert.match(m, /Re-send ONLY the seat row\(s\) the correction names/);
  assert.ok(!/nothing outstanding/.test(m),
    "the record-everything close is the wrong order here — every row already carries a status");
  // and the status token keeps its own close, aimed at the tool's outstanding list
  const s = warmPatchMessage("invalid_file:x/register-findings.md:coverage_no_status:open_clean=1;CS-1 [x]", [dg]);
  assert.match(s, /Do not stop until the tool's answer reports nothing outstanding/);
});

test("the convergence ledger can read the new token — a converging run never reads as stuck", () => {
  //. With no entry in repairs.mjs PROGRESS_TOKENS, progressQuantity returns null, `progress.kind`
  // becomes "unknown", and 2 → 1 → 0 looks like no progress at all.
  assert.deepEqual(progressQuantity(AXIS_TOKEN), { token: "coverage_form_axis_invalid", value: 2 });
});

test("the token is NOT mirror-quarantined — the name was chosen so it cannot be", () => {
  // pipeline.mjs isCoverageLedgerFail is /coverage_(ledger|axis|key|mirror|status|classes)_/ and it
  // MIRROR-QUARANTINES what it matches: the run proceeds with the machine ledger dropped and a note
  // saying the coverage gates read the prose — over a judgment the seat has not made. A token named
  // `coverage_axis_offvocab` WOULD have matched it. This one cannot, and that is why it is spelled with
  // `form` first.
  const isCoverageLedgerFail = /invalid_file:[^:]*:coverage_(ledger|axis|key|mirror|status|classes)_/;
  assert.ok(!isCoverageLedgerFail.test(AXIS_TOKEN),
    "a refused form judgment must never be swallowed by the derived-mirror quarantine");
});

// ── THE ACCUMULATOR ────────────────────────────────────────────────────────────────────────────────

test("fixing the axis does not cost the row its status — the corrected row keeps its judgment", () => {
  // A seat row's key is `seat:<axis>:<unit>`, so correcting the axis RE-KEYS the row. If the union lost
  // the status on that re-key, the hint would be ordering a repair that destroys the work it preserves.
  const dir = runDir();
  try {
    const bad = { kind: "seat", unit: "per-jurisdiction reconciliation", status: "coverage-limited",
      reason: "CH could not be fully reconciled" };
    const first = submit(dir, [bad]);
    assert.equal(first.verdict.ok, false, "attempt 1 is refused on the axis");
    const second = submit(dir, [{ ...bad, axis: "primary-sweep", unit: "primary-sweep / CH reconciliation" }],
      { prior: first.form });
    assert.equal(second.verdict.ok, true, `attempt 2 passes (${second.verdict.reason})`);
    const seatNow = second.form.rows.filter((r) => r.kind === "seat");
    assert.equal(seatNow.length, 1, "the corrected row REPLACES the bad one — no duplicate ledger line");
    assert.equal(seatNow[0].reason, "CH could not be fully reconciled", "and the judgment survived the re-key");
  } finally { cleanup(dir); }
});

test("a submission that says NOTHING inherits the prior seat rows, bad axis included", () => {
  // The other leg of the union's seat-row rule. A cold turn that wrote nothing must not drop a refused
  // row into a pass: the defect is still there, so the gate must still see it.
  const dir = runDir();
  try {
    const first = submit(dir, [{ kind: "seat", unit: "per-jurisdiction reconciliation",
      status: "coverage-limited", reason: "r" }]);
    const input = readCoverageFormInput(dir);
    const { form } = unionCoverageForm(first.form, null, input);
    writeCoverageForm(dir, form);
    const v = judge(dir);
    assert.equal(v.ok, false);
    assert.match(v.reason, /coverage_form_axis_invalid:axis_invalid=1;/);
  } finally { cleanup(dir); }
});

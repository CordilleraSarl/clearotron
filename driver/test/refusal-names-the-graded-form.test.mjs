// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// / — THE REFUSAL NAMES THE ARTIFACT IT GRADED, AND THE RECORD CARRIES THAT ARTIFACT'S SHA.
//
// From a delivered run in the 2026-08-10 acceptance round. The meaning seat was refused four times
// and the token read:
//
//   invalid_file:…/common-law-findings.half-m.md:connotation_form_untouched:form_untouched=79
//
// `common-law-findings.half-m.md` is 3,027 bytes and 46 lines and holds no rows. The 79 rows are in
// `common-law-dispositions.half-m.json` (123,885 bytes), which the message never named. Every
// investigation of a meaning-seat failure this program has run was reading a file that is not the one
// being graded.
//
// The per-attempt record was worse: `output` is the stage's declared out file, so three refusals AND the
// acceptance all carried one identical sha. An operator could not tell a retry that filled forty rows
// from one that touched nothing, and anything keying on that sha to detect a futile retry was watching a
// file the seat barely writes.
//
// TWO PROPERTIES, AND THE SECOND IS WHY THIS IS ONE DERIVATION AND NOT A NEW TABLE:
//   1. the `invalid_file:` path names the graded artifact;
//   2. a token with NO sibling branch mints the byte-identical string it minted before. `identicalContent`
//      breaks a ladder by comparing two fail strings, so a path that wobbled would read as progress.
//
// BREAK MATRIX — eight breaks, each applied, run and reverted; every one red:
//   B1  gradedArtifact always returns the declared output        9 red
//   B2  gradedArtifact drops the `?? output` fallback            7 red   (the equality property)
//   B3  the attempt row records no form                          1 red
//   B4  the form field echoes the declared output                2 red
//   B5  `graded` is recorded even when it IS the output          1 red   (arm 11)
//   B6  the connotation family routes back to the prose file     7 red
//   B7  `file:` moves to the graded artifact                     1 red   (arm 9, via best-draft)
//   B8  lastGraded is not carried across attempts                1 red   (arm 6's passing attempt)
//
// B4's first cut was a BAD BREAK, not a bad test: the substring it patched also matched the repair
// turn's row two hundred lines earlier, so it edited a record arm 6 never exercises and reported green.
// Re-anchored on the following line and it reddens.
//
// B (the typed disposition transport, delete-not-gate): the CONNOTATION family left the sibling table —
// the seat writes no dispositions file, so there is no graded sibling and the family grades at the
// stage's own output again, exactly as it did before. The sibling-grading property this file pins
// lives on in the coverage form, which is still a driver-written file a seat fills — the gateway arms
// (6/7/9) drive that shape now.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "graded-locks-"));
process.env.CLEAROTRON_RETRY_BACKOFF_MS = "10";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const { runStage, gradedArtifact, repairTarget, requiredFileClause } = await import("../gateway.mjs");
const { CONNOTATION_FORM_REASONS } = await import("../connotation-search.mjs");

const MD = "/r/prelim-search/x/common-law-findings.half-m.md";
const FORM = "/r/prelim-search/x/common-law-dispositions.half-m.json";

// ── 1. the meaning seat: every clause of the split names the form ────────────────────────────────────

test("arm 1 — B: the connotation family grades at the stage's own output — there is no seat file to name", () => {
  // The reasons are read from the module's own exported list, so a new member added later is covered
  // here the day it is added. Naming ANY file would misdirect: the seat's remedy is a
  // `record_dispositions` call, and the one artifact a refusal may name to a seat is its own output —
  // never the `_driver/` accumulator, which the seat must not be told about (the era-stamp argument).
  assert.ok(CONNOTATION_FORM_REASONS.length >= 4, "the family exists");
  for (const reason of CONNOTATION_FORM_REASONS) {
    assert.equal(gradedArtifact(`connotation_${reason}:${reason}=79`, MD), MD,
      `connotation_${reason} must grade at the stage's own output — a sibling name would aim the seat at a file it cannot affect`);
  }
  assert.equal(gradedArtifact("connotation_call_partial:call_partial=3", "/r/prelim-search/x/common-law-findings.half-a.md"),
    "/r/prelim-search/x/common-law-findings.half-a.md", "…for every member, half or canonical");
});

test("arm 3 — the coverage family grades at the stage's own output; the ledger is still told apart", () => {
  // The typed coverage transport (B's rule, one lane over): the seat writes no coverage file, so there
  // is no graded sibling and a form-family refusal names the stage's own output — the remedy is a
  // `record_coverage` call, and the one artifact a refusal may name to a seat is its own output, never
  // the `_driver/` accumulator (the era-stamp argument, exactly as arm 1 states it for dispositions).
  const dg = "/r/prelim-search/x/register-findings.md";
  for (const reason of ["coverage_no_status:no_status=3", "coverage_form_damaged:form_damaged=1",
    "coverage_form_axis_invalid:CS-1 [axis=<empty>]", "coverage_form_engine_vocabulary:CS-2"]) {
    assert.equal(gradedArtifact(reason, dg), dg,
      `${reason} must grade at the stage's own output — a sibling name would aim the seat at a file it cannot affect`);
  }
  assert.equal(basename(gradedArtifact("coverage_axis_invalid:all axes", dg)), "register-coverage-ledger.json",
    "a LEDGER defect still names the ledger — a driver-derived artifact with its own author");
});

// ── 4. the equality property: nothing else moves ─────────────────────────────────────────────────────

test("arm 4 — a token with no sibling branch returns the stage's own output, unchanged", () => {
  // This is what keeps `identicalContent` honest: two attempts failing the same way must still produce
  // two byte-identical strings.
  for (const reason of ["coverage_status_offenum:N/A", "platforms_missing:etsy", "knockout_url_unreceipted",
    "intake_ask_unanswered", "use_check_missing"]) {
    assert.equal(gradedArtifact(reason, MD), MD, `${reason} is not sibling-routed and must not move`);
  }
  assert.equal(gradedArtifact("anything", ""), "", "no expectFile ⇒ nothing to name");
  assert.equal(gradedArtifact("anything", null), "", "…and null is not a crash");
});

test("arm 5 — gradedArtifact and repairTarget agree, because they are one derivation", () => {
  // If these ever disagree the seat is told to patch one file while the operator reads about another —
  // the two-halves-disagreeing shape closed for the meaning sweep.
  for (const [reason, out] of [
    ["connotation_call_partial:call_partial=79", MD],
    ["connotation_cite_absent:cite_absent=36", MD],
    ["coverage_no_status:no_status=3", "/r/prelim-search/x/register-findings.md"],
    ["coverage_axis_invalid:all axes", "/r/prelim-search/x/register-findings.md"],
    ["framediff_severity_invalid:major", "/r/prelim-search/x/frame-diff.md"],
  ]) {
    assert.equal(gradedArtifact(reason, out), repairTarget(`invalid_file:x/${basename(out)}:${reason}`, [out]),
      `${reason}: the file the operator reads about is the file the repair writes`);
  }
});

// ── 6/7. through the gateway, on a stage whose validator grades a sibling ─────────────────────────────

let dir;
beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "graded-form-"));
  process.env.MOCK_CLAUDE_CALL_LOG = join(dir, "calls.jsonl");
  process.env.MOCK_COUNT_FILE = join(dir, "count");
  process.env.MOCK_WARM_MODE = "form";
  delete process.env.MOCK_FORM_STEPS;
  delete process.env.MOCK_FORM_SIBLING;
  delete process.env.CLEAROTRON_FORM_REPAIR;
  delete process.env.CLEAROTRON_WARM_RETRY;
});

const stageRows = () => readFileSync(driverDir(dir, "test-stage.jsonl"), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

// A stage in production's shape: the out file is prose, the validator reads a JSON sibling off disk and
// counts its unruled rows. A test that put the defect in the expectFile would collapse the very
// relationship this issue is about. B moved the meaning sweep off the sibling model, and the typed
// coverage transport then moved the coverage form off it too — the model-written sibling that still
// exists is the MACHINE FINDINGS (findings.json, sibling-routed by the `finding_` family), so the
// fixture drives that shape.
const SIB = "findings.json";
const formWith = (ruled) => JSON.stringify({
  findings: [0, 1, 2].map((i) => ({ ordinal: i + 1, use_check: i < ruled ? { source: "checked" } : { source: "" } })),
}, null, 2);

function siblingStage() {
  const out = join(dir, "register-findings.md");
  return {
    expectFile: out,
    validate: (p) => {
      let findings;
      try { findings = JSON.parse(readFileSync(join(dirname(p), SIB), "utf8")).findings; }
      catch { return { ok: false, reason: "finding_use_check_source_missing:unparseable" }; }
      const missing = findings.filter((f) => !f.use_check?.source).length;
      return missing
        ? { ok: false, reason: `finding_use_check_source_missing:${missing}`, quantity: missing }
        : { ok: true };
    },
  };
}

test("arm 6 — the attempt row carries the FORM's sha, and two attempts that moved it record two", async () => {
  const s = siblingStage();
  process.env.MOCK_OUT_FILE = s.expectFile;
  process.env.MOCK_FORM_SIBLING = join(dir, SIB);
  process.env.MOCK_FORM_STEPS = JSON.stringify([formWith(1), formWith(3)]);
  const r = await runStage("test-stage", {
    agent: "clawdi", message: "BASE TASK", sessionKey: "prelim-graded-1",
    timeoutSec: 30, maxRetries: 2, runDir: dir, expectFile: s.expectFile, validate: s.validate,
  });
  assert.equal(r.ok, true, "attempt 2 rules every row");
  const attempts = stageRows().filter((x) => x.attempt && x.output);
  assert.ok(attempts.length >= 2, "two attempts were recorded");
  const outShas = new Set(attempts.map((a) => a.output?.sha));
  assert.equal(outShas.size, 1, "THE DEFECT: the declared output is one file the seat wrote once");
  const formShas = attempts.map((a) => a.form?.sha);
  assert.ok(formShas.every(Boolean), `every attempt row carries the form's sha (got ${JSON.stringify(formShas)})`);
  assert.equal(new Set(formShas).size, 2, "the two attempts moved the form and the record says so");
  assert.equal(attempts[0].form.name, SIB, "…and names it");
  // (Until B this arm drove the DISPOSITION form, then the coverage form; both now ride typed calls
  // and own no graded sibling, so the machine findings carry the property.)
});

test("arm 7 — the refusal the seat is handed names the form", async () => {
  const s = siblingStage();
  process.env.MOCK_OUT_FILE = s.expectFile;
  process.env.MOCK_FORM_SIBLING = join(dir, SIB);
  process.env.MOCK_FORM_STEPS = JSON.stringify([formWith(0), formWith(0), formWith(0)]);
  const r = await runStage("test-stage", {
    agent: "clawdi", message: "BASE TASK", sessionKey: "prelim-graded-2",
    timeoutSec: 30, maxRetries: 2, runDir: dir, expectFile: s.expectFile, validate: s.validate,
  });
  assert.equal(r.ok, false);
  assert.match(r.fail, /findings\.json:finding_use_check_source_missing/,
    "THE DEFECT: the token named the prose file and counted the sibling's rows");
  assert.ok(!/register-findings\.md:finding_use_check_source_missing/.test(r.fail),
    "the prose file is no longer named by a sibling refusal");
});

test("arm 8 — the quarantine lane still recognises a finding token after the substitution", () => {
  // quarantineSynth (pipeline.mjs) gates on the SHAPE of this string: `^invalid_file:` and `:finding_[a-z]`
  // and NOT `:findings_`. `finding_` is sibling-routed to findings.json, so the path moves — and a run
  // that lost this gate would fail whole clearances that used to salvage.
  const narrative = "/r/prelim-search/x/report.md";
  const graded = gradedArtifact("finding_meter_token_invalid:goods_proximity:unknown", narrative);
  assert.equal(basename(graded), "findings.json", "a finding-shape defect is in findings.json, not the prose");
  const fail = `invalid_file:x/${basename(graded)}:finding_meter_token_invalid:goods_proximity:unknown`;
  const eligible = /^invalid_file:/.test(fail) && /:finding_[a-z]/.test(fail) && !/:findings_/.test(fail);
  assert.equal(eligible, true, "the lenient-salvage lane still fires");
  // and the warm allowlist, which parses the path as `[^:]*`
  assert.match(fail, /^invalid_file:[^:]*:finding/, "the path carries no colon, so the allowlist still matches");
});

test("arm 9 — the repair anchor did NOT move: `file` is still the stage's own output", async () => {
  // The fail STRING names the graded artifact; `file` — the value the draft carry and the write-time
  // repair both anchor on — stays the DECLARED output. Read off best-draft's own score.json, because
  // that is the one place `failingFile` leaves a trace: aim it at the sibling and the run preserves the
  // wrong artifact as the draft the next dispatch continues from.
  const s = siblingStage();
  process.env.MOCK_OUT_FILE = s.expectFile;
  process.env.MOCK_FORM_SIBLING = join(dir, SIB);
  process.env.MOCK_FORM_STEPS = JSON.stringify([formWith(1), formWith(2), formWith(3)]);
  await runStage("test-stage", {
    agent: "clawdi", message: "BASE TASK", sessionKey: "prelim-graded-3",
    timeoutSec: 30, maxRetries: 2, runDir: dir, expectFile: s.expectFile, validate: s.validate,
  });
  const rows = stageRows().filter((x) => x.attempt);
  assert.ok(rows.some((x) => x.output?.name === "register-findings.md"),
    "`output` keeps its meaning — the declared artifact, unchanged");
  const score = JSON.parse(readFileSync(driverDir(dir, "best-draft", "test-stage", "score.json"), "utf8"));
  assert.equal(score.file, "register-findings.md",
    "the best draft preserved the stage's own output, which is what `file` anchors");
  assert.match(score.fail, /findings\.json:/,
    "…while the score's own record of WHY names the graded artifact");
});

test("arm 11 — a stage that owns no form records none, rather than echoing its own output", async () => {
  // `form` must mean "the sibling artifact this stage is graded on". A stage with no such artifact has
  // to record nothing: a field that silently repeats `output` would read as a form on every stage in the
  // run and make the ones that DO have a form indistinguishable.
  const out = join(dir, "plain.md");
  process.env.MOCK_OUT_FILE = out;
  delete process.env.MOCK_FORM_SIBLING;
  process.env.MOCK_FORM_STEPS = JSON.stringify(["still wrong", "still wrong", "still wrong"]);
  const r = await runStage("test-stage", {
    agent: "clawdi", message: "BASE TASK", sessionKey: "prelim-graded-4",
    timeoutSec: 30, maxRetries: 1, runDir: dir, expectFile: out,
    validate: () => ({ ok: false, reason: "platforms_missing:etsy" }),
  });
  assert.equal(r.ok, false);
  assert.match(r.fail, /plain\.md:platforms_missing/, "the path is the stage's own output, unchanged");
  for (const row of stageRows().filter((x) => x.attempt)) {
    assert.equal(row.form, undefined, "no form artifact ⇒ no form field");
  }
});

test("arm 10 — the connotation family has NO name source left — deleting it may not leave a stump", () => {
  // dispositionFormNameFor died with the seat-facing form. A revenant naming rule would quietly re-aim
  // repairs at a file nobody writes, so its absence is pinned along with the fallback it leaves behind.
  assert.equal(basename(gradedArtifact("connotation_form_damaged", MD)), basename(MD));
});


// ── → B: the LAST sentence now has ONE name for every token ─────────────────────────────────────
//
// 's two-file clause existed because the hint disqualified the write-up while this clause re-ordered
// it — two halves of one message contradicting each other about which FILE to finish. B deleted the
// second file: rulings ride `record_dispositions`, the stage output is the only file the seat owes, and
// re-adding a second name here would re-open the exact contradiction measured.

const FINDINGS_M = "prelim-search/tmp8729-sample/2026-01-01-specimen/common-law-findings.half-m.md";

test("B: every token — the connotation family included — keeps ONE required-file sentence", () => {
  for (const t of ["grid_join_missing", "coverage_ledger_empty", "named_band_state_invalid", "findings_use_check_missing",
    "connotation_call_never_made:call_never_made=74", "connotation_call_partial:call_partial=3", "connotation_quote_unbound:quote_unbound=1"]) {
    const clause = requiredFileClause(t, { names: FINDINGS_M });
    assert.equal(clause, `The required file is ${FINDINGS_M}. Do not stop until it exists and is complete.`, t);
  }
});

test("B: absent names degrade to the generic sentence rather than asserting a filename", () => {
  assert.match(requiredFileClause("connotation_call_never_made", { names: "" }),
    /The required file is the stage output\./);
});

// keep the temp dirs from accumulating across a full-suite run
test.after?.(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

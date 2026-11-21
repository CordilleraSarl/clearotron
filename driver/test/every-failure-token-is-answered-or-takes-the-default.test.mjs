// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY TOKEN A VALIDATOR CAN EMIT IS ANSWERED BY A REPAIR ROW OR NAMED HERE AS TAKING THE DEFAULT, AND EVERY CODE A ROW
// ANSWERS IS ONE SOMETHING MINTS.
//
// A corrective turn is told how to fix its failure by the first REPAIR_HINTS row that answers one of the failure's codes
// (hintSelection in repair-messages.mjs). The codes are the tokens validators mint, and contract-vocabulary.mjs is the
// census of those tokens. Two failures between them raise no error anywhere: a token renamed in its validator stops
// selecting its row, so the turn is handed the default sentence; and a row whose token nothing mints any more answers
// nothing. This file holds both directions, so either fails here by name:
//   · each literal token of the census selects a row or is in TAKES_THE_DEFAULT, and each family is answered by a row or
//     is in FAMILIES_TAKE_THE_DEFAULT (its members that no row names get the default);
//   · each code a row answers is a census token, a member of a census family, a token minted at a site named in
//     MINTED_ELSEWHERE, or one of MINTED_NOWHERE, each kept for the reason given there.
// The checks are pure functions over a census and a table, so the controls below hand them invented ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VOCABULARY } from "../contract-vocabulary.mjs";
import { REPAIR_HINTS, NAMES_THE_COVERAGE_LEDGER, hintSelection, failureCodes, correctionHint } from "../ladder/repair-messages.mjs";

/** The census tokens no row answers, so a turn failing on one is handed the default sentence. */
const TAKES_THE_DEFAULT = [
  "too_short", "missing", "grid_spec_unreadable", "grid_ledger_missing", "profile_unparseable", "platform_identity_error",
  "half_path_unrecognized", "framework_manifest_unreadable", "framework_manifest_missing_for_v4", "framework_method_unreadable",
  "ratified_form_unread", "coverage_recommendation", "coverage_gap_unexplained", "registerdigest_unaccounted_records",
  "registerdigest_accounting_unreadable", "registerdigest_model_missing", "registerdigest_uri_missing", "registerdigest_uri_unknown",
  "registerdigest_flag_reason_missing", "registerdigest_verify_invalid", "registerdigest_drop_reason_missing",
  "registerdigest_drop_ground_invalid", "registerdigest_drop_ground_contradicted", "registerdigest_instructed_incomplete",
  "registerdigest_adjudication_invalid", "registerdigest_adjudication_incomplete", "registerdigest_nothing_judged",
  "registerdigest_batch_unknown", "registerdigest_double_counted", "registerdigest_model_write_failed",
  "coverage_form_engine_vocabulary", "plan_execution_unreadable", "stagecontracts_invalid", "frame_scope_missing",
  "variantmodel_romanization_missing", "variantmodel_family_incomplete", "variantmodel_term_markup", "variantmodel_missing",
  "declared_not_executed", "named_band_invalid", "placementmodel_missing", "placement_unjudged", "placement_register_unrendered",
  "placement_form_unreadable", "placement_floors_without_fate", "placement_refused", "caselaw_ledger_missing",
  "caselaw_ledger_unparseable", "no_verdict_line", "missing_file",
  // The tool_timeout row answers the token with its detail (`tool_timeout:<tool>`), which is how the ladder writes it.
  "tool_timeout",
];

/** The census families no row answers whole: a member a row names by code gets that row, and any other the default. */
const FAMILIES_TAKE_THE_DEFAULT = [
  "connotation_", "finding", "coverage_clean_skipped", "coverage_ledger_", "coverage_axis_", "coverage_classes_invalid",
  "variantmodel_", "skeptic_", "reportoverview_", "reportcard_", "matterframe_", "named_band_", "placement", "caselaw_ledger",
];

/** Codes a row answers that the census does not list, each with the file that mints it as a literal. */
const MINTED_ELSEWHERE = {
  synthesis_findings_invalid: "../synthesis-record.mjs",
  synthesis_findings_missing: "../synthesis-record.mjs",
  refutation_plan_audit_missing: "../narrative-refutation-record.mjs",
  // the required prose sections, which needsSection reports by name (verify.mjs)
  "negative-results": "../verify.mjs",
  "coverage-ledger": "../verify.mjs",
  "audit-trail": "../verify.mjs",
};

/**
 * Codes a row answers that nothing on this tree mints. Each is kept so that a failure carrying it is answered as it was
 * before codes; removing one would change what such a failure is told, which is a wording decision, not this table's.
 */
const MINTED_NOWHERE = {
  coverage_mirror_missing: "the coverage ledger's shape row lists it; no parser raises it",
  use_check_missing: "the validator mints finding_use_check_missing, which the findings row answers first",
  own_rights_missing: "the validator mints finding_own_rights_source_missing, which the findings row answers first",
};

const rowCodes = (rows) => rows.flatMap((r) => [...(r.codes ?? []), ...(r.withDetail ?? [])]).filter((c) => c !== NAMES_THE_COVERAGE_LEDGER);
const familyAnswered = (rows, select, f) => select(f) !== null || rows.some((r) => (r.families ?? []).some((p) => f.startsWith(p)));

/** Census tokens and families that no row answers and no list names, and list entries a row now answers. PURE. */
function unansweredTokens(census, rows, select) {
  const problems = [];
  for (const { token, family } of census) {
    if (family) {
      const answered = familyAnswered(rows, select, token);
      if (!answered && !FAMILIES_TAKE_THE_DEFAULT.includes(token)) problems.push(`family ${token}: no row answers it and it is not listed as taking the default`);
      if (answered && FAMILIES_TAKE_THE_DEFAULT.includes(token)) problems.push(`family ${token}: a row answers it, so it no longer takes the default`);
    } else {
      const answered = select(token) !== null;
      if (!answered && !TAKES_THE_DEFAULT.includes(token)) problems.push(`${token}: no row answers it and it is not listed as taking the default`);
      if (answered && TAKES_THE_DEFAULT.includes(token)) problems.push(`${token}: a row answers it, so it no longer takes the default`);
    }
  }
  const tokens = new Set(census.map((r) => r.token));
  for (const t of [...TAKES_THE_DEFAULT, ...FAMILIES_TAKE_THE_DEFAULT]) if (!tokens.has(t)) problems.push(`${t}: listed as taking the default, but the census does not list it`);
  return problems;
}

/** Row codes that no census entry, named site or reason accounts for. PURE but for reading the named sites. */
function unmintedCodes(census, rows) {
  const literal = new Set(census.filter((r) => !r.family).map((r) => r.token));
  const families = census.filter((r) => r.family).map((r) => r.token);
  const problems = [];
  for (const c of rowCodes(rows)) {
    if (literal.has(c) || families.some((f) => c.startsWith(f))) {
      if (MINTED_ELSEWHERE[c] || MINTED_NOWHERE[c]) problems.push(`${c}: the census lists it now, so its entry here is stale`);
      continue;
    }
    if (MINTED_ELSEWHERE[c]) {
      const src = readFileSync(new URL(MINTED_ELSEWHERE[c], import.meta.url), "utf8");
      if (!new RegExp(`["\`]${c.replace(/[+]/g, "\\+")}[:"\`]`).test(src)) problems.push(`${c}: ${MINTED_ELSEWHERE[c]} no longer mints it`);
    } else if (!MINTED_NOWHERE[c]) problems.push(`${c}: a row answers it, and nothing mints it`);
  }
  for (const r of rows) for (const p of r.families ?? []) if (!families.some((f) => p.startsWith(f) || f.startsWith(p))) problems.push(`family ${p} (row ${r.code}): no census family mints it`);
  return problems;
}

const select = (t) => hintSelection(t)?.row.code ?? null;

test("every token the census lists is answered by a row or listed as taking the default", () => {
  assert.ok(VOCABULARY.length > 50, `the census has ${VOCABULARY.length} entries — it is being read from the wrong place`);
  assert.deepEqual(unansweredTokens(VOCABULARY, REPAIR_HINTS, select), []);
});

test("every code a row answers is minted: by the census, at a named site, or kept for a stated reason", () => {
  assert.deepEqual(unmintedCodes(VOCABULARY, REPAIR_HINTS), []);
});

test("control: a token renamed in its validator, and its row left behind, both fail here by name", () => {
  // The census after an invented rename of coverage_form_damaged, with the repair table unchanged.
  const renamed = VOCABULARY.map((r) => (r.token === "coverage_form_damaged" ? { ...r, token: "coverage_form_broken" } : r));
  assert.deepEqual(unansweredTokens(renamed, REPAIR_HINTS, select), ["coverage_form_broken: no row answers it and it is not listed as taking the default"]);
  assert.deepEqual(unmintedCodes(renamed, REPAIR_HINTS), ["coverage_form_damaged: a row answers it, and nothing mints it"]);
});

test("the artifact's name selects no row, except the coverage ledger's, which keeps the prose-sections row at its place", () => {
  // A token no row names, failing on the coverage ledger: the sentence it was handed before codes, under its own code.
  const ledger = hintSelection("invalid_file:register-coverage-ledger.json:an_invented_token");
  assert.equal(ledger?.row.code, "prose_sections");
  assert.equal(ledger?.by, NAMES_THE_COVERAGE_LEDGER, "the selection says the file's name chose it, not a missing section");
  assert.equal(hintSelection("missing_file:register-coverage-ledger.json")?.by, NAMES_THE_COVERAGE_LEDGER);
  // A token with a row of its own, on the same file: that row wins, as it did.
  assert.equal(hintSelection("invalid_file:register-coverage-ledger.json:coverage_ledger_unparseable:at 3")?.row.code, "coverage_ledger_shape");
  // A real missing section is named as one.
  assert.equal(hintSelection("invalid_file:register-findings.md:missing:coverage-ledger")?.by, "coverage-ledger");
  // Any other file's name selects nothing.
  assert.equal(hintSelection("invalid_file:blindframe_invented.json:an_invented_token"), null);
  assert.deepEqual(failureCodes("invalid_file:framediff_invented.md:an_invented_token").tokens.map((t) => t.token), ["invalid_file", "an_invented_token"]);
  assert.equal(correctionHint("invalid_file:framediff_invented.md:an_invented_token"), correctionHint("an_invented_token"));
});
